# -*- coding: utf-8 -*-
"""进程内的假 OpenAI 兼容上游。

为什么要真起一个 HTTP 服务，而不是 mock 掉 `OpenAI` 客户端：

`thinking` 是走 `extra_body` 传的，`response_format` 也有自己的序列化路径。
只有让请求真的过一遍 openai SDK 的网络层，才能确认这两个字段确实进了请求体
——而它们正是「关掉思考模式」和「拿到合法 JSON」的唯一保证。

服务监听 127.0.0.1 的随机端口，只在本机可见，不占固定端口，可以并行跑。
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Iterable, Union


def chat_response(content: str, model: str = "deepseek-flash") -> dict:
    """把一段文本包成 OpenAI 兼容的 chat.completion 响应体。"""
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }


# 队列里的一项：(status, body_dict) 或 (status, body_dict, headers)
Reply = Union[tuple, Callable[[dict], tuple]]


class FakeUpstream:
    """可编程的假上游。

    - `queue` 里放预定的响应，按顺序取；取空后回落到 `default`
    - 每次请求都记录在 `requests` 里，便于断言发出去的请求体
    """

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.queue: list[Reply] = []
        self.default: Reply = (200, chat_response('{"verdict":"watch"}'))
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # --- 生命周期 ---------------------------------------------------------

    def start(self) -> "FakeUpstream":
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):  # 静音，别把测试输出刷满
                pass

            def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler 约定
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    body = json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    body = {}

                with upstream._lock:
                    upstream.requests.append(
                        {
                            "path": self.path,
                            "authorization": self.headers.get("Authorization"),
                            "body": body,
                        }
                    )
                    reply: Reply = upstream.queue.pop(0) if upstream.queue else upstream.default

                status, payload, *rest = reply(body) if callable(reply) else reply
                headers = rest[0] if rest else {}
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(data)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def __enter__(self) -> "FakeUpstream":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    # --- 断言辅助 ---------------------------------------------------------

    @property
    def base_url(self) -> str:
        assert self._server is not None, "FakeUpstream 还没 start()"
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def count(self) -> int:
        return len(self.requests)

    @property
    def last(self) -> dict:
        assert self.requests, "上游一次请求都没收到"
        return self.requests[-1]

    def script(self, *replies: Reply) -> None:
        """预排响应，按顺序消费。"""
        with self._lock:
            self.queue.extend(replies)

    def script_content(self, *contents: str) -> None:
        """按顺序返回若干段文本内容，状态码固定 200。"""
        self.script(*[(200, chat_response(text)) for text in contents])

    def reset(self) -> None:
        with self._lock:
            self.requests.clear()
            self.queue.clear()


def iter_messages(record: dict) -> Iterable[dict]:
    return (record.get("body") or {}).get("messages") or []

# -*- coding: utf-8 -*-
"""Bili Insight 自建服务（可选）。

插件默认直连模型厂商的 OpenAI 兼容接口，Key 存在浏览器本地，不需要这个服务。
只有在下面这些情况才需要起它：

  * 不想把 Key 分发到每台机器的浏览器里（团队共用一把 Key）
  * Key 要留在服务器上做统一计费和审计
  * 想给插件套一层自己的网关

启动：

    DEEPSEEK_API_KEY=sk-xxx RELAY_TOKEN=your-token uvicorn api:app --port 8000

然后把插件设置里的「接口地址」填成 http://127.0.0.1:8000（若走本地调试需在
manifest 里放行该域名），「API Key」填 RELAY_TOKEN 的值。
"""
import logging
import os

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

import llm

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s", datefmt="%d-%b-%y %H:%M:%S")
log = logging.getLogger(__name__)

RELAY_TOKEN = (os.getenv("RELAY_TOKEN") or "").strip()
ALLOW_ORIGINS = [origin.strip() for origin in (os.getenv("ALLOW_ORIGINS") or "*").split(",") if origin.strip()]

app = FastAPI(title="Bili Insight API", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "model": llm.get_model(), "relay_enabled": bool(RELAY_TOKEN)}


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="请求体必须是 JSON 对象")
    return body


def _wrap(call):
    """把模型层的异常翻译成明确的 HTTP 状态码。"""
    try:
        return call()
    except llm.LLMConfigError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except llm.LLMResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/summary")
async def summary_endpoint(request: Request):
    """结构化判断：verdict / score / one_line / points / signals / caveat。"""
    body = await _json_body(request)
    payload = body.get("payload") or body
    return _wrap(lambda: llm.verdict(
        payload,
        api_key=body.get("apiKey"),
        base_url=body.get("baseUrl"),
        model=body.get("model"),
    ))


@app.post("/outline")
async def outline_endpoint(request: Request):
    """markmap 用的 Markdown 大纲。"""
    body = await _json_body(request)
    payload = body.get("payload") or body
    return {"outline": _wrap(lambda: llm.outline(
        payload,
        api_key=body.get("apiKey"),
        base_url=body.get("baseUrl"),
        model=body.get("model"),
    ))}


@app.post("/run/predict")
async def predict(request: Request):
    """兼容旧版插件的 Gradio 风格接口：data = [text, apiKey, method]。"""
    body = await _json_body(request)
    data = body.get("data") or []
    text = data[0] if len(data) > 0 else ""
    api_key = data[1] if len(data) > 1 else None
    method = data[2] if len(data) > 2 else ""

    result = _wrap(lambda: llm.summary(text, api_key=api_key, method=method or "summary"))
    return {"data": [result]}


@app.post("/")
async def legacy_summary(request: Request):
    """兼容更早的 / 接口。"""
    body = await _json_body(request)
    text = body.get("text") or ""
    result = _wrap(lambda: llm.summary(text, api_key=body.get("apiKey")))
    return {"summary": result}


@app.post("/chat/completions")
async def chat_proxy(request: Request, authorization: str = Header(default="")):
    """给插件用的转发端点：服务端持 Key，客户端只带 RELAY_TOKEN。

    需要设置 RELAY_TOKEN 才会启用，否则返回 503，避免变成公开的免费代理。
    """
    if not RELAY_TOKEN:
        raise HTTPException(status_code=503, detail="转发端点未启用，请设置 RELAY_TOKEN 环境变量")
    if authorization.strip() != f"Bearer {RELAY_TOKEN}":
        raise HTTPException(status_code=401, detail="token 不正确")

    body = await _json_body(request)
    messages = body.get("messages") or []
    if not messages:
        raise HTTPException(status_code=400, detail="缺少 messages")

    def call():
        client = llm.get_client()
        response = client.chat.completions.create(
            model=llm.get_model(),
            messages=messages,
            max_tokens=body.get("max_tokens") or 800,
            temperature=body.get("temperature", 0.3),
            response_format=body.get("response_format"),
            extra_body={"thinking": {"type": "disabled"}},
        )
        return response.choices[0].message.content or ""

    content = _wrap(call)
    log.info("relay 转发完成，输入 %s 条消息，输出 %s 字", len(messages), len(content))
    return {
        "id": "bili-insight-relay",
        "object": "chat.completion",
        "model": llm.get_model(),
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")), workers=1)

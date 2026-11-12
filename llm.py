# -*- coding: utf-8 -*-
"""Bili Insight 的模型调用层。

只依赖 openai>=1.x —— 不再需要 langchain，也不再需要 gradio。
默认走 DeepSeek 的 OpenAI 兼容接口，base_url / model / key 都可以用环境变量覆盖：

    DEEPSEEK_BASE_URL=https://api.deepseek.com
    DEEPSEEK_MODEL=deepseek-flash
    DEEPSEEK_API_KEY=sk-xxx

为什么不需要 refine 链：deepseek-flash 是 1M 上下文，一条 20 分钟视频的字幕
（约 8k token）一次请求就装得下，分块 + 逐块精炼只增加延迟和调用次数。
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone

from openai import OpenAI

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
# 字幕每行现在带 [mm:ss] 前缀，同样的时长会比以前长一截，所以额度上调
MAX_TRANSCRIPT_CHARS = 80000
VERDICT_ORDER = ("watch", "skim", "skip")

VERDICT_SYSTEM_PROMPT = """你是浏览器插件里的视频内容审稿编辑。用户把鼠标悬停在 B 站视频卡片上，只想知道一件事：这个视频值不值得花时间看，以及从第几分钟开始看。

我会给你视频的标题、UP 主、分区、时长、互动数据和字幕全文。字幕每一行开头都有 [mm:ss]，表示这句话出现在视频的第几分第几秒。如果没有字幕，「字幕」一行会注明没有可用字幕。

严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段如下：
{
  "verdict": "watch" 或 "skim" 或 "skip",
  "score": 0 到 100 的整数，表示值得投入时间的程度,
  "one_line": "30 字以内，一句话说清这视频讲了什么、值不值得看",
  "points": [
    {"text": "25 字以内，视频里真正的信息点，不要复述标题", "at": 该信息点开始出现的秒数}
  ],
  "signals": {
    "density": "高 或 中 或 低，干货占比",
    "audience": "20 字以内，最适合谁看",
    "duplication": "20 字以内，同质化风险",
    "cost": "20 字以内，时长与推荐观看方式"
  },
  "outline": "6 到 12 行 Markdown 脑图，行之间用 \\n 分隔；第一行是 # 加 15 字以内主旨；下面每条以 - 开头，用两个空格缩进表示层级，最多三层；每条是精简短语，不要完整句子"
}

关于 points 和 at，这几条很严格，因为用户会点着 at 跳转：
- points 给 2 到 4 条，每条 25 字以内，必须是视频里真正讲到的信息点
- at 是整数秒数，必须来自【字幕】行首的 [mm:ss]，把 mm 乘 60 再加上 ss
- at 要指向该信息点「开始讲」的那一句，不要指向标题出现的时刻，也不要靠感觉估
- 没有字幕时，points 里不要输出 at 字段

判定标准：
- watch：信息密度高、有独特观点或一手材料，完整看完有收益
- skim：有价值但注水明显，跳看要点或倍速即可
- skip：标题党、纯搬运、与标题承诺不符，或内容在别处已经听过

只依据给定材料判断，不要编造视频里没出现的内容。如果没有字幕，只能依据标题、简介和分区做保守推断，并把 score 压低。"""

OUTLINE_SYSTEM_PROMPT = """你是浏览器插件里的内容结构化助手。请把视频内容整理成适合 markmap 渲染的 Markdown 脑图大纲。

要求：
- 只输出 Markdown，不要代码块包裹，不要任何解释
- 第一行是一级标题，格式为 "# 不超过 15 字的主旨"
- 用无序列表 - 展开层级，最多三层
- 一级节点不超过 5 个，总行数不超过 12 行
- 每个节点是精简短语，不要完整句子，不要重复

只依据给定材料，不要编造视频里没出现的内容。"""


class LLMConfigError(RuntimeError):
    """缺少 API Key 或配置不合法。"""


class LLMResponseError(RuntimeError):
    """模型返回的内容不可用。"""


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def get_client(api_key: str = None, base_url: str = None) -> OpenAI:
    key = (api_key or _env("DEEPSEEK_API_KEY")).strip()
    if not key:
        raise LLMConfigError("未配置 API Key")
    return OpenAI(
        api_key=key,
        base_url=(base_url or _env("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL)).rstrip("/"),
    )


def get_model(model: str = None) -> str:
    return (model or _env("DEEPSEEK_MODEL", DEFAULT_MODEL)).strip()


def _chat(client: OpenAI, model: str, messages, *, json_mode: bool = False, max_tokens: int = 800) -> str:
    """统一入口。

    thinking 必须显式关掉：DeepSeek 默认开启且 effort=high，悬停卡片等不起。
    非思考模式下 temperature 才会生效。
    """
    kwargs = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "extra_body": {"thinking": {"type": "disabled"}},
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception as exc:  # noqa: BLE001 - 统一转换成可读错误
        log.error("模型调用失败: %s", exc, exc_info=True)
        raise LLMResponseError(f"模型调用失败: {exc}") from exc

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise LLMResponseError("模型没有返回内容")
    return content


def format_duration(seconds) -> str:
    total = int(seconds or 0)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _format_pubdate(timestamp) -> str:
    try:
        return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return ""


def _clip_transcript(text: str, limit: int = MAX_TRANSCRIPT_CHARS) -> str:
    """超长字幕保留首尾，而不是砍掉结尾。

    原来是 slice(0, limit)：一小时以上的访谈、直播回放，前半段还在铺垫，
    「所以结论是」全在被砍掉的最后几分钟里。改成首 70% + 尾 30%，
    中间标注省略了多少，模型至少知道结尾讲了什么。
    """
    text = text or ""
    if len(text) <= limit:
        return text
    head = limit * 7 // 10
    tail = limit - head
    omitted = len(text) - limit
    return f"{text[:head]}\n…（中间省略 {omitted} 个字符）…\n{text[-tail:]}"


def build_user_content(payload) -> str:
    """把结构化 payload 拼成模型输入；也兼容传纯文本的旧用法。"""
    if isinstance(payload, str):
        return f"【字幕】\n{_clip_transcript(payload)}"

    p = payload or {}
    stat = p.get("stat") or {}
    lines = [f"【标题】{p.get('title') or '（空）'}"]

    if p.get("owner"):
        lines.append(f"【UP 主】{p['owner']}")
    if p.get("tname"):
        lines.append(f"【分区】{p['tname']}")
    lines.append(f"【时长】{format_duration(p.get('duration'))}")
    if p.get("pubdate"):
        lines.append(f"【发布】{_format_pubdate(p['pubdate'])}")

    lines.append(
        "【数据】播放 {view} · 点赞 {like} · 投币 {coin} · 收藏 {favorite} · "
        "分享 {share} · 评论 {reply} · 弹幕 {danmaku}".format(
            view=stat.get("view", 0),
            like=stat.get("like", 0),
            coin=stat.get("coin", 0),
            favorite=stat.get("favorite", 0),
            share=stat.get("share", 0),
            reply=stat.get("reply", 0),
            danmaku=stat.get("danmaku", 0),
        )
    )
    if p.get("desc"):
        lines.append(f"【简介】{p['desc']}")

    lines.append("")
    transcript = _clip_transcript(str(p.get("transcript") or ""))
    kind = str(p.get("subtitleKind") or "")
    if transcript:
        if kind == "ai":
            lines.append("【字幕类型】B 站 AI 识别字幕，可能有同音错字，遇到明显不通的地方按上下文理解")
        elif kind == "human":
            lines.append("【字幕类型】UP 主上传或人工校对字幕")
        lines.append(f"【字幕】\n{transcript}")
    else:
        lines.append("【字幕】（本视频没有可用字幕）")
    return "\n".join(lines)


def _strip_code_fence(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"```$", "", s).strip()
    return s


def _parse_json_loose(text: str):
    s = _strip_code_fence(text)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        start, end = s.find("{"), s.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(s[start:end + 1])
            except json.JSONDecodeError:
                return None
        return None


def _normalize_outline(value) -> str:
    """把模型给的 outline 收敛成 markmap 能吃的 12 行以内 Markdown。"""
    if isinstance(value, list):
        text = "\n".join(str(item) for item in value)
    else:
        text = str(value or "")
    text = _strip_code_fence(text).strip()
    if not text:
        return ""
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines[0].startswith("#"):
        lines.insert(0, "# 内容大纲")
    return "\n".join(lines[:12])


_CLOCK_PREFIX = re.compile(r"^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*")
_DEFAULT_DURATION_LIMIT = 86400


def _parse_clock(text: str):
    """从 '[12:30] xxx' 里取出秒数，取不到返回 None。"""
    match = _CLOCK_PREFIX.match(text or "")
    if not match:
        return None
    first, second, third = match.groups()
    if third is None:
        return int(first) * 60 + int(second)
    return int(first) * 3600 + int(second) * 60 + int(third)


def _normalize_points(raw, duration) -> list:
    """把 points 统一成 [{text, at}]，at 是秒数或 None。

    模型可能给纯字符串（老格式），也可能给 {text, at}。
    字符串里带 [mm:ss] 前缀时顺手抽出来，正文里去掉前缀，避免和时间戳重复。
    at 会夹到视频时长内——模型偶尔会算出超过时长的秒数，点过去是空进度。
    """
    if not isinstance(raw, list):
        return []
    try:
        limit = int(duration or 0)
    except (TypeError, ValueError):
        limit = 0
    if limit <= 0:
        limit = _DEFAULT_DURATION_LIMIT

    points = []
    for item in raw:
        at = None
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("point") or "").strip()
            try:
                at = int(round(float(item.get("at"))))
            except (TypeError, ValueError):
                at = None
        else:
            text = str(item or "").strip()
        if not text:
            continue
        if at is None:
            at = _parse_clock(text)
        if at is None:
            points.append({"text": text, "at": None})
        else:
            points.append({"text": _CLOCK_PREFIX.sub("", text).strip(), "at": max(0, min(limit, at))})
        if len(points) == 4:
            break
    return points


def _normalize_verdict(parsed: dict, payload) -> dict:
    try:
        score = int(round(float(parsed.get("score", 50))))
    except (TypeError, ValueError):
        score = 50
    score = max(0, min(100, score))

    verdict = str(parsed.get("verdict") or "").lower()
    if verdict not in VERDICT_ORDER:
        verdict = "watch" if score >= 70 else "skim" if score >= 40 else "skip"

    signals = parsed.get("signals") or {}
    duration = (payload or {}).get("duration") if isinstance(payload, dict) else 0

    has_transcript = bool(str((payload or {}).get("transcript") or "").strip()) if isinstance(payload, dict) else bool(payload)
    kind = str((payload or {}).get("subtitleKind") or "") if isinstance(payload, dict) else ""
    if not has_transcript:
        caveat = "无字幕 · 仅依据标题与简介推断"
    elif kind == "ai":
        caveat = "AI 字幕 · 识别可能有错字"
    else:
        caveat = ""

    return {
        "verdict": verdict,
        "score": score,
        "summary": str(parsed.get("one_line") or parsed.get("summary") or "").strip(),
        "one_line": str(parsed.get("one_line") or parsed.get("summary") or "").strip(),
        "points": _normalize_points(parsed.get("points"), duration),
        "signals": {
            "density": str(signals.get("density") or ""),
            "audience": str(signals.get("audience") or ""),
            "duplication": str(signals.get("duplication") or ""),
            "cost": str(signals.get("cost") or ""),
        },
        "outline": _normalize_outline(parsed.get("outline")),
        "caveat": caveat,
    }


def verdict(payload, api_key: str = None, base_url: str = None, model: str = None) -> dict:
    """给出「值不值得看」的结构化判断，附带脑图大纲。

    结论和大纲在一次调用里出，避免把同一份字幕重复发两遍。
    """
    client = get_client(api_key, base_url)
    content = _chat(
        client,
        get_model(model),
        [
            {"role": "system", "content": VERDICT_SYSTEM_PROMPT},
            {"role": "user", "content": build_user_content(payload)},
        ],
        json_mode=True,
        max_tokens=1200,
    )

    parsed = _parse_json_loose(content)
    if not parsed:
        raise LLMResponseError("模型输出无法解析为 JSON")
    return _normalize_verdict(parsed, payload)


def outline(payload, api_key: str = None, base_url: str = None, model: str = None) -> str:
    """生成 markmap 可渲染的 Markdown 大纲。"""
    client = get_client(api_key, base_url)
    content = _chat(
        client,
        get_model(model),
        [
            {"role": "system", "content": OUTLINE_SYSTEM_PROMPT},
            {"role": "user", "content": build_user_content(payload)},
        ],
        max_tokens=700,
    )
    return _strip_code_fence(content)


def summary(payload, api_key: str = None, base_url: str = None, model: str = None, method: str = "summary") -> str:
    """兼容旧调用的纯文本出口。"""
    if method == "markmap":
        return outline(payload, api_key=api_key, base_url=base_url, model=model)
    return verdict(payload, api_key=api_key, base_url=base_url, model=model)["summary"]

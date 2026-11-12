# -*- coding: utf-8 -*-
"""api.py：六个端点 + 鉴权 + 坏请求。

重点是「一次悬停只花一次模型调用」这条不能回退——最初的问题就是结论和脑图
各打一次模型，同一份字幕发了两遍。
"""
from __future__ import annotations

import json

from sample_payload import MODEL_JSON, PAYLOAD


def _script(llm_env, payload=None):
    llm_env.script_content(json.dumps(payload or MODEL_JSON, ensure_ascii=False))


def test_health(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["model"] == "deepseek-flash"
    assert body["relay_enabled"] is True


def test_summary_returns_verdict_and_outline_in_one_call(client, llm_env):
    _script(llm_env)

    response = client.post("/summary", json={"payload": PAYLOAD})

    assert response.status_code == 200
    body = response.json()
    assert body["verdict"] == "watch"
    assert body["score"] == 82
    assert len(body["points"]) == 3
    assert body["outline"].startswith("# 降噪耳机实测")
    assert body["caveat"] == ""
    assert llm_env.count == 1, "结论与大纲必须共用一次上游调用"


def test_summary_accepts_bare_payload(client, llm_env):
    """不带 payload 外层直接传字段也认——旧版插件就是这么发的。"""
    _script(llm_env, {"one_line": "裸 payload", "score": 60})
    body = client.post("/summary", json={"title": "只有标题"}).json()
    assert body["summary"] == "裸 payload"


def test_summary_without_transcript_adds_caveat(client, llm_env):
    _script(llm_env)
    body = client.post("/summary", json={"payload": {"title": "只有标题", "transcript": ""}}).json()
    assert "无字幕" in body["caveat"]


def test_outline_endpoint(client, llm_env):
    llm_env.script_content("```markdown\n# 大纲\n- 第一条\n```")
    body = client.post("/outline", json={"payload": PAYLOAD}).json()
    assert body["outline"] == "# 大纲\n- 第一条"


def test_legacy_run_predict(client, llm_env):
    _script(llm_env)
    body = client.post("/run/predict", json={"data": ["一段纯字幕", None, "summary"]}).json()
    assert body["data"][0] == MODEL_JSON["one_line"]


def test_legacy_run_predict_markmap(client, llm_env):
    llm_env.script_content("# 大纲\n- a")
    body = client.post("/run/predict", json={"data": ["一段纯字幕", None, "markmap"]}).json()
    assert body["data"][0] == "# 大纲\n- a"
    assert "response_format" not in llm_env.last["body"]


def test_legacy_root_endpoint(client, llm_env):
    _script(llm_env)
    body = client.post("/", json={"text": "一段纯字幕"}).json()
    assert body["summary"] == MODEL_JSON["one_line"]


# --- 坏请求 ---------------------------------------------------------------


def test_malformed_json_is_400(client):
    response = client.post("/summary", content=b"{not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_non_object_body_is_400(client):
    assert client.post("/summary", json=[1, 2, 3]).status_code == 400


def test_missing_key_is_401(make_client):
    """没有 Key 时不能 500，要明确告诉用户去设置里填。"""
    with make_client(relay_token=None, api_key=None) as client:
        response = client.post("/summary", json={"payload": PAYLOAD})
    assert response.status_code == 401
    assert "API Key" in response.json()["detail"]


def test_upstream_failure_is_502(client, llm_env):
    llm_env.script((400, {"error": {"message": "invalid request"}}))
    response = client.post("/summary", json={"payload": PAYLOAD})
    assert response.status_code == 502


# --- 转发端点 -------------------------------------------------------------


def test_relay_disabled_without_token(make_client):
    with make_client(relay_token=None) as client:
        response = client.post("/chat/completions", json={"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 503


def test_relay_rejects_wrong_token(make_client):
    with make_client(relay_token="relay-secret") as client:
        response = client.post(
            "/chat/completions",
            json={"messages": [{"role": "user", "content": "hi"}]},
            headers={"Authorization": "Bearer wrong"},
        )
    assert response.status_code == 401


def test_relay_forwards_with_correct_token(client, llm_env):
    _script(llm_env)
    response = client.post(
        "/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": "Bearer relay-secret"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "chat.completion"
    assert body["choices"][0]["message"]["content"]
    # 转发时也必须关掉思考模式，否则插件侧会一直等
    assert llm_env.last["body"]["thinking"] == {"type": "disabled"}


def test_relay_requires_messages(client):
    response = client.post(
        "/chat/completions",
        json={"messages": []},
        headers={"Authorization": "Bearer relay-secret"},
    )
    assert response.status_code == 400

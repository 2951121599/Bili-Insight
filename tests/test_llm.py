# -*- coding: utf-8 -*-
"""llm.py：提示词拼装、脏数据收敛、单次调用、错误路径。

这一层的价值不在「跑通 happy path」，而在于把模型可能吐出来的各种脏东西
钉死在边界上：分数越界、points 不是数组、JSON 被围栏包住、没有一级标题……
这些都是线上真实会遇到的形态。
"""
from __future__ import annotations

import json

import pytest

import llm
from sample_payload import MODEL_JSON, PAYLOAD


# --- 纯函数 ---------------------------------------------------------------


def test_format_duration():
    assert llm.format_duration(0) == "0:00"
    assert llm.format_duration(59) == "0:59"
    assert llm.format_duration(1080) == "18:00"
    assert llm.format_duration(3720) == "1:02:00"
    assert llm.format_duration(None) == "0:00"


def test_build_user_content_keeps_every_field():
    text = llm.build_user_content(PAYLOAD)
    for piece in ("【标题】三款降噪耳机实测", "【UP 主】数码 UP", "【分区】数码", "【时长】18:00", "【发布】2023-11-14"):
        assert piece in text, piece
    assert "播放 120000" in text
    assert "【简介】自费购买，无广" in text
    assert "【字幕】\n今天我们测三款降噪耳机" in text


def test_build_user_content_marks_missing_transcript():
    text = llm.build_user_content({"title": "只有标题", "transcript": ""})
    assert "本视频没有可用字幕" in text


def test_build_user_content_accepts_plain_string():
    """旧版 /run/predict 与 / 接口直接传一段纯文本。"""
    text = llm.build_user_content("一段纯字幕")
    assert text == "【字幕】\n一段纯字幕"


def test_transcript_is_capped():
    huge = "字" * 200000
    text = llm.build_user_content({"title": "长视频", "transcript": huge})
    # 注意别用 text.count("字")——"字幕"这个标签里本身就有个「字」
    transcript = text.split("【字幕】\n")[1]
    assert len(transcript) == llm.MAX_TRANSCRIPT_CHARS
    assert len(text) < llm.MAX_TRANSCRIPT_CHARS + 300


@pytest.mark.parametrize(
    "raw, expected",
    [
        ('{"a":1}', {"a": 1}),
        ('```json\n{"a":1}\n```', {"a": 1}),
        ('好的，结果如下：\n{"a":1}\n以上。', {"a": 1}),
        ("完全不是 JSON", None),
        ('{"a":', None),
    ],
)
def test_parse_json_loose(raw, expected):
    assert llm._parse_json_loose(raw) == expected


def test_normalize_outline_inserts_missing_title():
    assert llm._normalize_outline("- 只有列表").startswith("# ")
    assert llm._normalize_outline("# 已有标题\n- a") == "# 已有标题\n- a"


def test_normalize_outline_caps_line_count():
    long_outline = "# 标题\n" + "\n".join(f"- 第 {i} 条" for i in range(30))
    assert len(llm._normalize_outline(long_outline).split("\n")) == 12


def test_normalize_outline_handles_list_and_fence():
    assert llm._normalize_outline(["# 标题", "- a"]).startswith("# ")
    assert llm._normalize_outline("```markdown\n# 标题\n- a\n```") == "# 标题\n- a"
    assert llm._normalize_outline(None) == ""


def test_normalize_verdict_clamps_out_of_range_score():
    result = llm._normalize_verdict({"verdict": "WATCH", "score": 999}, PAYLOAD)
    assert result["score"] == 100
    assert result["verdict"] == "watch"

    result = llm._normalize_verdict({"verdict": "随便写", "score": -5}, PAYLOAD)
    assert result["score"] == 0
    assert result["verdict"] == "skip"  # 分数兜底


def test_normalize_verdict_drops_non_list_points():
    result = llm._normalize_verdict({"points": "not-an-array", "score": 50}, PAYLOAD)
    assert result["points"] == []


def test_normalize_verdict_keeps_at_most_four_points():
    result = llm._normalize_verdict({"points": [f"p{i}" for i in range(9)], "score": 50}, PAYLOAD)
    assert len(result["points"]) == 4


def test_normalize_verdict_falls_back_to_summary_field():
    assert llm._normalize_verdict({"summary": "旧字段", "score": 50}, PAYLOAD)["summary"] == "旧字段"


def test_normalize_verdict_caveat_only_without_transcript():
    with_transcript = llm._normalize_verdict({}, PAYLOAD)
    without = llm._normalize_verdict({}, {"title": "只有标题"})
    assert with_transcript["caveat"] == ""
    assert "无字幕" in without["caveat"]


# --- 真的发一次请求 -------------------------------------------------------


def test_verdict_single_call_returns_both_parts(llm_env):
    llm_env.script_content(json.dumps(MODEL_JSON, ensure_ascii=False))

    result = llm.verdict(PAYLOAD)

    assert llm_env.count == 1, "结论与大纲必须共用一次调用"
    assert result["verdict"] == "watch"
    assert result["score"] == 82
    assert result["summary"] == MODEL_JSON["one_line"]
    assert result["points"] == MODEL_JSON["points"]
    assert result["outline"].startswith("# 降噪耳机实测")
    assert result["caveat"] == ""


def test_verdict_request_body(llm_env):
    llm_env.script_content(json.dumps(MODEL_JSON, ensure_ascii=False))
    llm.verdict(PAYLOAD)

    record = llm_env.last
    body = record["body"]
    assert record["authorization"] == "Bearer test-key"
    assert record["path"].endswith("/chat/completions")
    assert body["model"] == "deepseek-flash"
    assert body["max_tokens"] == 1200
    assert body["thinking"] == {"type": "disabled"}, "思考模式必须显式关闭，否则悬停要等很久"
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"][0]["role"] == "system"
    assert '"outline"' in body["messages"][0]["content"], "system prompt 必须要求 outline 字段"
    assert "【标题】三款降噪耳机实测" in body["messages"][1]["content"]
    assert "【字幕】" in body["messages"][1]["content"]


def test_outline_endpoint_does_not_ask_for_json(llm_env):
    llm_env.script_content("```markdown\n# 标题\n- a\n```")

    text = llm.outline(PAYLOAD)

    assert text == "# 标题\n- a"
    assert "response_format" not in llm_env.last["body"]


def test_summary_dispatches_on_method(llm_env):
    # 第一个响应给 summary 路径（要 JSON），第二个给 markmap 路径（纯 Markdown）
    llm_env.script_content(json.dumps(MODEL_JSON, ensure_ascii=False), "忽略")

    assert llm.summary(PAYLOAD, method="summary") == MODEL_JSON["one_line"]
    assert llm.summary(PAYLOAD, method="markmap") == "忽略"


# --- 错误路径 -------------------------------------------------------------


def test_missing_key_raises_config_error(llm_env, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(llm.LLMConfigError):
        llm.verdict(PAYLOAD)


def test_unparsable_content_raises(llm_env):
    llm_env.script_content("抱歉，我不能回答这个问题")
    with pytest.raises(llm.LLMResponseError):
        llm.verdict(PAYLOAD)


def test_upstream_error_is_wrapped(llm_env):
    llm_env.script((400, {"error": {"message": "invalid request"}}))
    with pytest.raises(llm.LLMResponseError):
        llm.verdict(PAYLOAD)


def test_model_resolution_order(llm_env, monkeypatch):
    assert llm.get_model() == "deepseek-flash"  # 默认值
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
    assert llm.get_model() == "deepseek-v4-pro"  # 环境变量
    assert llm.get_model("custom-model") == "custom-model"  # 显式参数优先

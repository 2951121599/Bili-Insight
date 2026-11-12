# -*- coding: utf-8 -*-
"""测试共用的样例数据，避免 test_api 反向 import test_llm。"""
from __future__ import annotations

PAYLOAD = {
    "title": "三款降噪耳机实测",
    "owner": "数码 UP",
    "tname": "数码",
    "duration": 1080,
    "pubdate": 1700000000,
    "desc": "自费购买，无广",
    "stat": {
        "view": 120000,
        "like": 8000,
        "coin": 900,
        "favorite": 2000,
        "share": 300,
        "reply": 400,
        "danmaku": 900,
    },
    # 字幕每行带 [mm:ss]，模型靠它给要点定位
    "transcript": "[00:00] 今天我们测三款降噪耳机\n[02:15] A 款降噪最强但压耳\n[07:40] B 款人声通透\n[12:30] C 款性价比最高",
    "subtitleKind": "human",
}

MODEL_JSON = {
    "verdict": "watch",
    "score": 82,
    "one_line": "三款降噪耳机的通勤实测，结论明确",
    "points": [
        {"text": "A 款降噪最强但压耳", "at": 135},
        {"text": "B 款人声通透", "at": 460},
        {"text": "C 款性价比最高", "at": 750},
    ],
    "signals": {"density": "高", "audience": "通勤党", "duplication": "低", "cost": "18 分钟"},
    "outline": "# 降噪耳机实测\n- 测试方法\n  - 地铁与办公室\n- 三款对比\n- 选购建议",
}

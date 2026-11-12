# -*- coding: utf-8 -*-
"""pytest 共享夹具。

约定：
- 所有测试都不联网，模型侧一律打到 `FakeUpstream`
- 不依赖 `DEEPSEEK_*` 环境变量在开发机上的残留值：每个用例自己 setenv / delenv
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
for path in (str(ROOT), str(TESTS)):
    if path not in sys.path:
        sys.path.insert(0, path)

from fake_upstream import FakeUpstream  # noqa: E402


@pytest.fixture
def upstream():
    """一个只在本次用例里活着的假上游。"""
    with FakeUpstream() as fake:
        yield fake


@pytest.fixture
def llm_env(monkeypatch, upstream):
    """把 llm.py 指向假上游，并保证模型名是已知值。"""
    monkeypatch.setenv("DEEPSEEK_BASE_URL", upstream.base_url)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    return upstream


@pytest.fixture
def make_client(monkeypatch, llm_env):
    """构造 FastAPI TestClient。

    api.py 在 import 时就把 RELAY_TOKEN 读进模块变量，所以要测「开/关转发」两种
    形态，必须在导入前改环境变量，再把模块从 sys.modules 里踢掉重新导入。
    """
    from fastapi.testclient import TestClient

    def _make(relay_token: str | None = None, api_key: str | None = "test-key"):
        if relay_token is None:
            monkeypatch.delenv("RELAY_TOKEN", raising=False)
        else:
            monkeypatch.setenv("RELAY_TOKEN", relay_token)

        if api_key is None:
            monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        else:
            monkeypatch.setenv("DEEPSEEK_API_KEY", api_key)

        sys.modules.pop("api", None)
        import api as api_module

        return TestClient(api_module.app)

    return _make


@pytest.fixture
def client(make_client):
    """默认形态：转发端点开着，服务端持有 Key。"""
    with make_client(relay_token="relay-secret") as test_client:
        yield test_client

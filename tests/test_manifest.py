# -*- coding: utf-8 -*-
"""manifest 静态校验。

这个文件存在的理由很具体：插件曾经在 MV3 下整条链路静默死掉，根因就是两个
manifest 都只声明了 `permissions: ["storage"]`，没有 `host_permissions`
——service worker 去抓字幕、去调模型接口全被浏览器拦掉，而错误只在后台
控制台里，页面上什么反应都没有。人眼很难发现这类缺失，所以让测试盯着。

同样地，360 那份 manifest 曾经漏掉 markmap 依赖，也在这里兜住。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "chrome-extension"
MANIFESTS = ["manifest.json", "manifest_360.json"]


def load(name: str) -> dict:
    return json.loads((EXT / name).read_text(encoding="utf-8"))


@pytest.fixture(params=MANIFESTS)
def manifest(request):
    return request.param, load(request.param)


def resolve(entry: str) -> list[Path]:
    """把 manifest 里的路径（可能是 glob）落到真实文件上。"""
    return sorted(EXT.glob(entry)) if "*" in entry else ([EXT / entry] if (EXT / entry).exists() else [])


def test_is_valid_mv3(manifest):
    name, data = manifest
    assert data["manifest_version"] == 3, name
    assert data["name"] and data["description"], name
    assert data["version"].count(".") == 2, f"{name} 版本号要形如 0.4.0"


def test_host_permissions_cover_every_network_call(manifest):
    """抓字幕、取视频信息、调模型——三处域名一个都不能少。"""
    name, data = manifest
    hosts = " ".join(data.get("host_permissions") or [])
    assert "api.bilibili.com" in hosts, f"{name} 缺 B 站 API 权限"
    assert "hdslb.com" in hosts, f"{name} 缺字幕域名权限（字幕全在 hdslb 上）"
    assert "api.deepseek.com" in hosts, f"{name} 缺模型接口权限"


def test_optional_permissions_allow_custom_endpoint(manifest):
    """自定义接口地址要能在设置页里现场申请，对应 issue #6 #7 #9。"""
    name, data = manifest
    optional = " ".join(data.get("optional_host_permissions") or [])
    assert "https://*/*" in optional, f"{name} 没放开自定义 https 接口"
    assert "127.0.0.1" in optional and "localhost" in optional, f"{name} 没放开本地自建服务"


def test_background_worker_exists(manifest):
    name, data = manifest
    worker = data["background"]["service_worker"]
    assert (EXT / worker).exists(), f"{name} 指向的 {worker} 不存在"


def test_every_declared_asset_exists(manifest):
    name, data = manifest
    missing = []
    for script in data.get("content_scripts", []):
        for entry in script.get("js", []) + script.get("css", []):
            if not resolve(entry):
                missing.append(entry)
    for entry in (data.get("icons") or {}).values():
        if not resolve(entry):
            missing.append(entry)
    for resource in data.get("web_accessible_resources", []):
        for entry in resource.get("resources", []):
            if not resolve(entry):
                missing.append(entry)
    popup = (data.get("action") or {}).get("default_popup")
    if popup and not resolve(popup):
        missing.append(popup)
    assert not missing, f"{name} 引用了不存在的文件: {missing}"


def test_content_scripts_are_not_empty_files(manifest):
    """0 字节的依赖会让页面白屏，而 manifest 校验和语法检查都发现不了。"""
    name, data = manifest
    empty = [
        entry
        for script in data.get("content_scripts", [])
        for entry in script.get("js", [])
        if (EXT / entry).exists() and (EXT / entry).stat().st_size == 0
    ]
    assert not empty, f"{name} 里有空文件: {empty}"


def test_load_order_is_sane(manifest):
    """content.js 依赖前面几个脚本定义的全局，必须排在最后。"""
    name, data = manifest
    js = data["content_scripts"][0]["js"]
    assert js[-1] == "content-scripts/content.js", f"{name} 里 content.js 不在最后"
    assert "scripts/biliapi.js" in js and "scripts/ui.js" in js, name
    assert len(js) == len(set(js)), f"{name} 有重复脚本"


def test_two_manifests_do_not_drift():
    """chrome 版和 360 版只该在图标、更新地址上不同，脚本清单必须一致。"""
    chrome = load("manifest.json")
    qihoo = load("manifest_360.json")

    assert chrome["version"] == qihoo["version"], "两个 manifest 版本号不一致"
    assert chrome["content_scripts"][0]["js"] == qihoo["content_scripts"][0]["js"], "两个版本的脚本清单已经漂移"
    assert chrome.get("host_permissions") == qihoo.get("host_permissions"), "两个版本的权限声明已经漂移"
    assert chrome.get("permissions") == qihoo.get("permissions")


def test_popup_is_wired():
    html = (EXT / "popup" / "popup.html").read_text(encoding="utf-8")
    script = (EXT / "popup" / "popup.js").read_text(encoding="utf-8")

    assert "popup.js" in html
    for field in ("api-key", "api-base", "api-model"):
        assert f'id="{field}"' in html, f"设置页缺 {field} 输入框"
    assert "deepseek-flash" in script, "默认模型不是 deepseek-flash"
    assert "chrome.permissions.request" in script, "自定义域名没有走可选权限申请"

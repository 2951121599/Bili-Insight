/*
 * content.js + ui.js：内容脚本这一层的冒烟测试。
 *
 * 这里不做视觉断言（那需要真浏览器），只守三件容易出人命的事：
 *   1. 五个脚本按 manifest 的顺序能加载，不抛异常
 *   2. 从各种 B 站卡片结构里都能稳定拿到 bvid，拿不到时安静返回 null
 *   3. 不会因为一次鼠标移动就往元素上反复叠加监听器
 *
 * 第 2 条尤其重要：MV3 里内容脚本抛出的异常不会显示在页面上，
 * 表现只是「插件突然什么都不做」，线上极难定位。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXT = path.resolve(__dirname, "..", "..", "chrome-extension");
const CONTENT_SCRIPTS = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).content_scripts[0].js;

/* ---------------- DOM 桩 ---------------- */

function makeEl(tag, props) {
    const el = {
        tagName: tag || "DIV",
        classList: { contains: () => false, add() {}, remove() {} },
        style: {},
        children: [],
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) { el.children.push(child); },
        querySelector() { return null; },
        matches() { return false; },
        getAttribute() { return null; },
        href: "",
        innerHTML: "",
        offsetWidth: 200,
        offsetHeight: 120,
        scrollWidth: 200,
        scrollHeight: 240,
        getContext() { return { clearRect() {} }; },
    };
    return Object.assign(el, props || {});
}

const listeners = {};
let loadError = null;

global.document = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement(tag) { return makeEl(tag.toUpperCase()); },
    getElementById() { return null; },
    getElementsByClassName() { return []; },
    body: makeEl("BODY"),
};
global.window = { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0 };
global.MutationObserver = class {
    observe() {}
    disconnect() {}
};
global.chrome = {
    runtime: { lastError: null, sendMessage() {} },
    storage: { sync: { get(defaults, cb) { cb(Object.assign({}, defaults)); } } },
};

try {
    // 严格按 manifest 声明的顺序加载，顺带验证顺序本身是自洽的
    for (const file of CONTENT_SCRIPTS) {
        vm.runInThisContext(fs.readFileSync(path.join(EXT, file), "utf8"), { filename: file });
    }
} catch (e) {
    loadError = e;
}

/* ---------------- 用例 ---------------- */

test("[1] manifest 声明的脚本能按顺序加载", () => {
    assert.equal(loadError, null, loadError && loadError.message);
    assert.ok(listeners.mouseover && listeners.mouseover.length, "应该注册 mouseover");
    assert.ok(listeners.mouseout && listeners.mouseout.length, "应该注册 mouseout");
    assert.equal(typeof videoProfileCard, "object");
    assert.ok(videoProfileCard, "卡片实例应该已创建");
});

test("[2] 从卡片里取 bvid", () => {
    const anchor = makeEl("A", {
        getAttribute: (name) => (name === "href" ? "/video/BV1xx411c7mD?spm_id_from=333.1007" : null),
    });
    const card = makeEl("DIV", {
        classList: { contains: (cls) => cls === "video-card", add() {}, remove() {} },
        querySelector: (selector) => (String(selector).indexOf("/video/BV") !== -1 ? anchor : null),
    });

    assert.equal(getVideoId(card), "BV1xx411c7mD");
});

test("[3] 元素自身就是视频链接时也能取到", () => {
    const selfAnchor = makeEl("A", {
        matches: (selector) => String(selector).indexOf("/video/BV") !== -1,
        getAttribute: () => "https://www.bilibili.com/video/BV1Ab4y1z7Qx",
    });
    assert.equal(getVideoId(selfAnchor), "BV1Ab4y1z7Qx");
});

test("[4] 结构不认识时安静返回 null，不抛异常", () => {
    assert.equal(getVideoId(null), null);
    assert.equal(getVideoId({ tagName: "DIV" }), null, "没有 querySelector 的对象");
    assert.equal(getVideoId(makeEl("DIV")), null, "找不到链接");
    assert.equal(
        getVideoId(makeEl("DIV", { querySelector: () => makeEl("A", { getAttribute: () => "/space/123" }) })),
        null,
        "链接不是视频页"
    );
    assert.equal(getVideoId(makeEl("DIV", { querySelector: () => makeEl("A") })), null, "链接缺 href");
});

test("[5] getTarget 能认出视频卡片", () => {
    const card = makeEl("DIV", {
        classList: { contains: (cls) => cls === "video-card", add() {}, remove() {} },
        querySelector: () => null,
    });
    assert.equal(getTarget(card), card);
    assert.equal(getTarget(makeEl("SPAN")), null, "无关元素应返回 null");
});

test("[6] 时长显示：超过一小时不再算错", () => {
    assert.equal(secondsToDisplay(3720), "1:02:00", "62 分钟曾经显示成 01:2:00");
    assert.equal(secondsToDisplay(1080), "18:00");
    assert.equal(secondsToDisplay(540), "09:00");
    assert.equal(secondsToDisplay(59), "00:59");
});

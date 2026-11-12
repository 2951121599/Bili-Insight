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

/* ---------------- 要点的时间戳 ---------------- */

test("[7] 时间戳：0 秒也要显示成 00:00", () => {
    // secondsToDisplay(0) 返回数字 0（当空值处理），拿来渲染时间戳会出裸的「0」
    assert.equal(secondsToClock(0), "00:00");
    assert.equal(secondsToClock(750), "12:30");
    assert.equal(secondsToClock(3720), "1:02:00");
    assert.equal(secondsToClock(-5), "00:00");
});

test("[8] 要点带秒数时渲染成可点的时间戳", () => {
    const html = renderPoint({ text: "C 款性价比最高", at: 750 });
    assert.match(html, /class="idc-point-time"/);
    assert.match(html, /data-at="750"/);
    assert.match(html, /12:30/);
    assert.match(html, /C 款性价比最高/);
});

test("[9] 没有秒数的要点不渲染时间戳", () => {
    assert.equal(renderPoint("老格式要点"), "<li>老格式要点</li>");
    assert.equal(renderPoint({ text: "缺秒数" }), "<li>缺秒数</li>");
    assert.equal(renderPoint({ text: "零值也算有效", at: 0 }),
        '<li class="has-time"><button type="button" class="idc-point-time" data-at="0" title="从这个位置开始看">00:00</button>零值也算有效</li>');
});

test("[10] 要点里的 HTML 会被转义", () => {
    const html = renderPoint({ text: "<img src=x onerror=alert(1)>", at: 10 });
    assert.equal(html.indexOf("<img"), -1, html);
    assert.match(html, /&lt;img/);
});

test("[11] 当前就在播放页时直接 seek 播放器，不重开页面", () => {
    const player = { currentTime: 0, played: false, play() { player.played = true; } };
    const savedLocation = global.location;
    const savedQuery = document.querySelector;
    const savedScroll = window.scrollTo;
    let scrolled = 0;

    try {
        global.location = { pathname: "/video/BV1xx411c7mD", search: "" };
        document.querySelector = (selector) => (selector === "video" ? player : null);
        window.scrollTo = () => { scrolled++; };

        videoProfileCard.videoId = "BV1xx411c7mD";
        videoProfileCard.jumpTo(750);

        assert.equal(player.currentTime, 750, "应该直接跳到对应秒数");
        assert.equal(player.played, true);
        assert.equal(scrolled, 1, "跳转后要把播放器滚回视野");
    } finally {
        global.location = savedLocation;
        document.querySelector = savedQuery;
        window.scrollTo = savedScroll;
        if (savedLocation === undefined) delete global.location;
    }
});

test("[12] 不在播放页时新标签打开带 t 参数的地址", () => {
    const savedOpen = window.open;
    let opened = "";
    try {
        window.open = (url) => { opened = url; };
        videoProfileCard.videoId = "BV9zz411c7mD";
        videoProfileCard.jumpTo(90);

        assert.equal(opened, "https://www.bilibili.com/video/BV9zz411c7mD?t=90");
    } finally {
        window.open = savedOpen;
    }
});

test("[13] 没有 videoId 时不乱跳", () => {
    const savedOpen = window.open;
    let opened = null;
    try {
        window.open = (url) => { opened = url; };
        videoProfileCard.videoId = null;
        videoProfileCard.jumpTo(90);
        assert.equal(opened, null);
    } finally {
        window.open = savedOpen;
    }
});

test("[14] 指针在自己的卡片里时不当成滑走", () => {
    const inner = makeEl("BUTTON");
    const card = videoProfileCard.el;
    card.contains = (node) => node === inner;
    try {
        assert.equal(typeof isInsideCard, "function");
        assert.equal(isInsideCard(inner), true);
        assert.equal(isInsideCard(makeEl("DIV")), false);
    } finally {
        delete card.contains;
    }
});

/* ---------------- 脑图 svg 的定位方式 ---------------- */

test("[15] 卡片模板给脑图 svg 留了 id，不再靠 class 顺序取", () => {
    const html = getVideoProfileCardHTML({});
    assert.match(html, /id="biliinsight-markmap-svg"/);
    assert.match(html, /class="markmap markmap-wrapper"/, "外层容器的 class 不能动，CSS 依赖它");
});

test("[16] markmapSvg 只在自己卡片子树内按 id 查", () => {
    const card = videoProfileCard.el;
    const fakeSvg = makeEl("SVG");
    const seen = [];
    const saved = card.querySelector;
    card.querySelector = (selector) => {
        seen.push(String(selector));
        return String(selector) === "#biliinsight-markmap-svg" ? fakeSvg : null;
    };
    try {
        assert.equal(videoProfileCard.markmapSvg(), fakeSvg);
        assert.deepEqual(seen, ["#biliinsight-markmap-svg"], "应该只按 id 查一次，不退回 class 选择器");
    } finally {
        card.querySelector = saved;
    }
});

test("[17] 卡片元素还没建好时安静返回 null", () => {
    const savedEl = videoProfileCard.el;
    try {
        videoProfileCard.el = null;
        assert.equal(videoProfileCard.markmapSvg(), null);
    } finally {
        videoProfileCard.el = savedEl;
    }
});

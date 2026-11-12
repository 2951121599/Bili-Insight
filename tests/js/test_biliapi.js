/*
 * biliapi.js：请求编排层。
 *
 * 这一层决定「一次悬停到底花几次钱」。四个断言值得长期守住：
 *   - 一次悬停只发一条 summary
 *   - 同一个视频没算完时再悬停，挂到同一请求上而不是再发一条
 *   - 从 A 滑到 B 时，A 的请求要真的被 abort
 *   - 字幕响应的形状必须能对上（data.body 是数组），否则永远「无字幕」
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..", "chrome-extension");

/* ---------------- chrome 桩 ---------------- */

let messages = [];
const pendingSummary = new Map();
let subtitleResponse = { body: [{ content: "第一句", from: 0, to: 2 }, { content: "第二句", from: 2, to: 4 }] };

global.chrome = {
    runtime: {
        lastError: null,
        sendMessage(raw, cb) {
            const msg = JSON.parse(raw);
            messages.push(msg);
            if (msg.type === "subtitleUrl") {
                setTimeout(() => cb(subtitleResponse), 0);
                return;
            }
            if (msg.type === "abort") {
                setTimeout(() => cb({ canceled: true }), 0);
                return;
            }
            if (msg.type === "summary") {
                // 不立刻回，交给用例自己控制时序
                pendingSummary.set(msg.requestId, cb);
            }
        },
    },
    storage: { sync: { get(defaults, cb) { cb(Object.assign({}, defaults)); } } },
};

global.biliInsightOptions = { enableWordCloud: false, minSize: 5 };
global.userInfoCache = new Map();

for (const file of ["scripts/constants.js", "scripts/md5.js", "scripts/biliapi.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
}

/* ---------------- 工具 ---------------- */

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const summaryMessages = () => messages.filter((msg) => msg.type === "summary");

function fakeVideo(id) {
    return {
        bvid: id,
        title: "标题 " + id,
        duration: 600,
        desc: "简介",
        tname: "科技",
        tid: 188,
        pubdate: 1700000000,
        stat: { view: 1000, like: 10, coin: 1, favorite: 2, share: 3, reply: 4, danmaku: 5 },
        subtitleUrl: "//aisubtitle.hdslb.com/x.json",
    };
}

const RESULT = {
    verdict: "watch",
    score: 88,
    summary: "一句话结论",
    points: ["要点一", "要点二"],
    signals: { density: "高", audience: "全部", duplication: "低", cost: "10 分钟" },
    outline: "# 大纲\n- 一级",
};

// 每个用例开头先清场：掐掉上一个用例可能遗留的在飞请求，并清空消息记录
function begin() {
    cancelPendingRequest();
    messages = [];
}

function resolveSummary(requestId, data) {
    const cb = pendingSummary.get(requestId);
    if (cb) {
        pendingSummary.delete(requestId);
        cb(data);
    }
}

/* ---------------- 用例 ---------------- */

test("[1] 一次悬停只发一条模型请求", async () => {
    begin();
    global.getVideo = async () => fakeVideo("BV1aa");
    const received = [];
    updateVideoInfo("BV1aa", (data) => received.push(data));
    await tick(60);

    assert.equal(summaryMessages().length, 1, "结论与大纲必须共用一条请求");
    const first = summaryMessages()[0];
    assert.ok(first.requestId, "消息必须带 requestId，否则没法取消");
    assert.equal(first.videoId, "BV1aa");
    assert.equal(first.payload.transcript, "第一句\n第二句", "字幕应该被拼成一段");
    assert.ok(received.some((d) => d.api === "stats"), "互动数据要先到，不等模型");

    resolveSummary(first.requestId, RESULT);
    await tick(30);

    assert.ok(received.some((d) => d.api === "info"));
    assert.ok(received.some((d) => d.api === "markmap" && d.payload.data === RESULT.outline), "脑图由同一次响应驱动");
    assert.equal(received.find((d) => d.api === "info").payload.data.summary, "一句话结论");
});

test("[1b] 字幕响应多包一层时，宁可当无字幕也不能崩", async () => {
    // 真实事故：后台曾返回 { body: { body: [...] } }，导致所有视频都被判成无字幕
    begin();
    global.userInfoCache.delete("BV1zz");
    const saved = subtitleResponse;
    subtitleResponse = { body: { body: [{ content: "嵌套错误" }] } };
    global.getVideo = async () => fakeVideo("BV1zz");

    const received = [];
    updateVideoInfo("BV1zz", (data) => received.push(data));
    await tick(60);

    const msg = summaryMessages()[0];
    assert.ok(!msg.payload.transcript, "读不到数组时不该拼出字幕");
    resolveSummary(msg.requestId, RESULT);
    await tick(20);
    subtitleResponse = saved;
});

test("[2] 同一视频重复悬停不重复请求", async () => {
    begin();
    updateVideoInfo("BV1aa", () => {});
    await tick(40);
    assert.equal(summaryMessages().length, 0, "内存缓存命中时不该再发请求");
});

test("[3] 从 A 滑到 B 会取消 A", async () => {
    begin();
    global.getVideo = async () => fakeVideo("BV2bb");
    updateVideoInfo("BV2bb", () => {});
    await tick(60);

    const bReq = summaryMessages()[0];
    assert.ok(bReq, "B 的请求应该发出");

    global.getVideo = async () => fakeVideo("BV3cc");
    updateVideoInfo("BV3cc", () => {});
    await tick(60);

    const abortMsg = messages.find((msg) => msg.type === "abort");
    assert.ok(abortMsg, "滑走时必须发 abort");
    assert.equal(abortMsg.requestId, bReq.requestId, "abort 要指向 B 的请求");

    resolveSummary(bReq.requestId, { canceled: true });
    await tick(20);
    const cached = global.userInfoCache.get("BV2bb");
    assert.ok(!cached || !cached.info, "被取消的结果不能写进缓存");
});

test("[4] 同一视频请求未回时再悬停，挂到同一请求上", async () => {
    begin();
    global.getVideo = async () => fakeVideo("BV4dd");
    const first = [];
    const second = [];

    updateVideoInfo("BV4dd", (data) => first.push(data));
    await tick(50);
    updateVideoInfo("BV4dd", (data) => second.push(data));
    await tick(30);

    assert.equal(summaryMessages().length, 1, "第二个悬停不该再发请求");

    resolveSummary(summaryMessages()[0].requestId, RESULT);
    await tick(30);

    assert.ok(first.some((d) => d.api === "info"), "第一个订阅者要拿到结论");
    assert.ok(second.some((d) => d.api === "info"), "第二个订阅者也要拿到结论");
});

test("[5] 取不到视频信息时不抛异常", async () => {
    begin();
    global.getVideo = async () => null;

    updateVideoInfo("BV5ee", () => {});
    await tick(30);

    assert.equal(summaryMessages().length, 0, "没有视频信息就不该发模型请求");
});

test("[6] getVideo 抛错不会留下僵尸状态", async () => {
    begin();
    global.getVideo = async () => {
        throw new Error("网络炸了");
    };

    updateVideoInfo("BV6ee", () => {});
    await tick(30);

    // 再悬停一次必须还能正常工作，不能被上一次的 promise 卡住
    global.getVideo = async () => fakeVideo("BV6ee");
    updateVideoInfo("BV6ee", () => {});
    await tick(60);

    assert.equal(summaryMessages().length, 1, "失败后应该能重试");
});

test("[7] cancelPendingRequest 幂等", async () => {
    begin();
    global.getVideo = async () => fakeVideo("BV7ff");
    updateVideoInfo("BV7ff", () => {});
    await tick(50);

    cancelPendingRequest();
    cancelPendingRequest();
    await tick(20);

    assert.equal(messages.filter((msg) => msg.type === "abort").length, 1, "重复调用只该发一次 abort");
});

test("[8] 无字幕视频直接走降级，不去抓字幕", async () => {
    begin();
    const video = fakeVideo("BV8gg");
    delete video.subtitleUrl;
    global.getVideo = async () => video;

    updateVideoInfo("BV8gg", () => {});
    await tick(60);

    assert.equal(messages.filter((msg) => msg.type === "subtitleUrl").length, 0, "没有字幕地址就不该去请求");
    assert.equal(summaryMessages().length, 1, "仍然要给出判断");
});

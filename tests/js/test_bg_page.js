/*
 * bg_page.js（service worker）的行为测试。
 *
 * 这里是整个插件最容易静默坏掉的一层：所有网络请求都在后台，
 * 出错只留在 service worker 的控制台里，用户在页面上什么也看不到。
 * 所以断言集中在四件事上——只发一次请求、缓存真的生效、
 * 429/5xx 会退避、滑走时真的能掐断。
 *
 * 用 vm.runInThisContext 加载真实源码，不复制粘贴实现。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const BG = path.join(ROOT, "chrome-extension", "bg_page.js");

const DEFAULT_RESULT = {
    verdict: "watch",
    score: 82,
    one_line: "讲清了 WBI 签名的来龙去脉",
    points: ["签名的 OE 表是固定置换", "w_rid 由 md5 生成"],
    signals: { density: "高", audience: "写爬虫的人", duplication: "低", cost: "18 分钟，值得完整看" },
    outline: "# WBI 签名\n- OE 置换表\n  - 固定 64 位\n- w_rid 生成",
};

/* ---------------- chrome / fetch 桩 ---------------- */

const store = {};
let handler = null;
let fetchCalls = 0;
let queue = [];
let lastBody = null;
let syncSettings = { apiKey: "test-key", apiBase: "https://api.test", apiModel: "deepseek-flash" };

global.chrome = {
    runtime: { onMessage: { addListener(fn) { handler = fn; } } },
    storage: {
        sync: { get(defaults, cb) { cb(Object.assign({}, defaults, syncSettings)); } },
        local: {
            get(keys, cb) {
                const out = {};
                for (const key of [].concat(keys)) {
                    if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
                }
                cb(out);
            },
            set(patch, cb) { Object.assign(store, patch); if (cb) cb(); },
            remove(keys, cb) { [].concat(keys).forEach((key) => delete store[key]); if (cb) cb(); },
        },
    },
};

global.fetch = async function (url, opts) {
    fetchCalls++;
    try {
        if (opts && opts.body) lastBody = JSON.parse(opts.body);
    } catch (e) {
        lastBody = null;
    }
    const next = queue.shift();
    if (next) return next(url, opts);
    return okResponse(JSON.stringify({ choices: [{ message: { content: JSON.stringify(DEFAULT_RESULT) } }] }));
};

vm.runInThisContext(fs.readFileSync(BG, "utf8"), { filename: "bg_page.js" });

/* ---------------- 工具 ---------------- */

function okResponse(body) {
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
}

function errResponse(status, detail, headers) {
    return {
        ok: false,
        status,
        headers: { get: (key) => (headers && headers[key]) || null },
        text: async () => JSON.stringify({ error: { message: detail || "boom" } }),
    };
}

function send(msg) {
    return new Promise((resolve) => handler(JSON.stringify(msg), {}, resolve));
}

const payload = {
    title: "WBI 签名怎么算",
    owner: "某 UP",
    tname: "科技",
    duration: 1080,
    transcript: "这里是字幕内容",
};

/* ---------------- 用例 ---------------- */

test("[1] 一次请求同时拿到结论与大纲", async () => {
    const before = fetchCalls;
    const r = await send({ type: "summary", method: "verdict", videoId: "BV1aa", requestId: "r1", payload });

    assert.equal(r.verdict, "watch");
    assert.equal(r.score, 82);
    assert.equal(Array.isArray(r.points) && r.points.length, 2);
    assert.ok(r.outline.startsWith("# "), r.outline);
    assert.ok(r.outline.split("\n").length <= 12);
    assert.equal(r.caveat, "", "有字幕时不该带 caveat");
    assert.equal(fetchCalls - before, 1, "结论与大纲必须共用一次模型调用");

    assert.equal(lastBody.thinking.type, "disabled", "悬停场景必须关掉思考模式");
    assert.equal(lastBody.response_format.type, "json_object");
    assert.equal(lastBody.max_tokens, 1200);
    assert.match(JSON.stringify(lastBody), /outline/, "提示词必须要求 outline 字段");
});

test("[2] 同一视频第二次悬停走缓存", async () => {
    const before = fetchCalls;
    const r = await send({ type: "summary", method: "verdict", videoId: "BV1aa", requestId: "r2", payload });

    assert.equal(r.cached, true);
    assert.equal(r.verdict, "watch");
    assert.ok(r.outline.startsWith("# "));
    assert.equal(fetchCalls, before, "命中缓存时不该再打模型");
});

test("[3] 429 会退避后重试成功", async () => {
    const before = fetchCalls;
    const started = Date.now();
    queue = [
        () => errResponse(429, "rate limited"),
        () => okResponse(JSON.stringify({ choices: [{ message: { content: JSON.stringify(DEFAULT_RESULT) } }] })),
    ];

    const r = await send({ type: "summary", method: "verdict", videoId: "BV1bb", requestId: "r3", payload });

    assert.equal(r.verdict, "watch");
    assert.equal(fetchCalls - before, 2, "应该重试一次");
    assert.ok(Date.now() - started >= 500, "应该真的等待过");
});

test("[3b] 尊重 Retry-After，但不超过 5 秒上限", async () => {
    queue = [
        () => errResponse(429, "slow down", { "Retry-After": "0.2" }),
        () => okResponse(JSON.stringify({ choices: [{ message: { content: JSON.stringify(DEFAULT_RESULT) } }] })),
    ];
    const started = Date.now();
    const r = await send({ type: "summary", method: "verdict", videoId: "BV1b2", requestId: "r3b", payload });
    const elapsed = Date.now() - started;

    assert.equal(r.verdict, "watch");
    assert.ok(elapsed >= 180, `应至少等 200ms，实际 ${elapsed}`);
    assert.ok(elapsed < 900, `应早于默认退避 600ms 之后重试，实际 ${elapsed}`);
});

test("[4] 连续 5xx 给出可读错误且不写缓存", async () => {
    const before = fetchCalls;
    queue = [() => errResponse(503, "busy"), () => errResponse(503, "busy"), () => errResponse(503, "busy")];

    const r = await send({ type: "summary", method: "verdict", videoId: "BV1cc", requestId: "r4", payload });

    assert.ok(r.error, "应该有 error 字段");
    assert.match(r.error, /模型服务异常/);
    assert.equal(fetchCalls - before, 3, "重试上限是 3 次尝试");
    assert.ok(!Object.keys(store).some((key) => key.includes("BV1cc")), "失败结果不能进缓存");
});

test("[4b] 401 提示去改 Key，而不是重试", async () => {
    const before = fetchCalls;
    queue = [() => errResponse(401, "invalid key")];

    const r = await send({ type: "summary", method: "verdict", videoId: "BV1c2", requestId: "r4b", payload });

    assert.match(r.error, /API Key 无效/);
    assert.equal(fetchCalls - before, 1, "401 重试没有意义");
});

test("[4c] 接口返回非 JSON 时给出定向提示", async () => {
    queue = [() => okResponse("<html>404 page</html>")];
    const r = await send({ type: "summary", method: "verdict", videoId: "BV1c3", requestId: "r4c", payload });
    assert.match(r.error, /不是 JSON/);
});

test("[5] 滑走时取消在飞的请求", async () => {
    queue = [
        (url, opts) => new Promise((resolve, reject) => {
            opts.signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
            });
        }),
    ];

    const pending = send({ type: "summary", method: "verdict", videoId: "BV1dd", requestId: "r5", payload });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const aborted = await send({ type: "abort", requestId: "r5" });
    assert.equal(aborted.canceled, true);

    const r = await pending;
    assert.equal(r.canceled, true, "被取消的请求要原样返回 canceled");
    assert.ok(!Object.keys(store).some((key) => key.includes("BV1dd")), "取消不能写缓存");
});

test("[6] 无字幕降级 + 脏数据兜底", async () => {
    queue = [
        () => okResponse(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({ verdict: "WATCH", score: 999, points: "not-array", outline: "- 只有列表没有标题" }),
                },
            }],
        })),
    ];

    const r = await send({
        type: "summary",
        method: "verdict",
        videoId: "BV1ee",
        requestId: "r6",
        payload: { title: "只有标题", transcript: "" },
    });

    assert.equal(r.verdict, "watch", "verdict 应该被归一成小写");
    assert.equal(r.score, 100, "分数应该被夹到 100");
    assert.deepEqual(r.points, [], "非数组 points 应该被吞掉");
    assert.match(r.caveat, /无字幕/);
    assert.ok(r.outline.startsWith("# "), "缺一级标题时应自动补");
});

test("[6b] 模型输出被 markdown 围栏包住也能解析", async () => {
    queue = [() => okResponse(JSON.stringify({
        choices: [{ message: { content: "```json\n" + JSON.stringify(DEFAULT_RESULT) + "\n```" } }],
    }))];
    const r = await send({ type: "summary", method: "verdict", videoId: "BV1e2", requestId: "r6b", payload });
    assert.equal(r.verdict, "watch");
});

test("[7] 未配置 Key 时提示去填", async () => {
    const saved = syncSettings;
    syncSettings = { apiKey: "", apiBase: "https://api.test", apiModel: "deepseek-flash" };
    const before = fetchCalls;

    const r = await send({ type: "summary", method: "verdict", videoId: "BV1ff", payload });

    assert.match(r.error, /API Key/);
    assert.equal(fetchCalls, before, "没 Key 不该发请求");
    syncSettings = saved;
});

test("[8] 旧版单请求大纲接口仍然可用", async () => {
    queue = [() => okResponse(JSON.stringify({ choices: [{ message: { content: "```markdown\n# WBI 签名\n- OE 置换\n```" } }] }))];
    const r = await send({ type: "summary", method: "markmap", requestId: "r8", payload });
    assert.ok(r.summary.startsWith("# "), r.summary);
    assert.equal(lastBody.response_format, undefined, "大纲路径不该开 json_object");
});

test("[9] 缓存版本号变了就失效", async () => {
    const key = buildCacheKey("BV9vv", { apiModel: "deepseek-flash" });
    store[key] = { v: PROMPT_VERSION - 1, t: Date.now(), data: { verdict: "skip", summary: "旧提示词的结果" } };

    const before = fetchCalls;
    const r = await send({ type: "summary", method: "verdict", videoId: "BV9vv", requestId: "r9", payload });

    assert.equal(fetchCalls - before, 1, "旧版本缓存必须重新请求");
    assert.equal(r.verdict, "watch");
});

test("[10] 过期缓存不复用", async () => {
    const key = buildCacheKey("BV9ww", { apiModel: "deepseek-flash" });
    store[key] = { v: PROMPT_VERSION, t: Date.now() - CACHE_TTL_MS - 1000, data: { verdict: "skip" } };

    const before = fetchCalls;
    const r = await send({ type: "summary", method: "verdict", videoId: "BV9ww", requestId: "r10", payload });

    assert.equal(fetchCalls - before, 1, "过期缓存必须重新请求");
    assert.equal(r.verdict, "watch");
    assert.equal(r.cached, undefined, "重新算出来的结果不该带 cached 标记");
    assert.equal(store[key].data.verdict, "watch", "新结果应该覆盖掉过期项");
});

test("[11] 字幕接口原样透传，data.body 必须是数组", async () => {
    queue = [() => ({
        ok: true,
        status: 200,
        json: async () => ({ body: [{ content: "第一句", from: 0, to: 3 }] }),
    })];
    const result = await send({ type: "subtitleUrl", url: "https://aisubtitle.hdslb.com/a.json" });
    // 这一条曾经被写成 onSuccess({ body: json })，多包了一层，
    // 结果内容脚本永远读不到数组，所有视频都降级成「无字幕」。
    assert.ok(Array.isArray(result.body), "data.body 必须直接是字幕数组");
    assert.equal(result.body[0].content, "第一句");

    assert.deepEqual(await send({ type: "subtitleUrl" }), { body: null });

    queue = [() => ({ ok: false, status: 403, json: async () => ({}) })];
    const failed = await send({ type: "subtitleUrl", url: "https://aisubtitle.hdslb.com/b.json" });
    assert.equal(failed.body, null);
    assert.match(failed.error, /403/);
});

test("[12] 坏消息体不会让 service worker 挂掉", async () => {
    const bad = await new Promise((resolve) => handler("{ this is not json", {}, resolve));
    assert.match(bad.error, /消息格式错误/);

    const unknown = await send({ type: "whatever" });
    assert.match(unknown.error, /未知请求类型/);
});

test("[13] 时长格式化", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(1080), "18:00");
    assert.equal(formatDuration(3720), "1:02:00");
});

/* ---------------- 要点的时间戳 ---------------- */

test("[14] 要点带 at 时原样保留，超出时长要夹住", () => {
    const points = normalizePoints(
        [
            { text: "开头就讲结论", at: 0 },
            { text: "实测对比", at: 135 },
            { text: "模型算飞了", at: 99999 },
        ],
        600
    );

    assert.deepEqual(points, [
        { text: "开头就讲结论", at: 0 },
        { text: "实测对比", at: 135 },
        { text: "模型算飞了", at: 600 },
    ]);
});

test("[15] 老格式字符串要点也能兼容", () => {
    assert.deepEqual(normalizePoints(["纯字符串要点"], 600), [{ text: "纯字符串要点", at: null }]);
});

test("[16] 字符串里带 [mm:ss] 前缀会被抽成 at", () => {
    assert.deepEqual(normalizePoints(["[12:30] C 款性价比最高"], 1080), [
        { text: "C 款性价比最高", at: 750 },
    ]);
    // 超过一小时的写法也算对
    assert.deepEqual(normalizePoints(["[1:02:00] 收尾总结"], 7200), [
        { text: "收尾总结", at: 3720 },
    ]);
});

test("[17] 没有 at 就不该伪造时间戳", () => {
    assert.deepEqual(normalizePoints([{ text: "没有秒数" }], 600), [{ text: "没有秒数", at: null }]);
    assert.deepEqual(normalizePoints([{ text: "零值也要保留", at: 0 }], 600), [
        { text: "零值也要保留", at: 0 },
    ]);
    assert.deepEqual(normalizePoints("not-an-array", 600), []);
});

test("[18] 模型给了超过 4 条要点只留前 4 条", () => {
    const points = normalizePoints(
        Array.from({ length: 9 }, (_, i) => ({ text: `要点${i}`, at: i * 10 })),
        600
    );
    assert.equal(points.length, 4);
});

test("[19] 提示词要求时间戳，且字幕按类型说明", () => {
    assert.match(VERDICT_SYSTEM_PROMPT, /\[mm:ss\]/, "提示词必须告诉模型字幕行首有时间戳");
    assert.match(VERDICT_SYSTEM_PROMPT, /"at"/, "提示词必须要求 at 字段");

    const aiText = buildUserContent({ title: "t", transcript: "[00:00] 一句", subtitleKind: "ai" });
    assert.match(aiText, /AI 识别字幕/, "AI 字幕要提示可能有同音错字");

    const humanText = buildUserContent({ title: "t", transcript: "[00:00] 一句", subtitleKind: "human" });
    assert.match(humanText, /人工校对字幕/);
    assert.doesNotMatch(humanText, /AI 识别/);
});

test("[20] AI 字幕的结论要带 caveat", () => {
    const result = normalizeVerdict({ verdict: "watch", score: 80 }, {
        title: "t",
        duration: 600,
        transcript: "[00:00] 一句",
        subtitleKind: "ai",
    });
    assert.equal(result.caveat, "AI 字幕 · 识别可能有错字");
});

test("[21] 超长字幕保留结尾", () => {
    const text = "开".repeat(50000) + "尾".repeat(50000);
    const clipped = clipTranscript(text, 1000);

    assert.ok(clipped.startsWith("开"), "首段要保留");
    assert.ok(clipped.endsWith("尾"), "结论通常在结尾，不能砍掉");
    assert.match(clipped, /中间省略/);
    assert.equal(clipped.length < text.length, true);
});

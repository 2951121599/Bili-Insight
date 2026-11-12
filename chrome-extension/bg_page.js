/*
 * Bili Insight 后台 service worker
 *
 * 只负责三件事：
 *   1. 代内容脚本抓字幕 JSON —— MV3 下 service worker 的跨域 fetch 受 host_permissions 约束
 *   2. 用用户自己的 Key 调用 OpenAI 兼容接口，一次调用同时产出结论与脑图大纲
 *   3. 把结论按 bvid + 模型缓存到 chrome.storage.local，重复悬停不再付第二遍钱
 *
 * 不再经过任何第三方中转服务，Key 只存在本地 chrome.storage。
 */

const DEFAULT_API_BASE = "https://api.deepseek.com";
const DEFAULT_API_MODEL = "deepseek-flash";
const REQUEST_TIMEOUT_MS = 45000;
// 字幕每行现在带 [mm:ss] 前缀，同样的时长会比以前长一截，所以额度上调
const MAX_TRANSCRIPT_CHARS = 80000;

// 提示词或响应结构改了就加一，旧缓存自动失效
const PROMPT_VERSION = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const CACHE_PREFIX = "bi:c:";
const CACHE_INDEX_KEY = "bi:c:index";

// 429 / 5xx 值得重试，其余状态码重试只是浪费时间
const RETRY_STATUS = [429, 500, 502, 503, 504];
const MAX_RETRIES = 2;

const VERDICT_SYSTEM_PROMPT = `你是浏览器插件里的视频内容审稿编辑。用户把鼠标悬停在 B 站视频卡片上，只想知道一件事：这个视频值不值得花时间看，以及从第几分钟开始看。

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

只依据给定材料判断，不要编造视频里没出现的内容。如果没有字幕，只能依据标题、简介和分区做保守推断，并把 score 压低。`;

// 仅用于兼容旧版内容脚本单独请求大纲
const OUTLINE_SYSTEM_PROMPT = `你是浏览器插件里的内容结构化助手。请把视频内容整理成适合 markmap 渲染的 Markdown 脑图大纲。

要求：
- 只输出 Markdown，不要代码块包裹，不要任何解释
- 第一行是一级标题，格式为 "# 不超过 15 字的主旨"
- 用无序列表 - 展开层级，最多三层
- 一级节点不超过 5 个，总行数不超过 12 行
- 每个节点是精简短语，不要完整句子，不要重复

只依据给定材料，不要编造视频里没出现的内容。`;

// requestId -> AbortController，内容脚本滑走时可以真的把请求掐掉
const activeRequests = new Map();

chrome.runtime.onMessage.addListener(function (raw, sender, onSuccess) {
    let data;
    try {
        data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
        onSuccess({ summary: "", error: "消息格式错误" });
        return true;
    }

    if (data.type === "subtitleUrl") {
        getSubtitleUrl(data, onSuccess);
    } else if (data.type === "summary") {
        getSummary(data, onSuccess);
    } else if (data.type === "abort") {
        abortRequest(data.requestId);
        onSuccess({ canceled: true });
    } else {
        onSuccess({ summary: "", error: "未知请求类型" });
    }
    return true; // 异步响应
});

function abortRequest(requestId) {
    const controller = requestId && activeRequests.get(requestId);
    if (controller) {
        activeRequests.delete(requestId);
        // signal.reason 在旧内核上可能拿不到，用自有标记兜底
        controller.__canceled = true;
        try {
            controller.abort("cancel");
        } catch (e) {
            // 已经结束的请求，忽略
        }
    }
}

/* ---------------- 字幕 ---------------- */

const ALLOWED_SUBTITLE_HOSTS = [/(^|\.)hdslb\.com$/, /(^|\.)bilibili\.com$/];

function isAllowedSubtitleUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" &&
            ALLOWED_SUBTITLE_HOSTS.some((re) => re.test(parsed.hostname));
    } catch (e) {
        return false;
    }
}

async function getSubtitleUrl(data, onSuccess) {
    if (!data.url) {
        onSuccess({ body: null });
        return;
    }
    if (!isAllowedSubtitleUrl(data.url)) {
        onSuccess({ body: null, error: "非法的字幕地址" });
        return;
    }
    try {
        const resp = await fetch(data.url);
        if (!resp.ok) {
            onSuccess({ body: null, error: `字幕请求失败 HTTP ${resp.status}` });
            return;
        }
        // 必须原样透传：字幕接口返回的就是 { body: [{ content, from, to }, ...] }，
        // 内容脚本直接读 data.body。再包一层就永远是「无字幕」。
        const json = await resp.json();
        onSuccess(json && typeof json === "object" ? json : { body: null });
    } catch (e) {
        onSuccess({ body: null, error: String(e) });
    }
}

/* ---------------- 总结 ---------------- */

async function getSummary(data, onSuccess) {
    let settings;
    try {
        settings = await loadSettings();
    } catch (e) {
        onSuccess({ summary: "", error: "读取设置失败" });
        return;
    }

    if (!settings.apiKey) {
        onSuccess({ summary: "", error: "未配置 API Key，点扩展图标填写后重试" });
        return;
    }

    try {
        if (data.method === "markmap") {
            const outline = await callOutline(settings, data.payload, data.requestId);
            onSuccess({ summary: outline });
            return;
        }

        const cacheKey = data.videoId ? buildCacheKey(data.videoId, settings) : "";
        if (cacheKey) {
            const cached = await readCache(cacheKey);
            if (cached) {
                onSuccess(cached);
                return;
            }
        }

        const result = await callVerdict(settings, data.payload, data.requestId);
        if (!result.canceled && cacheKey) {
            writeCache(cacheKey, result);
        }
        onSuccess(result);
    } catch (e) {
        onSuccess({ summary: "", error: (e && e.message) || String(e) });
    }
}

function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            apiKey: "",
            apiBase: DEFAULT_API_BASE,
            apiModel: DEFAULT_API_MODEL,
        }, (items) => resolve(items));
    });
}

async function callVerdict(settings, payload, requestId) {
    const raw = await callChat(
        settings,
        [
            { role: "system", content: VERDICT_SYSTEM_PROMPT },
            { role: "user", content: buildUserContent(payload) },
        ],
        { response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 1200 },
        requestId
    );

    if (raw === CANCELED) {
        return { canceled: true, summary: "" };
    }

    const parsed = parseJsonLoose(raw);
    if (!parsed) {
        throw new Error("模型输出无法解析为 JSON，可换个模型再试");
    }
    return normalizeVerdict(parsed, payload);
}

async function callOutline(settings, payload, requestId) {
    const raw = await callChat(
        settings,
        [
            { role: "system", content: OUTLINE_SYSTEM_PROMPT },
            { role: "user", content: buildUserContent(payload) },
        ],
        { temperature: 0.3, max_tokens: 700 },
        requestId
    );
    return raw === CANCELED ? "" : stripCodeFence(raw);
}

/* ---------------- 结果缓存 ---------------- */

function buildCacheKey(videoId, settings) {
    const model = String(settings.apiModel || DEFAULT_API_MODEL).trim();
    return `${CACHE_PREFIX}${videoId}:${model}:${PROMPT_VERSION}`;
}

function readCache(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key, CACHE_INDEX_KEY], (items) => {
            const entry = items && items[key];
            if (!entry || entry.v !== PROMPT_VERSION || !entry.data) {
                resolve(null);
                return;
            }
            if (Date.now() - (entry.t || 0) > CACHE_TTL_MS) {
                chrome.storage.local.remove(key);
                resolve(null);
                return;
            }
            resolve(Object.assign({}, entry.data, { cached: true }));
        });
    });
}

function writeCache(key, value) {
    return new Promise((resolve) => {
        const now = Date.now();
        chrome.storage.local.get(CACHE_INDEX_KEY, (items) => {
            const stored = items && items[CACHE_INDEX_KEY];
            const index = Array.isArray(stored) ? stored : [];
            // 顺手淘汰过期项和同名旧项
            const next = index.filter((row) => row && row[0] !== key && now - (row[1] || 0) <= CACHE_TTL_MS);
            next.push([key, now]);
            const dropped = next.length > CACHE_MAX_ENTRIES
                ? next.splice(0, next.length - CACHE_MAX_ENTRIES)
                : [];

            const patch = {};
            patch[key] = { v: PROMPT_VERSION, t: now, data: value };
            patch[CACHE_INDEX_KEY] = next;

            chrome.storage.local.set(patch, () => {
                if (!dropped.length) {
                    resolve();
                    return;
                }
                chrome.storage.local.remove(dropped.map((row) => row[0]), () => resolve());
            });
        });
    });
}

/* ---------------- 通用调用 ---------------- */

const CANCELED = "__canceled__";

async function callChat(settings, messages, extra, requestId) {
    const base = String(settings.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
    const controller = new AbortController();
    if (requestId) {
        activeRequests.set(requestId, controller);
    }
    const timer = setTimeout(() => {
        try {
            controller.abort("timeout");
        } catch (e) {
            // 忽略
        }
    }, REQUEST_TIMEOUT_MS);

    const body = JSON.stringify(Object.assign({
        model: settings.apiModel || DEFAULT_API_MODEL,
        messages: messages,
        stream: false,
        // 悬停场景要低延迟，显式关掉思考模式（DeepSeek 默认是开启的）
        thinking: { type: "disabled" },
    }, extra || {}));

    try {
        let lastStatus = 0;
        let lastDetail = "";

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            let resp;
            let text;
            try {
                resp = await fetch(`${base}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${settings.apiKey}`,
                    },
                    body: body,
                    signal: controller.signal,
                });
                text = await resp.text();
            } catch (e) {
                if (isAbort(e)) {
                    return abortOutcome(controller);
                }
                if (attempt >= MAX_RETRIES) {
                    throw new Error("网络请求失败，请检查网络或「接口地址」是否可达");
                }
                await sleep(backoffDelay(attempt), controller);
                continue;
            }

            if (resp.ok) {
                return extractContent(text);
            }

            lastStatus = resp.status;
            lastDetail = errorDetail(text);
            if (RETRY_STATUS.indexOf(resp.status) === -1 || attempt >= MAX_RETRIES) {
                throw new Error(friendlyError(lastStatus, lastDetail));
            }
            await sleep(retryDelay(resp, attempt), controller);
        }

        throw new Error(friendlyError(lastStatus || 0, lastDetail));
    } finally {
        clearTimeout(timer);
        if (requestId) {
            activeRequests.delete(requestId);
        }
    }
}

function isAbort(err) {
    return !!err && (err.name === "AbortError" || err.code === 20);
}

function abortOutcome(controller) {
    if (controller.__canceled || controller.signal.reason === "cancel") {
        return CANCELED;
    }
    throw new Error("请求超时，稍后再试或换个更快的模型");
}

function backoffDelay(attempt) {
    // 600ms、1200ms，加一点抖动避免多标签页同时重试
    return 600 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
}

function retryDelay(resp, attempt) {
    const header = resp.headers && resp.headers.get && resp.headers.get("Retry-After");
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
        // 服务端要求的等待时间最多认 5 秒，否则悬停体验会崩
        return Math.min(seconds * 1000, 5000);
    }
    return backoffDelay(attempt);
}

function sleep(ms, controller) {
    // 等待期间被取消就直接返回，让下一轮 fetch 抛 AbortError 走统一出口
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (controller && controller.signal) {
            controller.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        }
    });
}

function extractContent(text) {
    let json = null;
    try {
        json = JSON.parse(text);
    } catch (e) {
        // 保持 null，下面统一报错
    }
    if (!json) {
        throw new Error("接口返回的不是 JSON，请检查「接口地址」是否指向 OpenAI 兼容服务");
    }
    const choice = (json.choices || [])[0];
    const content = choice && choice.message && choice.message.content;
    if (!content) {
        throw new Error("模型没有返回内容");
    }
    return content;
}

function errorDetail(text) {
    try {
        const json = JSON.parse(text);
        const err = json && json.error;
        if (err) {
            return String(err.message || err).slice(0, 200);
        }
    } catch (e) {
        // 不是 JSON，退回纯文本
    }
    return String(text || "").slice(0, 200);
}

function friendlyError(status, detail) {
    if (status === 401 || status === 403) return "API Key 无效或没有权限，请检查插件设置";
    if (status === 402) return "账户余额不足，请到模型平台充值";
    if (status === 404) return "接口地址不存在，请检查「接口地址」是否填对";
    if (status === 429) return "请求过于频繁，稍后再试";
    if (status >= 500) return `模型服务异常（${status}），稍后再试`;
    return detail ? `请求被拒绝（${status}）：${detail}` : `请求被拒绝（${status}）`;
}

/* ---------------- 数据结构 ---------------- */

/*
 * 超长字幕保留首尾，而不是砍掉结尾。
 * 一小时以上的访谈、直播回放，前半段都在铺垫，「所以结论是」全在最后几分钟里。
 */
function clipTranscript(text, limit) {
    const s = String(text || "");
    const cap = limit || MAX_TRANSCRIPT_CHARS;
    if (s.length <= cap) {
        return s;
    }
    const head = Math.floor((cap * 7) / 10);
    const tail = cap - head;
    return `${s.slice(0, head)}\n…（中间省略 ${s.length - cap} 个字符）…\n${s.slice(-tail)}`;
}

function buildUserContent(payload) {
    const p = payload || {};
    const stat = p.stat || {};
    const lines = [];

    lines.push(`【标题】${p.title || "（空）"}`);
    if (p.owner) lines.push(`【UP 主】${p.owner}`);
    if (p.tname) lines.push(`【分区】${p.tname}`);
    lines.push(`【时长】${formatDuration(p.duration)}`);
    if (p.pubdate) {
        lines.push(`【发布】${new Date(p.pubdate * 1000).toISOString().slice(0, 10)}`);
    }
    lines.push(`【数据】播放 ${stat.view || 0} · 点赞 ${stat.like || 0} · 投币 ${stat.coin || 0} · 收藏 ${stat.favorite || 0} · 分享 ${stat.share || 0} · 评论 ${stat.reply || 0} · 弹幕 ${stat.danmaku || 0}`);
    if (p.desc) lines.push(`【简介】${p.desc}`);

    const transcript = clipTranscript(p.transcript);
    lines.push("");
    if (transcript) {
        if (p.subtitleKind === "ai") {
            lines.push("【字幕类型】B 站 AI 识别字幕，可能有同音错字，遇到明显不通的地方按上下文理解");
        } else if (p.subtitleKind === "human") {
            lines.push("【字幕类型】UP 主上传或人工校对字幕");
        }
        lines.push(`【字幕】\n${transcript}`);
    } else {
        lines.push("【字幕】（本视频没有可用字幕）");
    }
    return lines.join("\n");
}

const CLOCK_PREFIX = /^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*/;
const DEFAULT_DURATION_LIMIT = 86400;

// 从 "[12:30] xxx" 里取秒数，取不到返回 null
function parseClock(text) {
    const match = CLOCK_PREFIX.exec(String(text || ""));
    if (!match) {
        return null;
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (match[3] === undefined) {
        return first * 60 + second;
    }
    return first * 3600 + second * 60 + Number(match[3]);
}

/*
 * points 统一成 [{text, at}]，at 是秒数或 null。
 * 模型可能给老格式的字符串，也可能给 {text, at}；字符串带 [mm:ss] 前缀时抽出来当 at。
 * at 夹到视频时长内——模型偶尔会算出超过时长的秒数，点过去是空进度。
 */
function normalizePoints(raw, duration) {
    if (!Array.isArray(raw)) {
        return [];
    }
    let limit = Math.floor(Number(duration) || 0);
    if (limit <= 0) {
        limit = DEFAULT_DURATION_LIMIT;
    }

    const points = [];
    for (const item of raw) {
        let at = null;
        let text = "";
        if (item && typeof item === "object") {
            text = String(item.text || item.point || "").trim();
            const parsedAt = Number(item.at);
            at = Number.isFinite(parsedAt) ? Math.round(parsedAt) : null;
        } else {
            text = String(item || "").trim();
        }
        if (!text) {
            continue;
        }
        if (at === null) {
            at = parseClock(text);
        }
        if (at === null) {
            points.push({ text: text, at: null });
        } else {
            points.push({
                text: text.replace(CLOCK_PREFIX, "").trim(),
                at: Math.max(0, Math.min(limit, at)),
            });
        }
        if (points.length === 4) {
            break;
        }
    }
    return points;
}

function normalizeVerdict(parsed, payload) {
    let score = Number(parsed.score);
    score = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50;

    let verdict = String(parsed.verdict || "").toLowerCase();
    if (["watch", "skim", "skip"].indexOf(verdict) === -1) {
        verdict = score >= 70 ? "watch" : score >= 40 ? "skim" : "skip";
    }

    const signals = parsed.signals || {};
    const p = payload || {};
    const hasTranscript = !!String(p.transcript || "").trim();
    let caveat = "";
    if (!hasTranscript) {
        caveat = "无字幕 · 仅依据标题与简介推断";
    } else if (p.subtitleKind === "ai") {
        caveat = "AI 字幕 · 识别可能有错字";
    }

    return {
        verdict: verdict,
        score: score,
        summary: String(parsed.one_line || parsed.summary || "").trim(),
        points: normalizePoints(parsed.points, p.duration),
        signals: {
            density: String(signals.density || ""),
            audience: String(signals.audience || ""),
            duplication: String(signals.duplication || ""),
            cost: String(signals.cost || ""),
        },
        outline: normalizeOutline(parsed.outline),
        caveat: caveat,
    };
}

function normalizeOutline(value) {
    let text = Array.isArray(value) ? value.join("\n") : String(value || "");
    text = stripCodeFence(text).trim();
    if (!text) {
        return "";
    }
    let lines = text.split("\n").filter((line) => line.trim());
    // markmap 需要一级标题当根节点，模型漏了就补一个
    if (lines[0].indexOf("#") !== 0) {
        lines.unshift("# 内容大纲");
    }
    return lines.slice(0, 12).join("\n");
}

function parseJsonLoose(text) {
    const s = stripCodeFence(text);
    try {
        return JSON.parse(s);
    } catch (e) {
        const start = s.indexOf("{");
        const end = s.lastIndexOf("}");
        if (start !== -1 && end > start) {
            try {
                return JSON.parse(s.slice(start, end + 1));
            } catch (e2) {
                return null;
            }
        }
        return null;
    }
}

function stripCodeFence(text) {
    let s = String(text || "").trim();
    if (s.startsWith("```")) {
        s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
    }
    return s;
}

function formatDuration(sec) {
    const total = Number(sec) || 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

const BILIBILI_API_URL = "https://api.bilibili.com"
const NUM_PER_PAGE = 50

/*
 * Bilibili http request util
 */

var biliMixin = null;

async function getBiliMixin() {
    const OE = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45,
        35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
        41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60,
        51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
        20, 34, 44, 52];

    return fetch("https://api.bilibili.com/x/web-interface/nav")
        .then((response) => response.json())
        .then((data) => {
            let img_val = data.data.wbi_img.img_url.split("/").pop().split(".")[0];
            let sub_val = data.data.wbi_img.sub_url.split("/").pop().split(".")[0];
            let val = img_val + sub_val;
            return OE.reduce((s, v) => s + val[v], "").substring(0, 32);
        });
}

async function biliGet(url, params) {
    if (biliMixin === null) {
        biliMixin = await getBiliMixin();
    }

    if (url.indexOf("/wbi/") != -1) {
        // convert params to url in a sorted order
        params["wts"] = Math.floor(Date.now() / 1000);
        let keys = Object.keys(params).sort();
        let paramsStr = keys.map((key) => `${key}=${params[key]}`).join("&");
        let sign = md5(paramsStr + biliMixin);
        url = `${url}?${paramsStr}&w_rid=${sign}`;
    } else {
        let keys = Object.keys(params).sort();
        let paramsStr = keys.map((key) => `${key}=${params[key]}`).join("&");
        url = `${url}?${paramsStr}`;
    }

    return fetch(url, { "credentials": "include", "mode": "cors" })
        .then((response) => response.json())
        .then((data) => {
            if (data['code'] == -403) {
                biliMixin = null;
            }
            return data;
        });
}

async function getVideo(bvid) {
    const data = await biliGet(`${BILIBILI_API_URL}/x/web-interface/view`, {
        bvid: bvid
    });
    return (data || {})["data"] || null;
}

/*
 * 字幕候选的优先级：人工中文 CC > AI 中文 > 其它语言人工 > 其它语言 AI。
 * 人工 CC 断句准、术语对，AI 字幕会有同音错字，所以哪怕多一次请求也优先人工。
 */
function describeSubtitle(item) {
    if (!item) {
        return null;
    }
    const url = normalizeSubtitleUrl(item["subtitle_url"] || "");
    const lan = String(item["lan"] || "");
    // 弹幕转字幕不是真正的台词，不要
    if (!url || lan === "danmaku") {
        return null;
    }
    const isAI = Number(item["ai_type"]) === 1 || /^ai-/i.test(lan);
    return {
        url: url,
        lan: lan,
        isAI: isAI,
        isChinese: /^zh/i.test(lan) || /^ai-zh/i.test(lan),
        label: String(item["lan_doc"] || lan || (isAI ? "AI 字幕" : "字幕")),
    };
}

function subtitleRank(sub) {
    if (sub.isChinese && !sub.isAI) {
        return 0;
    }
    if (sub.isChinese) {
        return 1;
    }
    return sub.isAI ? 3 : 2;
}

function pickBestSubtitle(candidates) {
    const usable = (candidates || []).filter(Boolean);
    if (!usable.length) {
        return null;
    }
    return usable.slice().sort((a, b) => subtitleRank(a) - subtitleRank(b))[0];
}

/*
 * 分P 视频每 P 有自己的 cid 和字幕。视频页带 ?p=N 时跟着当前 P，
 * 列表页悬停则取第一 P（用户还没选 P，第一 P 最能代表这个视频）。
 */
function currentCid(video) {
    const pages = (video && video["pages"]) || [];
    if (!pages.length) {
        return (video && video["cid"]) || 0;
    }
    let index = 0;
    if (typeof location !== "undefined" && location && location.search) {
        const match = String(location.search).match(/[?&]p=(\d+)/);
        if (match) {
            const p = Number(match[1]) - 1;
            if (p >= 0 && p < pages.length) {
                index = p;
            }
        }
    }
    return pages[index]["cid"] || (video && video["cid"]) || 0;
}

/*
 * 字幕来源有两处，缺一不可：
 *   - /x/web-interface/view 的 subtitle.list：只覆盖部分场景，分P 和纯 AI 字幕经常是空的
 *   - /x/player/wbi/v2 的 subtitle.subtitles：按 cid 给全量，含 ai_type 标记
 * player 接口要登录态，没登录会返回 code != 0，此时退回 view 的结果。
 */
async function getSubtitleCandidates(video) {
    const candidates = [];
    const fromView = ((video && video["subtitle"]) || {})["list"] || [];
    for (const item of fromView) {
        const described = describeSubtitle(item);
        if (described) {
            candidates.push(described);
        }
    }

    const cid = currentCid(video);
    if (cid) {
        try {
            const data = await biliGet(`${BILIBILI_API_URL}/x/player/wbi/v2`, {
                bvid: (video && video["bvid"]) || "",
                cid: cid,
            });
            const playerSubs = (((data || {})["data"] || {})["subtitle"] || {})["subtitles"] || [];
            for (const item of playerSubs) {
                const described = describeSubtitle(item);
                if (described) {
                    candidates.push(described);
                }
            }
        } catch (e) {
            // player 接口挂了不影响主流程，view 的结果兜底
        }
    }

    const seen = new Set();
    return candidates.filter((sub) => {
        if (seen.has(sub.url)) {
            return false;
        }
        seen.add(sub.url);
        return true;
    });
}


userInfoCache = new Map();

// 当前在跑的模型请求；悬停滑走时用它把请求掐掉，省一次 token
let activeRequest = null;
// bvid -> [callback]，同一个视频还在算时，后来的悬停挂上去等结果
const pendingByVideo = new Map();

function nextRequestId() {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cancelPendingRequest() {
    if (!activeRequest) {
        return;
    }
    const requestId = activeRequest.requestId;
    const videoId = activeRequest.videoId;
    activeRequest = null;
    pendingByVideo.delete(videoId);
    try {
        chrome.runtime.sendMessage(JSON.stringify({ type: "abort", requestId }), () => {
            // 读一下 lastError，避免控制台刷 "Unchecked runtime.lastError"
            void chrome.runtime.lastError;
        });
    } catch (e) {
        // service worker 不在，忽略
    }
}

function emit(callbacks, videoId, api, payload) {
    for (const callback of callbacks) {
        try {
            cacheAndUpdate(callback, videoId, api, payload);
        } catch (e) {
            // 单个回调出错不影响其它状态
        }
    }
}

function updateWordMap(map, sentence, weight) {
    // Remove all URLs
    sentence = sentence.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '');

    for (let word of IGNORE_WORDS) {
        sentence = sentence.replaceAll(word, '');
    }

    let results = Array.from(new Intl.Segmenter('cn', { granularity: 'word' }).segment(sentence));
    let wordMap = map.get("word");

    for (let result of results) {
        if (result.isWordLike) {
            let word = result["segment"];
            if (word && !STOP_WORDS.has(word)) {
                if (wordMap.has(word)) {
                    wordMap.set(word, wordMap.get(word) + weight);
                } else {
                    wordMap.set(word, weight);
                }
            }
        }
    }
}

function updateTypeMap(map, type) {
    let typeMap = map.get("type");
    if (typeMap.has(type)) {
        typeMap.set(type, typeMap.get(type) + 1);
    } else {
        typeMap.set(type, 1);
    }
}

function videoLengthStringToSeconds(s) {
    let regex = /([0-9]*):([0-9]*)/;
    let match = s.match(regex);
    if (match) {
        return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    return 0;
}

function convertVideoData(map) {
    let data = {};
    let typeData = Array.from(map.get("type"));

    typeData.sort((a, b) => b[1] - a[1]);

    data["word"] = Array.from(map.get("word"));
    data["type"] = typeData.slice(0, 3);

    return data;
}

function buildWordMap(map, video) {


    if (video["summary"]) {
        updateWordMap(map, video["desc"] || "", 1);
        updateWordMap(map, video["summary"], 1);
    } else {
        updateWordMap(map, video["title"] || "", 1);
        updateWordMap(map, video["desc"] || "", 1);
    }


    updateTypeMap(map, video["tid"]);


}

function updateVideoData(videoId, callbacks, videoData) {
    if (!biliInsightOptions.enableWordCloud) {
        return;
    }
    let map = new Map();
    map.set("word", new Map());
    map.set("type", new Map());

    buildWordMap(map, videoData)
    emit(callbacks, videoId, "wordcloud", convertVideoData(map));
}

function cacheValid(cache) {
    // 词云默认关闭，所以缓存只要求拿到结论；有词云时会一起回放
    return !!cache["info"];
}

function cacheAndUpdate(callback, videoId, api, payload) {
    let cache = {};
    if (!userInfoCache.has(videoId)) {
        userInfoCache.set(videoId, cache);
    } else {
        cache = userInfoCache.get(videoId);
    }
    cache[api] = payload;

    callback({ "uid": videoId, "api": api, "payload": payload });
}

/*
 * 组装给模型的结构化输入。
 * 字幕为空时模型只拿到标题/简介/分区，会走保守推断的降级路径。
 */
function buildPayload(video) {
    const stat = video["stat"] || {};
    return {
        title: video["title"] || "",
        owner: (video["owner"] && video["owner"]["name"]) || "",
        tname: video["tname"] || "",
        desc: video["desc"] || "",
        duration: video["duration"] || 0,
        pubdate: video["pubdate"] || 0,
        stat: {
            view: stat["view"] || 0,
            like: stat["like"] || 0,
            coin: stat["coin"] || 0,
            favorite: stat["favorite"] || 0,
            share: stat["share"] || 0,
            reply: stat["reply"] || 0,
            danmaku: stat["danmaku"] || 0,
        },
        transcript: video["transcript"] || "",
        // human / ai / 空；AI 字幕会有同音错字，模型和卡片都要如实标注
        subtitleKind: video["subtitleKind"] || "",
        bvid: video["bvid"] || "",
    };
}

// 互动数据先渲染，不等模型，避免悬停后长时间空白
function updateStats(videoId, callbacks, video) {
    const stat = video["stat"] || {};
    emit(callbacks, videoId, "stats", {
        data: {
            like: stat["like"] || 0,
            coin: stat["coin"] || 0,
            favorite: stat["favorite"] || 0,
            share: stat["share"] || 0,
            pubdate: video["pubdate"] || 0,
            duration: video["duration"] || 0,
        }
    });
}

/*
 * 结论与脑图大纲现在由同一次调用产出。
 * 原来是 requestVerdict + updateMapData 两次请求，同一份字幕发了两次，
 * 首屏多等一个来回，token 也翻倍。
 */
function requestVerdict(videoId, callbacks, video, withOutline) {
    const requestId = nextRequestId();
    activeRequest = { requestId, videoId };

    const finish = (resp) => {
        if (activeRequest && activeRequest.requestId === requestId) {
            activeRequest = null;
        }
        if (pendingByVideo.get(videoId) === callbacks) {
            pendingByVideo.delete(videoId);
        }

        const result = resp || {};
        // 被取消的请求直接丢弃，卡片已经滑到别的视频了
        if (result.canceled) {
            return;
        }

        emit(callbacks, videoId, "info", {
            data: {
                verdict: result.verdict || "",
                score: result.score,
                summary: result.summary || "",
                points: result.points || [],
                signals: result.signals || {},
                caveat: result.error ? result.error : (result.caveat || ""),
            }
        });

        if (withOutline && result.outline) {
            emit(callbacks, videoId, "markmap", { data: result.outline });
        }

        video.summary = result.summary || video["desc"] || "";
        updateVideoData(videoId, callbacks, video);
    };

    chrome.runtime.sendMessage(
        JSON.stringify({
            type: "summary",
            method: "verdict",
            requestId: requestId,
            videoId: videoId,
            payload: buildPayload(video),
        }),
        (data) => {
            if (chrome.runtime.lastError) {
                finish({ error: "后台未响应，刷新页面后重试" });
                return;
            }
            finish(data);
        }
    );
}

function normalizeSubtitleUrl(url) {
    if (!url) {
        return "";
    }
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (url.startsWith("/")) {
        return `https://www.bilibili.com${url}`;
    }
    return url;
}

// 秒 -> mm:ss（超过一小时给 h:mm:ss）
function secondsToClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/*
 * 每句字幕前面带上 [mm:ss]。
 * 这是「要点能跳到第几分钟」的前提：模型只有看到时间标记，才可能输出秒数；
 * 没有标记时它只能凭感觉编一个，跳过去是错的位置。
 */
function buildTranscript(body) {
    const lines = [];
    for (const el of body) {
        const text = String((el && el["content"]) || "").replace(/\s+/g, " ").trim();
        if (!text) {
            continue;
        }
        const at = Number(el && el["from"]);
        lines.push(Number.isFinite(at) ? `[${secondsToClock(at)}] ${text}` : text);
    }
    return lines.join("\n");
}

function updateVideoInfo(videoId, callback) {
    if (userInfoCache.has(videoId) && cacheValid(userInfoCache.get(videoId))) {
        let cache = userInfoCache.get(videoId);
        for (let api in cache) {
            callback({ "uid": videoId, "api": api, "payload": cache[api] });
        }
        return;
    }

    // 从 A 滑到 B：把 A 还在跑的请求掐掉，不为没在看的视频付钱
    if (activeRequest && activeRequest.videoId !== videoId) {
        cancelPendingRequest();
    }

    // 同一个视频还在算的时候又悬停回来，挂上去等结果，别重复发请求
    if (pendingByVideo.has(videoId)) {
        pendingByVideo.get(videoId).push(callback);
        return;
    }

    const callbacks = [callback];
    pendingByVideo.set(videoId, callbacks);

    getVideo(videoId).then(async (video) => {
        if (!video) {
            pendingByVideo.delete(videoId);
            return
        }
        // bvid 兜底：view 接口正常会带，但万一缺失就用卡片上的
        if (!video["bvid"]) {
            video["bvid"] = videoId;
        }

        // 先渲染互动数据，不等模型
        updateStats(videoId, callbacks, video);

        const subtitle = pickBestSubtitle(await getSubtitleCandidates(video));
        if (!subtitle) {
            // 无字幕：用标题 + 简介做轻量判断，卡片上会标注「无字幕」
            updateUI(videoId, callbacks, video, false);
            return
        }

        video.subtitleUrl = subtitle.url;
        video.subtitleKind = subtitle.isAI ? "ai" : "human";

        chrome.runtime.sendMessage( //goes to bg_page.js
            JSON.stringify({
                type: 'subtitleUrl',
                url: subtitle.url,
            }),
            (data) => {
                if (chrome.runtime.lastError) {
                    pendingByVideo.delete(videoId);
                    return;
                }
                const body = data && data["body"];
                if (Array.isArray(body) && body.length) {
                    video.transcript = buildTranscript(body);
                }
                updateUI(videoId, callbacks, video, !!video.transcript);
            } //your callback
        );
    }).catch(() => {
        pendingByVideo.delete(videoId);
    })
}


function updateUI(videoId, callbacks, video, withOutline) {
    requestVerdict(videoId, callbacks, video, withOutline);
}

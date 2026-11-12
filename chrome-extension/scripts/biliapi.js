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
    return await biliGet(`${BILIBILI_API_URL}/x/web-interface/view`, {
        bvid: bvid
    })
        .then((data) => {
            let video = data["data"]
            if (!video) {
                return
            }
            // subtitle 字段在无字幕视频上可能整个缺失，也可能 list 为空
            const subtitle = video["subtitle"];
            const subList = (subtitle && subtitle["list"]) || [];
            if (subList.length && subList[0]["subtitle_url"]) {
                video.subtitleUrl = subList[0]["subtitle_url"];
            }
            return video;
        })
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

    getVideo(videoId).then((video) => {
        if (!video) {
            pendingByVideo.delete(videoId);
            return
        }

        // 先渲染互动数据，不等模型
        updateStats(videoId, callbacks, video);

        if (!video.subtitleUrl) {
            // 无字幕：用标题 + 简介做轻量判断，卡片上会标注「无字幕」
            updateUI(videoId, callbacks, video, false);
            return
        }

        chrome.runtime.sendMessage( //goes to bg_page.js
            JSON.stringify({
                type: 'subtitleUrl',
                url: normalizeSubtitleUrl(video.subtitleUrl),
            }),
            (data) => {
                if (chrome.runtime.lastError) {
                    pendingByVideo.delete(videoId);
                    return;
                }
                const body = data && data["body"];
                if (Array.isArray(body) && body.length) {
                    video.transcript = body
                        .map((el) => el["content"] || "")
                        .join("\n")
                        .trim();
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

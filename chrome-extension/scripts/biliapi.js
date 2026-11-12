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

function updateVideoData(videoId, callback, videoData) {
    let map = new Map();
    map.set("word", new Map());
    map.set("type", new Map());


    buildWordMap(map, videoData)
    if (biliInsightOptions.enableWordCloud) {
        cacheAndUpdate(callback, videoId, "wordcloud", convertVideoData(map));
    }
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
function updateStats(videoId, callback, video) {
    const stat = video["stat"] || {};
    cacheAndUpdate(callback, videoId, "stats", {
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

function requestVerdict(videoId, callback, video) {
    chrome.runtime.sendMessage( //goes to bg_page.js
        JSON.stringify({
            type: 'summary',
            method: 'verdict',
            payload: buildPayload(video),
        }),
        (data) => {
            const resp = data || {};
            cacheAndUpdate(callback, videoId, "info", {
                data: {
                    verdict: resp.verdict || "",
                    score: resp.score,
                    summary: resp.summary || "",
                    points: resp.points || [],
                    signals: resp.signals || {},
                    caveat: resp.error ? resp.error : (resp.caveat || ""),
                }
            })
            video.summary = resp.summary || video["desc"] || "";
            updateVideoData(videoId, callback, video);
        }
    );
}

function updateMapData(videoId, callback, video) {
    chrome.runtime.sendMessage( //goes to bg_page.js
        JSON.stringify({
            type: 'summary',
            method: 'markmap',
            payload: buildPayload(video),
        }),
        (data) => {
            if (!data || !data.summary) {
                return
            }
            cacheAndUpdate(callback, videoId, "markmap", {
                data: data.summary
            })
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

    getVideo(videoId).then((video) => {
        if (!video) {
            return
        }

        // 先渲染互动数据，不等模型
        updateStats(videoId, callback, video);

        if (!video.subtitleUrl) {
            // 无字幕：用标题 + 简介做轻量判断，卡片上会标注「无字幕」
            updateUI(videoId, callback, video, false);
            return
        }

        chrome.runtime.sendMessage( //goes to bg_page.js
            JSON.stringify({
                type: 'subtitleUrl',
                url: normalizeSubtitleUrl(video.subtitleUrl),
            }),
            (data) => {
                const body = data && data["body"];
                if (Array.isArray(body) && body.length) {
                    video.transcript = body
                        .map((el) => el["content"] || "")
                        .join("\n")
                        .trim();
                }
                updateUI(videoId, callback, video, !!video.transcript);
            } //your callback
        );
    })
}


function updateUI(videoId, callback, video, withMarkmap) {
    requestVerdict(videoId, callback, video);
    if (withMarkmap) {
        updateMapData(videoId, callback, video);
    }
}

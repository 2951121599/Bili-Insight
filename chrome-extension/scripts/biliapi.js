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
            let subList = data["data"]["subtitle"]["list"]
            if (subList.length) {
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
        updateWordMap(map, video["desc"], 1);
        updateWordMap(map, video["summary"], 1);
    } else {
        updateWordMap(map, video["title"], 1);
        updateWordMap(map, video["desc"], 1);
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
    for (let key of ["info", "wordcloud"]) {
        if (!cache[key]) {
            return false;
        }
    }
    return true;
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

function updateVideoInfo(videoId, callback) {
    this._prevVideoId = null;

    if (this._prevVideoId != videoId) {
        if (userInfoCache.has(videoId) && cacheValid(userInfoCache.get(videoId))) {
            let cache = userInfoCache.get(videoId);
            for (let api in cache) {
                callback({ "uid": videoId, "api": api, "payload": cache[api] });
            }
        } else {

            getVideo(videoId).then((video) => {
                let subtitleUrl = video.subtitleUrl
                if (subtitleUrl) {
                    // 标题和描述
                    // 云图
                    updateUI(videoId, callback, video)
                    chrome.runtime.sendMessage( //goes to bg_page.js
                        JSON.stringify({
                            type: 'subtitleUrl',
                            url: subtitleUrl,
                        }),
                        (data) => {
                            let rawSubTitles = data["body"]
                            var rawTranscript = []
                            rawSubTitles.forEach(element => {
                                rawTranscript.push(element["content"])
                            });
                            let longText = rawTranscript.join("\n")
                            video.transcript = longText
                            updateUI(videoId, callback, video)

                        } //your callback
                    );

                } else {
                    // has not  subtitle
                    updateUI(videoId, callback, video)
                }
            })



        }
    }
}


function updateUI(videoId, callback, video) {
    let videoData = video

    if (video.transcript) {
        chrome.runtime.sendMessage( //goes to bg_page.js
            JSON.stringify({
                type: 'summary',
                text: video.transcript,
            }),
            (data) => {
                cacheAndUpdate(callback, videoId, "info", {
                    data: {
                        "like": videoData["stat"]["like"],
                        "coin": videoData["stat"]["coin"],
                        "favorite": videoData["stat"]["favorite"],
                        "share": videoData["stat"]["share"],
                        "pubdate": videoData["pubdate"],
                        "duration": videoData["duration"],
                        "summary": data.summary
                    }
                })
                updateVideoData(videoId, callback, videoData);
            } //your callback
        );
    } else {
        cacheAndUpdate(callback, videoId, "info", {
            data: {
                "like": videoData["stat"]["like"],
                "coin": videoData["stat"]["coin"],
                "favorite": videoData["stat"]["favorite"],
                "share": videoData["stat"]["share"],
                "pubdate": videoData["pubdate"],
                "duration": videoData["duration"],
                "summary": videoData["desc"] ? videoData["desc"] : videoData["title"]
            }
        })
        updateVideoData(videoId, callback, videoData);
    }



}
function numberToDisplay(number) {
    if (number > 10000) {
        return `${(number / 10000).toFixed(1)}万`;
    }
    return number;
}

function timestampToDisplay(timestamp) {
    if (timestamp == null) {
        return ""
    }
    let date = new Date(timestamp * 1000);
    let timediff = Date.now() / 1000 - timestamp;
    const hour = 60 * 60;
    const day = 24 * hour;

    if (timediff < hour) {
        return "刚刚";
    } else if (timediff < day) {
        return `${Math.floor(timediff / hour)}小时前`;
    } else if (timediff < 30 * day) {
        return `${Math.floor(timediff / day)}天前`;
    } else {
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
}

function secondsToDisplay(sec) {
    if (!sec) {
        return 0;
    }

    function digitToStr(n) {
        n = Math.floor(n);
        return n < 10 ? "0" + n : n;
    }

    sec = Math.floor(sec);

    if (sec < 60) {
        return `00:${digitToStr(sec)}`;
    } else if (sec < 60 * 60) {
        return `${digitToStr(sec / 60)}:${digitToStr(sec % 60)}`;
    } else {
        // 原来这里把「分钟数」当成（小时*60+分钟）再取模，62 分钟会显示成 01:2:00
        const hours = Math.floor(sec / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        return `${hours}:${digitToStr(minutes)}:${digitToStr(sec % 60)}`;
    }
}



const VERDICT_META = {
    watch: { label: "值得看", cls: "verdict-watch" },
    skim: { label: "扫一眼", cls: "verdict-skim" },
    skip: { label: "跳过", cls: "verdict-skip" },
};

const SIGNAL_LABELS = {
    density: "密度",
    audience: "适合",
    duplication: "同质化",
    cost: "成本",
};

function escapeHtml(value) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value === undefined || value === null ? "" : value)
        .replace(/[&<>"']/g, (ch) => map[ch]);
}

// 「值不值得看」结论区。没有结论时只在有提示（如错误、无字幕）时占位
function getVerdictHTML(data) {
    const meta = VERDICT_META[data["verdict"]];
    if (!meta) {
        if (!data["caveat"]) {
            return "";
        }
        return `
            <div class="idc-verdict">
                <div class="idc-caveat">${escapeHtml(data["caveat"])}</div>
            </div>
        `;
    }

    const score = typeof data["score"] === "number" ? data["score"] : "";
    const points = (data["points"] || [])
        .map((point) => `<li>${escapeHtml(point)}</li>`)
        .join("");
    const signals = data["signals"] || {};
    const signalHTML = ["density", "audience", "duplication", "cost"]
        .filter((key) => signals[key])
        .map((key) => `<span class="idc-signal"><i>${SIGNAL_LABELS[key]}</i>${escapeHtml(signals[key])}</span>`)
        .join("");

    return `
        <div class="idc-verdict">
            <div class="idc-verdict-head">
                <span class="idc-verdict-chip ${meta.cls}">${meta.label}</span>
                ${score === "" ? "" : `<span class="idc-verdict-score">${score}</span>`}
            </div>
            ${data["summary"] ? `<div class="idc-verdict-line">${escapeHtml(data["summary"])}</div>` : ""}
            ${points ? `<ul class="idc-points">${points}</ul>` : ""}
            ${signalHTML ? `<div class="idc-signals">${signalHTML}</div>` : ""}
            ${data["caveat"] ? `<div class="idc-caveat">${escapeHtml(data["caveat"])}</div>` : ""}
        </div>
    `;
}

function getVideoProfileCardDataHTML(data) {
    return `
        ${getVerdictHTML(data)}
        <div class="idc-info clearfix">

            <div class="idc-content h">
                <div class="idc-meta">
                    <span class="idc-meta-item"><data-title>点赞</data-title> ${numberToDisplay(data["like"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>投币</data-title> ${numberToDisplay(data["coin"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>收藏</data-title> ${numberToDisplay(data["favorite"]) || 0}</span>
                </div>
                <div class="idc-meta">
                    <span class="idc-meta-item"><data-title>分享</data-title> ${numberToDisplay(data["share"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>投稿</data-title> ${timestampToDisplay(data["pubdate"])}</span>
                    <span class="idc-meta-item"><data-title>时长</data-title> ${secondsToDisplay(data["duration"])}</span>
                </div>
            </div>
            <div id="tag-list-bi">
            </div>
        </div>
    `
}


function getVideoProfileCardHTML(data) {
    return `
        <div id="biliinsight-video-card" style="position: absolute;">
            <div id="biliinsight-video-card-data-bi">
                ${getVideoProfileCardDataHTML(data)}
            </div>
            <div id="word-cloud-canvas-wrapper-bi">
                <canvas id="word-cloud-canvas-bi" style="width: 100%; height: 0"></canvas>
            </div>
            <div class="markmap markmap-wrapper">
                <svg class="markmap">
                </svg>
            </div>
        </div>
    `
}

function VideoProfileCard() {
    this.videoId = null;
    this.data = {};
    this.cursorX = 0;
    this.cursorY = 0;
    this.target = null;
    this.enabled = false;
    this.wordCloud = null;
    this.el = document.createElement("div");
    this.el.style.position = "absolute";
    this.el.style.display = "none";
    this.el.innerHTML = getVideoProfileCardHTML(this.data);
    this.el.addEventListener("transitionend", () => {
        this.updateCursor(this.cursorX, this.cursorY);
    })

    this.idCardObserver = new MutationObserver((mutationList, observer) => {
        this.clearOriginalCard();
    })

    this.disable();

    document.body.appendChild(this.el);
}

VideoProfileCard.prototype.disable = function () {
    this.videoId = null;
    this.enabled = false;
    this.data = {};
    // 置空 target，配合 updateTarget 的去重判断，下次悬停能重新挂上 mouseleave
    this.target = null;
    // 卡片收了就把还在跑的模型请求一起取消，别为滑走的视频继续计费
    if (typeof cancelPendingRequest === "function") {
        cancelPendingRequest();
    }
    if (this.el) {
        this.el.style.display = "none";
        let canvas = document.getElementById("word-cloud-canvas-bi");
        if (canvas) {
            canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
            canvas.parentNode.classList.remove("canvas-show");
        }
        let svgEl = document.getElementsByClassName('markmap')[1];
        if (svgEl) {
            svgEl.parentNode.classList.remove("canvas-show");
        }

        this.idCardObserver.disconnect();
    }
}

VideoProfileCard.prototype.enable = function () {
    if (!this.enabled) {
        this.enabled = true;
        this.idCardObserver.observe(document.body, {
            "childList": true,
            "subtree": true
        })
        return true;
    }
    return false;
}

VideoProfileCard.prototype.checkTargetValid = function (target) {
    if (this.enabled && this.target) {
        while (target) {
            if (target == this.target) {
                return;
            }
            target = target.parentNode;
        }
        this.disable();
    }
}

VideoProfileCard.prototype.clearOriginalCard = function () {
    while (document.getElementById("id-card")) {
        document.getElementById("id-card").remove();
    }

    for (let card of document.getElementsByClassName("user-card")) {
        card.remove();
    }

    for (let card of document.getElementsByClassName("card-loaded")) {
        card.remove();
    }
}

VideoProfileCard.prototype.updateVideoId = function (videoId) {
    this.videoId = videoId;
}

VideoProfileCard.prototype.updateCursor = function (cursorX, cursorY) {
    const cursorPadding = 10;
    const windowPadding = 20;

    this.cursorX = cursorX;
    this.cursorY = cursorY;

    if (this.el) {
        let width = this.el.scrollWidth;
        let height = this.el.scrollHeight;

        if (this.cursorX + width + windowPadding > window.scrollX + window.innerWidth) {
            // Will overflow to the right, put it on the left
            this.el.style.left = `${this.cursorX - cursorPadding - width}px`;
        } else {
            this.el.style.left = `${this.cursorX + cursorPadding}px`;
        }

        if (this.cursorY + height + windowPadding > window.scrollY + window.innerHeight) {
            // Will overflow to the bottom, put it on the top
            if (this.cursorY - windowPadding - height < window.scrollY) {
                // Can't fit on top either, put it in the middle
                this.el.style.top = `${window.scrollY + (window.innerHeight - height) / 2}px`;
            } else {
                this.el.style.top = `${this.cursorY - cursorPadding - height}px`;
            }
        } else {
            this.el.style.top = `${this.cursorY + cursorPadding}px`;
        }
    }
}

VideoProfileCard.prototype.updateTarget = function (target) {
    // 同一张卡片上反复 mouseover 时不再重复挂 mouseleave，否则监听器会越堆越多
    if (this.target === target) {
        return;
    }
    this.target = target;
    let vpc = this
    this.target.addEventListener("mouseleave", function leaveHandle(ev) {
        vpc.disable();
        this.removeEventListener("mouseleave", leaveHandle);
    })
}

VideoProfileCard.prototype.wordCloudMaxCount = function () {
    return Math.max(...this.data["wordcloud"].map(item => item[1]))
}

VideoProfileCard.prototype.drawVideoTags = function () {
    let tagList = document.getElementById("tag-list-bi");
    tagList.innerHTML = "";
    if (this.data["video_type"]) {
        for (let d of this.data["video_type"]) {
            if (BILIBILI_VIDEO_TYPE_MAP[d[0]]) {
                let el = document.createElement("span");
                el.className = "badge";
                el.innerHTML = BILIBILI_VIDEO_TYPE_MAP[d[0]];
                tagList.appendChild(el);
            }
        }
    }
}

VideoProfileCard.prototype.updateData = function (data) {
    let uid = data["uid"];
    let d = data["payload"];

    if (uid != this.videoId) {
        return;
    }

    if (data["api"] == "stats" || data["api"] == "info") {
        const info = d["data"] || {};
        for (const key of ["like", "coin", "favorite", "share", "pubdate", "duration"]) {
            if (info[key] !== undefined) {
                this.data[key] = info[key];
            }
        }
        if (data["api"] == "info") {
            this.data["verdict"] = info["verdict"] || "";
            this.data["score"] = info["score"];
            this.data["summary"] = info["summary"] || "";
            this.data["points"] = info["points"] || [];
            this.data["signals"] = info["signals"] || {};
            this.data["caveat"] = info["caveat"] || "";
        }
    } else if (data["api"] == "wordcloud") {
        this.data["wordcloud"] = d["word"];
        this.data["video_type"] = d["type"];
    }

    if (data["api"] == "wordcloud") {
        let canvas = document.getElementById("word-cloud-canvas-bi");
        if (this.data["wordcloud"].length > 0) {
            canvas.style.height = "190px";
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;

            canvas.parentNode.classList.add("canvas-show");

            WordCloud(canvas, {
                list: JSON.parse(JSON.stringify(this.data["wordcloud"])),
                backgroundColor: "transparent",
                // 原来按 100/最大权重 放大，最大词能到 100px，会顶出 190px 的画布
                weightFactor: 58 / this.wordCloudMaxCount(),
                shrinkToFit: true,
                minSize: biliInsightOptions.minSize
            });
            this.drawVideoTags();
        } else {
            canvas.style.height = "0px";
            canvas.height = 0;
        }
    } else if (this.data['duration'] !== undefined) {
        // 拿到互动数据就渲染，后续 info 事件会带着结论重绘
        document.getElementById("biliinsight-video-card-data-bi").innerHTML = getVideoProfileCardDataHTML(this.data);
        this.drawVideoTags();
    }
    if (data["api"] == "markmap") {
        let svgEl = document.getElementsByClassName('markmap')[1]
        if (!this.mm) {
            this.mm = markmap.Markmap.create(svgEl);
        }

        let markMapConfig = `---
markmap:
colorFreezeLevel: 2
maxWidth: 300
embedAssets: true
---\n`
        let markmapContext = data.payload.data
        if (markmapContext && data.payload.data.split('\n').length > 12) {
            markmapContext = data.payload.data.split('\n').slice(0, 12).join('\n')
        }
        if (!markmapContext) {
            return
        }
        let { root } = new markmap.Transformer().transform(markMapConfig + markmapContext);
        if (root.children) {
            this.mm.setData(root);
            this.mm.fit();
            svgEl.parentNode.classList.add("canvas-show");
        } else {
            svgEl.parentNode.classList.remove("canvas-show");
        }
    }

    if (this.enabled && this.el && this.el.style.display != "flex") {
        this.clearOriginalCard();
        this.el.style.display = "flex";
    }

    this.updateCursor(this.cursorX, this.cursorY);
}


videoProfileCard = new VideoProfileCard();




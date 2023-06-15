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
        return `${digitToStr(sec / 60 / 60)}:${digitToStr(sec / 60) % 60}:${digitToStr(sec % 60)}`;
    }
}



function getVideoProfileCardDataHTML(data) {
    return `
        <div class="idc-info clearfix">

            <div class="idc-content h">
                <div class="idc-meta">
                    <span class="idc-meta-item"><data-title>点赞</data-title> ${numberToDisplay(data["like"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>投币</data-title> ${numberToDisplay(data["coin"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>收藏</data-title> ${numberToDisplay(data["favorite"]) || 0}</span>
                </div>
                <div class="idc-meta">
                    <span class="idc-meta-item"><data-title>分享</data-title> ${numberToDisplay(data["share"]) || 0}</span>
                    <span class="idc-meta-item"><data-title>投稿时间</data-title> ${timestampToDisplay(data["pubdate"])}</span>
                </div>
                <div class="idc-meta">
                    <span class="idc-meta-item"><data-title>视频长度</data-title> ${secondsToDisplay(data["duration"])}</span>
                </div>
            </div>
            <div id="tag-list-bi">
            </div>
            <div class="description" style="${data["summary"] ? "" : "display: none"}">
                <span style="display: flex">
                总结: ${data["summary"]}
                </span>
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
            <div id="word-cloud-canvas-wrapper">
                <canvas id="word-cloud-canvas-bi" style="width: 100%; height: 0"></canvas>
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
    if (this.el) {
        this.el.style.display = "none";
        let canvas = document.getElementById("word-cloud-canvas-bi");
        if (canvas) {
            canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
            canvas.parentNode.classList.remove("canvas-show");
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
    this.target = target;
    upc = this
    this.target.addEventListener("mouseleave", function leaveHandle(ev) {
        upc.disable();
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

    if (data["api"] == "info") {
        this.data["like"] = d["data"]['like']
        this.data["coin"] = d["data"]['coin']
        this.data["favorite"] = d["data"]['favorite']
        this.data["share"] = d["data"]['share']
        this.data["pubdate"] = d["data"]['pubdate']
        this.data["duration"] = d["data"]['duration']
        this.data["summary"] = d["data"]["summary"];
    } else if (data["api"] == "wordcloud") {
        this.data["wordcloud"] = d["word"];
        this.data["video_type"] = d["type"];
    }

    if (data["api"] == "wordcloud") {
        let canvas = document.getElementById("word-cloud-canvas-bi");
        if (this.data["wordcloud"].length > 0) {
            canvas.style.height = `${canvas.offsetWidth / 2}px`;
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;

            canvas.parentNode.classList.add("canvas-show");

            WordCloud(canvas, {
                list: JSON.parse(JSON.stringify(this.data["wordcloud"])),
                backgroundColor: "transparent",
                weightFactor: 100 / this.wordCloudMaxCount(),
                shrinkToFit: true,
                minSize: biliInsightOptions.minSize
            });
            this.drawVideoTags();
        } else {
            canvas.style.height = "0px";
            canvas.height = 0;
        }
    } else if (this.data['duration']) {
        // if has duration
        document.getElementById("biliinsight-video-card-data-bi").innerHTML = getVideoProfileCardDataHTML(this.data);
        this.drawVideoTags();
    }

    if (this.enabled && this.el && this.el.style.display != "flex") {
        this.clearOriginalCard();
        this.el.style.display = "flex";
    }

    this.updateCursor(this.cursorX, this.cursorY);
}


videoProfileCard = new VideoProfileCard();




document.addEventListener("mouseover", showProfileDebounce);
document.addEventListener("mousemove", (ev) => {
    // 指针在卡片上时不要跟着动，否则刚移到时间戳上卡片就飘走了
    if (videoProfileCard.hovering) {
        return;
    }
    videoProfileCard.updateCursor(ev.pageX, ev.pageY);
});

// 指针是否落在插件自己的卡片里
function isInsideCard(node) {
    const el = videoProfileCard && videoProfileCard.el;
    return !!(el && node && typeof el.contains === "function" && el.contains(node));
}

// 词云默认关掉：判断「值不值得看」用不上它，却会占掉卡片首屏
biliInsightOptions = {
    enableWordCloud: false,
    minSize: 5
}

chrome.storage.sync.get(biliInsightOptions, function (items) {
    biliInsightOptions = items;
});

const VIDEO_LINK_SELECTOR = 'a[href*="/video/BV"]';

function getVideoFromLink(url) {
    if (!url) {
        return null;
    }
    const match = String(url).match(/\/video\/(BV[0-9A-Za-z]+)/);
    return match ? match[1] : null;
}

/*
 * 原来这里是逐层取 childNodes[0].firstChild.href。
 * 只要 B 站稍微改一下 DOM，就会抛 TypeError，而 showProfile 又是异步调用，
 * 异常被 promise 吞掉，表现就是「插件突然什么都不做了」。
 * 改成在卡片范围内找视频链接，找不到就返回 null。
 */
function getVideoId(target) {
    if (!target || typeof target.querySelector !== "function") {
        return null;
    }
    let link = null;
    if (target.matches && target.matches(VIDEO_LINK_SELECTOR)) {
        link = target;
    } else {
        link = target.querySelector(VIDEO_LINK_SELECTOR);
    }
    if (!link) {
        return null;
    }
    return getVideoFromLink(link.getAttribute("href") || link.href);
}

function getTarget(target) {
    for (let videoLink of [
        target,
        target?.parentNode,
        target?.parentNode?.parentNode,
        target?.parentNode?.parentNode?.parentNode,
        target?.parentNode?.parentNode?.parentNode?.parentNode,
        target?.parentNode?.parentNode?.parentNode?.parentNode?.parentNode,
        target?.parentNode?.parentNode?.parentNode?.parentNode?.parentNode?.parentNode]) {
        if (videoLink) {
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("video-card")) {
                return videoLink;
            }
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("bili-video-card__wrap")) {
                return videoLink;
            }
            //动态页面
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("bili-dyn-content__orig__major")) {
                return videoLink;
            }
            if (videoLink.tagName == "A" && videoLink.classList.contains("dynamic-video-item")) {
                return videoLink;
            }

            if (videoLink.tagName == "DIV" && videoLink.classList.contains("small-item") && videoLink.classList.contains("fakeDanmu-item")) {
                return videoLink;
            }
            //推荐
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("card-box")) {
                return videoLink;
            }
        }
    }
    return null;
}

function showProfile(hover) {
    try {
        const target = getTarget(hover.target);

        if (!target || !videoProfileCard.enable()) {
            videoProfileCard.checkTargetValid(hover.target);
            return;
        }

        videoProfileCard.updateCursor(hover.pageX, hover.pageY);
        videoProfileCard.updateTarget(target);

        const vid = getVideoId(target);
        if (!vid) {
            videoProfileCard.disable();
            return;
        }
        if (vid === videoProfileCard.videoId) {
            return;
        }

        videoProfileCard.updateVideoId(vid);
        // 滑到新视频时先掐掉上一个还在跑的请求
        if (typeof cancelPendingRequest === "function") {
            cancelPendingRequest();
        }
        updateVideoInfo(vid, (data) => videoProfileCard.updateData(data));
    } catch (e) {
        // 结构不认识时安静退场，别把整页的 mouseover 打断
        videoProfileCard.disable();
    }
}

// 单个防抖定时器 + 一个全局 mouseout，避免每次悬停都往元素上堆监听器
let hoverTimer = null;
let hoverTarget = null;

document.addEventListener("mouseout", (ev) => {
    if (hoverTarget && (hoverTarget === ev.target || (hoverTarget.contains && hoverTarget.contains(ev.target)))) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    }
});

function showProfileDebounce(event) {
    const target = event.target;
    const pageX = event.pageX;
    const pageY = event.pageY;

    // 悬停在自己的卡片上：既不该重新定位，也不该把卡片收掉
    if (isInsideCard(target)) {
        return;
    }

    clearTimeout(hoverTimer);
    hoverTarget = target;
    hoverTimer = setTimeout(() => {
        hoverTimer = null;
        showProfile({ target: target, pageX: pageX, pageY: pageY });
    }, 200);
}

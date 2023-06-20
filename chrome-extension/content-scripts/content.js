document.addEventListener("mouseover", showProfileDebounce);
document.addEventListener("mousemove", (ev) => videoProfileCard.updateCursor(ev.pageX, ev.pageY));

biliInsightOptions = null;

chrome.storage.sync.get({
    enableWordCloud: true,
    minSize: 5
}, function (items) {
    biliInsightOptions = items;
});

biliInsightOptions = {
    enableWordCloud: true,
    minSize: 5
}

function getVideoFromLink(url) {
    var vid = url.split("/")[4];

    return vid;
}

async function getVideoId(target) {

    if (target.childNodes[0].tagName == "A") {
        return getVideoFromLink(target.childNodes[0].href);
    }

    let vid = getVideoFromLink(target.childNodes[0].firstChild.href);

    if (vid) {
        return vid;
    }

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
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("small-item") && videoLink.classList.contains("fakeDanmu-item")) {
                return videoLink;
            }

        }
    }
    return null;


}

function showProfile(event) {
    let target = getTarget(event.target);

    if (target && videoProfileCard.enable()) {
        videoProfileCard.updateCursor(event.pageX, event.pageY);
        videoProfileCard.updateTarget(target);
        getVideoId(target).then((vid) => {
            if (vid) {
                if (vid != videoProfileCard.videoId) {
                    videoProfileCard.updateVideoId(vid);
                    updateVideoInfo(vid, (data) => videoProfileCard.updateData(data));
                }
            } else {
                videoProfileCard.disable();
            }
        })
    } else {
        videoProfileCard.checkTargetValid(event.target);
    }
}

function showProfileDebounce(event) {
    clearTimeout(showProfileDebounce.timer);
    event.target.addEventListener("mouseout", () => clearTimeout(showProfileDebounce.timer));
    showProfileDebounce.timer = setTimeout(() => {
        showProfile(event)
    }, 200);
}
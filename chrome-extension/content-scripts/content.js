
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    sendResponse({ fromcontent: "This message is from content.js" });
});




document.addEventListener("mouseover", showProfileDebounce);
document.addEventListener("mousemove", (ev) => userProfileCard.updateCursor(ev.pageX, ev.pageY));

biliScopeOptions = null;

// chrome.storage.sync.get({
//     enableWordCloud: true,
//     minSize: 5
// }, function (items) {
//     biliScopeOptions = items;
// });

biliScopeOptions = {
    enableWordCloud: true,
    minSize: 5
}

function getViedoFromLink(url) {
    var vid = url.split("/")[4];

    return vid;
}

async function getViedoId(target) {

    if (target.childNodes[0].tagName == "A") {
        return getViedoFromLink(target.childNodes[0].href);
    }

    let vid = getViedoFromLink(target.childNodes[0].firstChild.href);

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
            if (videoLink.tagName == "DIV" && videoLink.classList.contains("small-item") && videoLink.classList.contains("fakeDanmu-item")) {
                return videoLink;
            }

        }
    }
    return null;


}

function showProfile(event) {
    let target = getTarget(event.target);

    if (target && userProfileCard.enable()) {
        userProfileCard.updateCursor(event.pageX, event.pageY);
        userProfileCard.updateTarget(target);
        getViedoId(target).then((vid) => {
            if (vid) {
                if (vid != userProfileCard.userId) {
                    userProfileCard.updateUserId(vid);
                    updateUserInfo(vid, (data) => userProfileCard.updateData(data));
                }
            } else {
                userProfileCard.disable();
            }
        })
    } else {
        userProfileCard.checkTargetValid(event.target);
    }
}

function showProfileDebounce(event) {
    clearTimeout(showProfileDebounce.timer);
    event.target.addEventListener("mouseout", () => clearTimeout(showProfileDebounce.timer));
    showProfileDebounce.timer = setTimeout(() => {
        showProfile(event)
    }, 200);
}
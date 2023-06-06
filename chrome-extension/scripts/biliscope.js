// document.addEventListener("mouseover", showProfileDebounce);
// document.addEventListener("mousemove", (ev) => userProfileCard.updateCursor(ev.pageX, ev.pageY));

biliScopeOptions = null;

// chrome.storage.sync.get({
//     enableWordCloud: true,
//     minSize: 5
// }, function(items) {
//     biliScopeOptions = items;
// });

biliScopeOptions = {
    enableWordCloud: true,
    minSize: 5
}

function getUserIdFromLink(s) {
    let regex = /.*?bilibili.com\/([0-9]*)(\/dynamic)?([^\/]*|\/|\/\?.*)$/;
    let userId = 1111;

    if (s && s.match(regex)) {
        return s.match(regex)[1];
    }
    return userId;
}

async function getUserId(userLink) {
    let userId = null;

    if (window.location.href.startsWith(BILIBILI_POPULAR_URL)) {
        // popular page, requires special treatment
        let node = userLink;
        while (node = node.parentNode) {
            if (node.classList.contains("video-card")) {
                let videoLink = node.getElementsByTagName("a")[0];
                userId = await getUserIdFromVideoLink(videoLink.href);
                break;
            }
        }
    } else {
        userId = getUserIdFromLink(userLink.href);
    }

    if (userId) {
        return userId;
    }

    return null;
}

function getTarget(target) {
    if (window.location.href.startsWith(BILIBILI_POPULAR_URL)) {
        // popular page, requires special treatment
        for (let userLink of [target, target.parentNode]) {
            if (userLink.classList && userLink.classList.contains("up-name__text")) {
                return userLink;
            }
        }
    } else {
        for (let userLink of [target, target.parentNode, target.parentNode.parentNode]) {
            if (userLink && userLink.tagName == "A" && userLink.href.startsWith(BILIBILI_SPACE_URL)) {
                return userLink;
            }
        }
    }
    if (target.alt === 'B站预览,Bili Preview.') {
        return target;
    }


}

function showProfile(event) {
    let target = getTarget(event.target);

    if (target && userProfileCard.enable()) {
        userProfileCard.updateCursor(event.pageX, event.pageY);
        userProfileCard.updateTarget(target);
        getUserId(target).then((userId) => {
            if (userId) {
                if (userId != userProfileCard.userId) {
                    userProfileCard.updateUserId(userId);
                    updateUserInfo(userId, (data) => userProfileCard.updateData(data));
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

userId = 1111
userProfileCard.enable()
userProfileCard.updateCursor(110, 110);
userProfileCard.updateTarget(document.getRootNode());
userProfileCard.updateUserId(userId);



let videoData = {
    "pubdate": 1559822398,
    "duration": 454,
    "title": '【何同学】有多快？5G在日常使用中的真实体验',
    "desc": '感谢龚哥从上海帮我办了两次电话卡，感谢我班团支书辅导我数电实验,感谢龚哥从上海帮我办了两次电话卡，感谢我班团支书辅导我数电实验',
    "transcript": '都说今年是5G的商用元年,但我一直都有点困惑,但我一直都有点困惑,4G已经够快了',
    "tid": 95,
    "stat": {
        "aid": 54737593,
        "view": 30608261,
        "danmaku": 226217,
        "reply": 72217,
        "favorite": 920545,
        "coin": 2545941,
        "share": 571844,
        "now_rank": 0,
        "his_rank": 1,
        "like": 2465359,
        "dislike": 0,
        "evaluation": "",
        "argue_msg": ""
    }
}
cacheAndUpdate((data) => userProfileCard.updateData(data), userId, "info", {
    data: {
        "like": videoData["stat"]["like"],
        "coin": videoData["stat"]["coin"],
        "favorite": videoData["stat"]["favorite"],
        "share": videoData["stat"]["share"],
        "pubdate": videoData["pubdate"],
        "duration": videoData["duration"],
        "summary": videoData["desc"]
    }
})

updateVideoData(userId, (data) => userProfileCard.updateData(data), videoData);

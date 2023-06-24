biliInsightOptions = {
    enableWordCloud: true,
    minSize: 5
}
function fakeShow(event) {

    let videoId = 1111
    videoProfileCard.enable()
    videoProfileCard.updateCursor(110, 110);
    videoProfileCard.updateTarget(document.getRootNode());
    videoProfileCard.updateVideoId(videoId);



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
    cacheAndUpdate((data) => videoProfileCard.updateData(data), videoId, "info", {
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

    updateVideoData(videoId, (data) => videoProfileCard.updateData(data), videoData);

    summary = `---
markmap:
    colorFreezeLevel: 2
---

# markmap

## Links

- <https://markmap.js.org/>
- [GitHub](https://github.com/gera2ld/markmap)

## Related Projects

- [coc-markmap](https://github.com/gera2ld/coc-markmap)
- [gatsby-remark-markmap](https://github.com/gera2ld/gatsby-remark-markmap)

## Features

- links
- **strong** ~~del~~ *italic* ==highlight==
- multiline
    text`
    cacheAndUpdate((data) => videoProfileCard.updateData(data), videoId, "markmap", {
        data: summary
    })

}
fakeShow()

document.getElementById('display').addEventListener('click', fakeShow);
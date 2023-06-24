# Bili-Insight

<div align="center">
    <img src="img/Bili-Insight-1.png" width=20%>
</div>

Bili Insight，借助GPT洞察B站视频内容[Chrome插件](https://chrome.google.com/webstore/detail/bili-insight%EF%BC%8C%E6%B4%9E%E5%AF%9Fb%E7%AB%99%E8%A7%86%E9%A2%91%E5%86%85%E5%AE%B9%E6%8F%92%E4%BB%B6/akodljjoaekbfjacabnihcbcbioidnfg?hl=zh-CN)。它可以让你不用点开视频，更快地了解视频的总结内容。
<p align="center">
    • 🤗 <a href="https://yfor-bili-insight2.hf.space/" target="_blank"> Huggingface Space</a>
    • 📺 <a href="https://b23.tv/P9ao5bc" target="_blank">介绍视频1</a>
    • 📺 <a href="https://www.bilibili.com/video/BV1KV4y1S7Rw/" target="_blank">介绍视频2</a> 
    • 📑 <a href="https://emoumcwvfx.feishu.cn/docx/FUNYdH8ClolsBjxrEm3crZt0nTh" target="_blank">项目规划文档</a> 
    
</p>
用户是 B 站的视频观众，他们希望通过使用这个插件来更好地理解视频的内容。

当浏览B站时，把鼠标悬停至视频或标题时，插件会自动展示内容总结，通过词云/思维导图等方式以可视化的形式呈现给用户，方便用户快速了解视频内容。

* up主视频的点赞、投币、收藏、分享数据
* up主视频的投稿时间、视频长度数据
* up主投稿视频的所在分区
* up主视频的内容总结。默认为视频简介。待请求完成后，会替换为视频内容总结
* up主视频字幕、标题、简介、tag生成的词云
## 示例
![png](chrome-extension/images/insight.png)

## 设计
```mermaid
sequenceDiagram
    participant 用户
    participant 浏览器
    participant B站

    用户->>+浏览器: 鼠标悬浮在B站视频上
    浏览器->>+B站: 查询视频信息
    B站->>+浏览器: 返回视频信息
    浏览器->>用户: 展示视频信息
    浏览器->>字幕网站: 查询字幕信息
    字幕网站->>+浏览器: 返回字幕信息
    浏览器->>+后端/HuggingFace（Langchain）: 请求总结字幕
    后端/HuggingFace（Langchain）->>+openai: ChatGPT接口
    openai->>+后端/HuggingFace（Langchain）: 总结字幕结果
    后端/HuggingFace（Langchain）->>+浏览器: 总结字幕结果
    浏览器->>用户: 展示视频信息（字幕总结）
```
### Refine链原理
![截图](img/refine_chain.png)

###  Huggingface部署
![截图](img/huggingface.png)

## 加入我们
<b>1. 添加个人联系方式</b>
<div align="center">
    <img src="img/Wechat_Taylor.jpeg" width=20%>
    <br/><br/><br/><br/><br/>
</div>

<b>2. 加入开发/体验/内测组</b>
<div align="center">
    <img src="img/Wechat_Group.jpeg" width=30%>
</div>

## 参考资料
* [吕立青：BiliGPT](https://github.com/JimmyLv/BibiGPT)
* [插件：让你瞬间了解B站UP主](https://github.com/gaogaotiantian/biliscope)
* [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)

## LICENSE
<a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/"><img alt="知识共享许可协议" style="border-width:0" src="https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey" /></a><br />本作品采用<a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/">知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议</a>进行许可。

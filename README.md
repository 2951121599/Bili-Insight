# Bili-Insight

<div align="center">
    <img src="img/Bili-Insight.png" width=20%>
</div>

Bili Insight 是一个 [Chrome 插件](https://chrome.google.com/webstore/detail/bili-insight%EF%BC%8C%E6%B4%9E%E5%AF%9Fb%E7%AB%99%E8%A7%86%E9%A2%91%E5%86%85%E5%AE%B9%E6%8F%92%E4%BB%B6/akodljjoaekbfjacabnihcbcbioidnfg?hl=zh-CN)：把鼠标悬停在 B 站任意视频卡片上，直接告诉你**这视频值不值得看**。不用点进去，不用拖进度条。

<p align="center">
     📺 <a href="https://b23.tv/P9ao5bc" target="_blank">介绍视频1</a>
     📺 <a href="https://www.bilibili.com/video/BV1KV4y1S7Rw/" target="_blank">介绍视频2</a>
     📑 <a href="https://emoumcwvfx.feishu.cn/docx/FUNYdH8ClolsBjxrEm3crZt0nTh" target="_blank">项目规划文档</a>
</p>

## 卡片里有什么

悬停后弹出的卡片，从上到下：

* **一句结论 + 0-100 分**，三档：值得看 / 扫一眼 / 跳过
* **2-4 条真正的信息点**，不复述标题
* **四个辅助判断**：密度、适合谁看、同质化风险、时间成本
* 点赞、投币、收藏、分享、投稿时间、时长、分区标签
* 可选的词云与思维导图（词云默认关闭）
* 视频没有字幕时，卡片会明确标注「无字幕 · 仅依据标题与简介推断」

## 安装

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」，点「加载已解压的扩展程序」，选择本仓库的 `chrome-extension` 目录
2. 点扩展图标，填三样东西：

| 项 | 值 |
| --- | --- |
| API Key | 你的 DeepSeek Key，在 [platform.deepseek.com](https://platform.deepseek.com) 申请 |
| 接口地址 | `https://api.deepseek.com` |
| 模型 | `deepseek-flash` |

3. 点「测试连接」，看到「连接正常」就可以去 B 站了

接口地址填任何 **OpenAI 兼容**网关都行（自建转发、其他厂商的兼容端点都可以），这就是 issue #6 / #7 / #9 想要的自定义 API Host。Key 只存在浏览器本地 `chrome.storage.sync`，不经过任何第三方服务器。

## 成本

默认 `deepseek-flash`：1M 上下文，$0.15 / $0.60 每百万 token（输入 / 输出）。一条 20 分钟视频的字幕约 8k token，一次判断不到一分钱。悬停场景会显式关闭思考模式（`thinking: disabled`），否则默认 `effort=high` 的推理会让卡片等很久。

## 设计

```mermaid
sequenceDiagram
    participant 用户
    participant 内容脚本
    participant Service Worker
    participant DeepSeek

    用户->>内容脚本: 悬停 B 站视频卡片
    内容脚本->>B站: 取视频信息（WBI 签名）
    内容脚本->>用户: 先渲染互动数据，不等模型
    内容脚本->>Service Worker: 请求字幕 + 判断
    Service Worker->>B站: 抓字幕 JSON
    Service Worker->>DeepSeek: chat/completions（整条字幕一次读完）
    DeepSeek->>Service Worker: JSON 结论
    Service Worker->>用户: 卡片补上「值不值得看」
```

### 为什么 refine 链没了

早期版本用 `gpt-3.5-turbo-16k`，上下文装不下长字幕，只能分块 + 逐块精炼（见 `img/refine_chain.png`），代价是延迟随视频长度线性增长。`deepseek-flash` 是 1M 上下文，一条视频的字幕一次就能读完，分块只会增加延迟和调用次数，所以整条 langchain refine 链连同 langchain 依赖一起删掉了。

## 自建服务（可选）

插件默认直连模型厂商，不需要后端。如果你不想把 Key 分发到每台机器的浏览器，或者要统一计费，可以起 `api.py`：

```bash
pip install -r requirements.txt
DEEPSEEK_API_KEY=sk-xxx RELAY_TOKEN=your-token uvicorn api:app --port 8000
```

然后把插件的「接口地址」填 `http://127.0.0.1:8000`，「API Key」填 `RELAY_TOKEN` 的值。

| 端点 | 用途 |
| --- | --- |
| `/chat/completions` | 转发端点，服务端持 Key，客户端只带 `RELAY_TOKEN` |
| `/summary` | 直接返回结构化判断，方便 curl 调试 |
| `/outline` | 直接返回 markmap 用的 Markdown 大纲 |
| `/run/predict` | 兼容旧版插件的 Gradio 风格接口 |
| `/health` | 健康检查 |

没有设置 `RELAY_TOKEN` 时转发端点返回 503，避免变成公开的免费代理。

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

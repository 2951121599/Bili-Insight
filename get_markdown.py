# -*- coding:utf-8 -*-
import logging
import os

from langchain import OpenAI
from langchain import PromptTemplate
from langchain.chains.summarize import load_summarize_chain
from langchain.docstore.document import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from openai.error import AuthenticationError


def get_markdown(text, api_key=None):
    """
    使用 GPT-3.5 模型分析总结文本
    :param text: 文本
    :param api_key: apikey from openai
    :return: 分析结果
    """
    try:

        # 初始化文本分割器，指定每个块的大小为2000。
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=8000, chunk_overlap=0)
        # 切分文本
        texts = text_splitter.split_text(text)
        # 使用 Document 类创建文档对象
        docs = [Document(page_content=t) for t in texts]

        # 我们定义一个模板字符串，用于提示 GPT-3.5 总结原始文本并生成汉语总结。
        template_str = """我希望你是一名专业的视频内容编辑，。
        请根据内容生成兼容脑图的Markdown格式，包含一级内容，和分级目录。一级目录不要超过6条，分级目录最多三个
        （字幕中可能有错别字，如果你发现了错别字请改正），
        记得不要重复句子，确保所有的句子都足够精简，清晰完整，祝你好运！
        下面是内容:
        {text}
        """
        prompt_template = PromptTemplate(input_variables=["text"], template=template_str)

        # 我们还定义了另一个模板字符串，用于提示 GPT-3.5 通过添加更多上下文来完善现有的汉语总结。
        refine_template = (
            "Your job is to produce a final summary\n"
            "We have provided an existing summary up to a certain point: {existing_answer}\n"
            "We have the opportunity to refine the existing summary"
            "(only if needed) with some more context below.\n"
            "{text}\n"
            "Given the new context, refine the original summary in chinese"
            "然后以无序列表的方式返回，不要超过5条。"
            "If the context isn't useful, return the original summary."
        )
        refine_prompt = PromptTemplate(input_variables=["existing_answer", "text"], template=refine_template)
        # 使用 OpenAI API 密钥创建 OpenAI 对象
        if api_key:
            openai_api_key = api_key
        else:
            openai_api_key = os.getenv('OPENAI_API_KEY')
        llm = OpenAI(temperature=0, model_name="gpt-3.5-turbo-16k", openai_api_key=openai_api_key)

        # 加载总结和完善模型链，并向其提供刚才定义的两个模板字符串作为问题和细化问题的提示。
        chain = load_summarize_chain(llm, chain_type="refine", return_intermediate_steps=True,
                                     question_prompt=prompt_template, refine_prompt=refine_prompt, verbose=True)
        # 将文档对象传递给模型链，并请求只返回输出文本。
        review = chain({"input_documents": docs}, return_only_outputs=True)
        # 返回 GPT-3.5 生成的文本摘要
        return review["output_text"]

    except AuthenticationError as e:
        print("OpenAI API authentication error:", e.json_body)
        return "请检查apikey"
    except Exception as e:
        logging.error("生成出错:", exc_info=True)
        return "生成出错"


if __name__ == '__main__':
    # 测试
    print(get_markdown("""
    都说今年是5g的商用元年 但我一直都有点困惑 4g已经够快了 5g到底有什么用呢 为了探究这个问题 我报名oppo的5g星火计划 成功拿到了一台他们最新的oppo reno 5 g版 但是当下有5g天火的地方并不多 最好的体验机会就是5月十日就参与oppo的星火计划 开幕式 那里布置5g基站 但很巧的是 那天我期中考试 可我还是想体验一下5g的速度 往上一搜 发现有5g信号的地方有世园会金融街和北京邮电大学 这就很巧了 朋友们 我就在这儿上学呀 而这里解释一下 5g信号覆盖的是我们的稀土城校区 而我们大一大二都在30km外的沙河校区 所以我一下课就坐了校车来到了西土城 一进学校 这个高贵的符号便出现了 但是当我迫不及待的色素时 突然就懵了 这玩意儿难道比4g快很多吗 事实上 当我花了600兆流量在学校的各个地方测了十多次座 发现速度的确只有4g的水平 我试着下载了一些音乐和应用之类的东西 发现速度只有几兆每秒 在回去的路上 我不由得陷入了对人生和社会的大思考 所以我联系了学校信息化技术中心的老师 很巧的是那种联通正好在我们学校开个沟通会 老师就让我去了 更巧的是 刚好有个在联通的学长看过我的视频 他打天梯分后告诉我 我连不上5g是因为联通还在和学校进行测试 还未向用户开放 我实际上体验到的还是4g的速度啊 听到这里我心凉了半截 但是最巧的事情来了 测试预期在那周周五结束 顺利的话 周末就会开放 所以我又拿小车来到了西土城 而这次 i'm not a dummy you were summon human what i ta get it to you unsuperhuman innovative and i made a ral so that anything you can take a shit off for me in the i'm never stating more than never demonstrating how to give him all the fuking audience a feeling like a seventeen 这玩意是真的快 平均下载速率700mb ps左右 上传在80左右 几乎是设计速度的十倍 还记不记得上次我测了十多次速 才花了600兆流量 5g测一次就得1000了啊 我一开始的时候还想下个程序看看下载速率 结果下一些生活类应用时 根本来不及到那个有速率的页面就已经下完了 之后下一次更大的游戏时 发现速度保持在60兆每秒左右 用5g下歌的体验更优秀 一首十兆的歌进度条只有全空和全满两种状态 根本就没有在中间呆过 在各个平台看最高码率的视频也可 以随便出进度条可缓存来看 几乎没有区别 玩游戏的延迟也稳定在60ms以下 在体验上唯一和4g甚至和3g一脉相承的 就只有没有开会员的百度云了啊 别说5g这玩意 5g上6g也没辙 体验了一整天 5g我最大的感受有两点 第一就是这玩意用起来是真的爽 5g的普及会极大的优化当下的网络体验 比如有时候你引上来想玩游戏 然后给你蹦出来一个300兆的更新 这种感觉是很难受的 但是在5g的速度下 下载更新包几乎和解压塔一样快 第二就是云存储肯定 是趋势小王 最快的时候下载速度有90兆每秒 已经快赶上手机里sd卡的读取速度了 这么快的网速下 你把照片和视频保存在本地看 还是上传到云端 需要的时候下载下来再看 几乎没有区别 如果说有什么遗憾的话 就是联通的朋友跟我说 现在大多数5g部署都采用nsa 也就是非独立组网架构 将来才会升级到sa架构 呃不是通信专业的朋友 可能听不懂我在说什么啊 呃其实我也听不懂 但是在升级后速度会更快 实验会更低 终于在对着测试软件傻笑了一天后 天色逐渐暗了下 来我对这个速度的兴奋感也逐渐变得平淡 在回去的路上 我还是陷入了对人生和社会的大思考 想想我们在手机上要做哪些 对网速有要求的 是无非就是看视频 玩游戏 但这些需求在4g下也得到了满足啊 用5g体验当然会更好 但总有些杀鸡用牛刀的感觉啊 有这种想法的网友也不在少数 事实上 从拿到这个手机的第一天开始 我们每天都会在网上搜我 这有什么用回答 你总是预测vr ar全民自动驾驶 万物互联 但这些听起来总是太遥远 实现起来太复杂 所以这次我换了一个 搜索方式我搜了一下4g有什么用 但是把时间限定在了2012年到2013年 也就是4g即将商用的时间 站在未来看 前人对现在的预测真的是很有趣的一件事情 当时大多数人都在抱怨4g没有什么用 资费还那么贵 而我那时候也是 但是5年过后 大多数人已经没有那种流量有什么用的意识了 而当年对4g应用的预测的确可以看见一些未来的端倪 但都有些太缺乏想象力了 比如都知道4g可以看高清视频 但是当时都在说用手机看电影有多方便 没有人预测到短 视频的彻底爆发啊 比如都知道4g有利于普及移动支付 但当时的理想方式是一个手机绑信用卡加上nfc 没有人想到靠着网络加二维码这么简单粗暴的方式真的就干掉了现金 比如都知道4g的上传速度可以视频直播了 但当时的设想是应用于专业的新闻领域 没有想到这个全民皆可直播时代的来临 更不用说还有各种电商外卖打车平台的兴起 在短短的5年里 4g和它催生的服务深刻地改变了我们每一个人的生活 好像在5年前 你可能是觉得哦网速是快一点是吧 人对 未来的预测都跳脱不出当下技术和思维的限制 最典型的例子就是 如果你问一个50年前的人未来什么样子 他可能会告诉你 汽车会在天上跑 50年过去了 汽车没有上天 但是计算机和信息技术的诞生 对社会的改变绝对不会比会飞的汽车更小 50年是如此 5年说不定也是如此 5年前大多数文章都没有预测到4g栽培出的移动互联网 这个参天大树 那么5g这片更肥沃的土壤里会开出怎样的花 我相信还是会超过所有人的预料 最近联通的朋友还带我去参观了一个有 关5g的展 看到了不少有意思的应用 我现在最大的期望就是当我5年后再打开这个视频 会发现速度其实是5g最无聊的应用 ok我视频的全部内容啦 非常感谢你能看到这里啊 当然更要感谢中国联通的朋友 在北京邮电大学 如果你这个视频做的不错的话 求赞求收藏 全品是转发 就是哪个大大的关注 各位的支持就是做视频的最大动力啊 最近要高考了呃 就就祝各位高考的朋友都能考出一个理想的成绩 ok各位我们下期再见嗯"""))

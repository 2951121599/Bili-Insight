# -*- coding:utf-8 -*-
import logging
import os

from langchain import OpenAI
from langchain import PromptTemplate
from langchain.docstore.document import Document
from langchain.text_splitter import CharacterTextSplitter
from langchain.chains.summarize import load_summarize_chain
from openai.error import AuthenticationError


def analyze_by_3p5(text):
    """
    使用 GPT-3.5 模型分析总结文本
    :param text: 文本
    :return: 分析结果
    """
    try:
        # 使用 OpenAI API 密钥创建 OpenAI 对象
        openai_api_key = os.getenv('OPENAI_API_KEY')
        llm = OpenAI(temperature=0, model_name="gpt-3.5-turbo", openai_api_key=openai_api_key)

        # 初始化文本分割器，在较小的块中处理大量文本，用于分割文本的字符（这里是“。”），指定每个块的大小为2000。
        text_splitter = CharacterTextSplitter(separator="。", chunk_size=2000, chunk_overlap=0)
        # 切分文本
        texts = text_splitter.split_text(text)
        # 使用 Document 类创建文档对象
        docs = [Document(page_content=t) for t in texts]

        # 我们定义一个模板字符串，用于提示 GPT-3.5 总结原始文本并生成汉语总结。
        template_str = """Write a total summary of the following:
        {text}
        SUMMARY IN CHINESE:"""
        prompt_template = PromptTemplate(input_variables=["text"], template=template_str)

        # 我们还定义了另一个模板字符串，用于提示 GPT-3.5 通过添加更多上下文来完善现有的汉语总结。
        refine_template = (
            "Your job is to produce a final summary\n"
            "We have provided an existing summary up to a certain point: {existing_answer}\n"
            "We have the opportunity to refine the existing summary"
            "(only if needed) with some more context below.\n"
            "{text}\n"
            "Given the new context, refine the original summary in chinese"
            "If the context isn't useful, return the original summary."
        )
        refine_prompt = PromptTemplate(input_variables=["existing_answer", "text"], template=refine_template)

        # 加载总结和完善模型链，并向其提供刚才定义的两个模板字符串作为问题和细化问题的提示。
        chain = load_summarize_chain(llm, chain_type="refine", return_intermediate_steps=True,
                                     question_prompt=prompt_template, refine_prompt=refine_prompt, verbose=True)
        # 将文档对象传递给模型链，并请求只返回输出文本。
        review = chain({"input_documents": docs}, return_only_outputs=True)
        # 返回 GPT-3.5 生成的文本摘要
        return review["output_text"]

    except AuthenticationError as e:
        print("OpenAI API authentication error:", e.json_body)
        return None
    except Exception as e:
        logging.error("Summary error:",  exc_info=True)
        return None


if __name__ == '__main__':
    # 测试
    print(analyze_by_3p5("""
    每个人都有变好的能力，但是能帮助你的人是你自己，也只有你自己。所有的困境都有出路，人的改变是在关系中发生的，心理治疗既需要自我觉醒，又需要和谐的人际关系建立，两者不可或缺。心理问题往往都是人际关系的问题，不仅是你和别人，还有你和自己的关系。让自己变得更好，才是解决问题的关键。当你不再和自己纠缠，所处的一切关系才会顺畅。作为咨询师，她是一个倾听者，倾听来访者内心的痛苦与不安。作为来访者，她是一个诉说者，诉说内心的难过与彷徨。
    """))
    print(analyze_by_3p5("""
    用户是 B 站的视频观众，他们希望通过使用这个插件来更好地理解视频的内容。当用户鼠标至视频标题时，插件会自动展示内容总结，通过思维导图/词云等方式以可视化的形式呈现给用户，方便用户快速了解视频内容。
    """))
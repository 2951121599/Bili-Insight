#-*- coding:utf-8 -*-
import os

from langchain import OpenAI
from langchain import PromptTemplate
from langchain.docstore.document import Document
from langchain.text_splitter import CharacterTextSplitter
from langchain.chains.summarize import load_summarize_chain
import openai

def analyze_by_3p5(text):
    openai_api_key = "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"
    llm = OpenAI(temperature=0, model_name="gpt-3.5-turbo", openai_api_key=openai_api_key)

    
    # 初始化文本分割器
    text_splitter = CharacterTextSplitter(separator="。",chunk_size=2000, chunk_overlap=0)
    # 切分文本
    texts = text_splitter.split_text(text)
#     texts = [text]
    docs = [Document(page_content=t) for t in texts]

    template1 = """Write a total summary of the following:
    {text}
    SUMMARY IN CHINESE:"""
    prompt_template = PromptTemplate(input_variables=["text"], template=template1)

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

    chain = load_summarize_chain(llm, chain_type="refine", return_intermediate_steps=True, question_prompt=prompt_template, refine_prompt=refine_prompt,verbose=True)
    review = chain({"input_documents": docs}, return_only_outputs=True)
    return review["output_text"]
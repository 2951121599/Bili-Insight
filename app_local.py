import gradio as gr
from gpt_analyze import summary

iface = gr.Interface(fn=summary, inputs=[
    gr.components.Textbox(label='Your text',
                          lines=5,
                          placeholder='The text that needs to be summarized',
                          max_lines=100),
    gr.components.Textbox(label='api key',
                          placeholder='apikey from openai',
                          type="password"),
    gr.Radio(["summary", "markmap"], value="summary", label="Select summarizing method")
], outputs="text")
iface.launch(share=True)

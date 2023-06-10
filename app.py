import gradio as gr
from gpt_analyze import analyze_by_3p5

iface = gr.Interface(fn=analyze_by_3p5, inputs=[
    gr.components.Textbox(label='Your text',
                          lines=5,
                          placeholder='The text that needs to be summarized',
                          max_lines=100),
    gr.components.Textbox(label='api key',
                          placeholder='apikey from openai',
                          type="password")
], outputs="text")
iface.launch(share=True)

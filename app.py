import gradio as gr
from gpt_analyze import analyze_by_3p5


def greet(context, api_key):
    return analyze_by_3p5(context, api_key)


iface = gr.Interface(fn=greet, inputs=[
    gr.components.Textbox(label='Your text',
                          lines=5,
                          max_lines=100),
    gr.components.Textbox(label='openai api',
                          type="password")
], outputs="text")
iface.launch(share=True)

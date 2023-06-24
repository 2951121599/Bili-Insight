import json
import logging

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from gpt_analyze import summary_text

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%d-%b-%y %H:%M:%S')

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/")
async def create_item(request: Request):
    json_post_raw = await request.json()
    json_post = json.dumps(json_post_raw)
    json_post_list = json.loads(json_post)

    text = json_post_list.get('text')
    api_key = json_post_list.get('apiKey')
    logging.info('input %s', text)
    summary_text = summary_text(text, api_key)
    # summary_text = "x"
    logging.info('summary %s', summary_text)
    logging.info('input length %s,summary length %s', len(text), len(summary_text))
    response = {
        "summary": summary_text
    }
    return response


@app.post("/run/predict")
async def predict(request: Request):
    """
    mock the gradio rest api
    """
    json_post_raw = await request.json()
    json_post = json.dumps(json_post_raw)
    json_post_list = json.loads(json_post)
    data = json_post_list.get('data')
    text = data[0]
    api_key = data[1]
    logging.info('input %s', text)
    summary_text = summary_text(text, api_key)
    # summary_text = "x"
    logging.info('summary %s', summary_text)
    logging.info('input length %s,summary length %s', len(text), len(summary_text))
    response = {
        "data": [summary_text]
    }
    return response


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000, workers=1)

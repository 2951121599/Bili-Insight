import json
import logging
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

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


def fake_streamer():
    for i in range(20):
        time.sleep(0.5)
        yield json.dumps({"data": i})


@app.get("/")
async def main():
    return StreamingResponse(fake_streamer(), media_type="text/plain")


@app.post("/")
async def create_item(request: Request):
    json_post_raw = await request.json()
    json_post = json.dumps(json_post_raw)
    json_post_list = json.loads(json_post)

    text = json_post_list.get('text')
    api_key = json_post_list.get('apiKey')
    logging.info('input %s', text)
    return StreamingResponse(fake_streamer())


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000, workers=1)

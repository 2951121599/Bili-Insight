chrome.runtime.onMessage.addListener(
    function (text, sender, onSuccess) {
        let data = JSON.parse(text)

        if (data.type === 'subtitleUrl') {
            getSubtitleUrl(data, onSuccess)
        }
        if (data.type === 'summary') {
            getSummary(data, onSuccess)
        }
        return true;  // Will respond asynchronously.
    }
);

function getSubtitleUrl(data, onSuccess) {
    fetch(data.url)
        .then(response => response.json())
        .then(responseText => onSuccess(responseText))

}

function getSummary(data, onSuccess) {

    chrome.storage.sync.get({
        "enableWordCloud": true,
        "apiKey": '',
        minSize: 5
    }, function (items) {

        const url = 'https://yfor-bili-insight2.hf.space/run/predict'
        // const url = 'http://127.0.0.1:7860/run/predict'
        fetch(url, {
            method: "POST", // or 'PUT'
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                "data": [
                    data.text,
                    items.apiKey ? items.apiKey : '',
                    data.method ? data.method : '',
                ]
            }
            )
        })
            .then(response => response.json())
            .then(responseText => onSuccess({
                "summary": responseText["data"][0]
            }))
    });

}
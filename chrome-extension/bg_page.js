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
    fetch('http://127.0.0.1:8000/', {
        method: "POST", // or 'PUT'
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text: data.text
        })
    })
        .then(response => response.json())
        .then(responseText => onSuccess(responseText))
}
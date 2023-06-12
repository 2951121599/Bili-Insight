const sendMessageId = document.getElementById("sendmessageid");
if (sendMessageId) {
    sendMessageId.onclick = function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(
                tabs[0].id,
                {
                    url: chrome.runtime.getURL("images/bilipreview.png"),
                    imageDivId: `${guidGenerator()}`,
                    tabId: tabs[0].id
                },
                function (response) {
                    window.close();
                }
            );
            function guidGenerator() {
                const S4 = function () {
                    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
                };
                return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
            }
        });
    };
}

// Saves options to chrome.storage
function save_options() {
    const apiKey = document.getElementById('api-key').value;
    chrome.storage.sync.set({
        "apiKey": apiKey
    }, function () {
        // Update status to let user know options were saved.
        show_status('保存成功', 1500);
    });
}
function show_status(text, time) {
    var status = document.getElementById('status');
    status.textContent = text;
    setTimeout(function () {
        status.textContent = '';
    }, time);
}
// stored in chrome.storage.
function restore_options() {
    chrome.storage.sync.get({
        "enableWordCloud": true,
        "apiKey": '',
        minSize: 5
    }, function (items) {
        document.getElementById('api-key').value = items.apiKey;
    });
}
document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
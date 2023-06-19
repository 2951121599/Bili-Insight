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
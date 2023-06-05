chrome.runtime.onMessage.addListener(
   
    function(url, sender, onSuccess) {
        fetch(url)
            .then(response => response.json())
            .then(responseText => onSuccess(responseText))
        
        return true;  // Will respond asynchronously.
    }
);
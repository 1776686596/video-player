const API_ENDPOINTS = [
  "https://api.tzjsy.cn/sp/dyksmn/video.php",
  "https://api.tzjsy.cn/sp/hs/video.php",
  "https://api.tzjsy.cn/sp/bs/video.php",
  "https://api.tzjsy.cn/sp/jk/video.php",
  "https://api.tzjsy.cn/sp/tm/video.php",
  "https://api.tzjsy.cn/sp/cy/video.php"
];

chrome.action.onClicked.addListener(async function(tab) {
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://")) {
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["style.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    console.log("Inject error:", e);
  }
  setTimeout(function() {
    chrome.tabs.sendMessage(tab.id, { action: "toggle" });
  }, 100);
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "fetchVideo") {
    var url = API_ENDPOINTS[Math.floor(Math.random() * API_ENDPOINTS.length)];

    fetch(url, { redirect: "follow" })
      .then(function(resp) {
        var finalUrl = resp.url;
        var contentType = resp.headers.get("content-type") || "";

        // 如果是视频流或重定向到视频URL
        if (contentType.startsWith("video/") ||
            contentType.startsWith("application/octet-stream") ||
            finalUrl.includes(".mp4") ||
            finalUrl.includes(".webm") ||
            finalUrl.includes(".m3u8")) {
          return finalUrl;
        }

        // 尝试解析JSON
        return resp.text().then(function(text) {
          if (text.trim().startsWith("{")) {
            try {
              var data = JSON.parse(text);
              return data.data || data.url || data.video || finalUrl;
            } catch (e) {
              return finalUrl;
            }
          }
          return finalUrl;
        });
      })
      .then(function(videoUrl) {
        console.log("Video URL:", videoUrl);
        sendResponse({ url: videoUrl });
      })
      .catch(function(err) {
        console.log("Fetch error:", err);
        sendResponse({ error: err.message });
      });

    return true;
  }
});

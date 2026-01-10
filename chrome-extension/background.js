const API_ENDPOINTS = [
  "https://api.tzjsy.cn/sp/dyksmn/video.php",
  "https://api.tzjsy.cn/sp/hs/video.php",
  "https://api.tzjsy.cn/sp/bs/video.php",
  "https://api.tzjsy.cn/sp/jk/video.php",
  "https://api.tzjsy.cn/sp/tm/video.php",
  "https://api.tzjsy.cn/sp/cy/video.php"
];

const ACTIVE_FLOAT_TAB_ID_KEY = "activeFloatTabId";

function getStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function storageGet(key) {
  return new Promise(function(resolve) {
    getStorageArea().get(key, function(result) {
      resolve(result || {});
    });
  });
}

function storageSet(value) {
  return new Promise(function(resolve) {
    getStorageArea().set(value, function() {
      resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise(function(resolve) {
    getStorageArea().remove(key, function() {
      resolve();
    });
  });
}

async function getActiveFloatTabId() {
  try {
    const result = await storageGet(ACTIVE_FLOAT_TAB_ID_KEY);
    const tabId = result[ACTIVE_FLOAT_TAB_ID_KEY];
    return typeof tabId === "number" ? tabId : null;
  } catch (e) {
    return null;
  }
}

async function setActiveFloatTabId(tabId) {
  try {
    await storageSet({ [ACTIVE_FLOAT_TAB_ID_KEY]: tabId });
  } catch (e) {
    // ignore
  }
}

async function clearActiveFloatTabId() {
  try {
    await storageRemove(ACTIVE_FLOAT_TAB_ID_KEY);
  } catch (e) {
    // ignore
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise(function(resolve) {
    chrome.tabs.sendMessage(tabId, message, function(response) {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

function isBlockedUrl(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  );
}

chrome.action.onClicked.addListener(async function(tab) {
  if (typeof tab?.id !== "number" || isBlockedUrl(tab.url)) {
    return;
  }
  const currentTabId = tab.id;

  const activeTabId = await getActiveFloatTabId();
  if (activeTabId && activeTabId !== currentTabId) {
    // If a float window is already open in another tab, move it to the current tab
    // (keep same video/progress) instead of refreshing a new one.
    const stateResponse = await sendMessageToTab(activeTabId, { action: "exportState" });
    if (stateResponse && stateResponse.open) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: currentTabId }, files: ["style.css"] });
        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ["content.js"] });
      } catch (e) {
        console.log("Inject error:", e);
      }

      const openResponse = await sendMessageToTab(currentTabId, { action: "open", state: stateResponse.state || null });
      if (openResponse && openResponse.open) {
        await sendMessageToTab(activeTabId, { action: "close" });
        await setActiveFloatTabId(currentTabId);
      }
      return;
    }
    await clearActiveFloatTabId();
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: currentTabId }, files: ["style.css"] });
    await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ["content.js"] });
  } catch (e) {
    console.log("Inject error:", e);
  }

  const response = await sendMessageToTab(currentTabId, { action: "toggle" });
  if (response && typeof response.open === "boolean") {
    if (response.open) {
      await setActiveFloatTabId(currentTabId);
    } else {
      const latestActiveTabId = await getActiveFloatTabId();
      if (latestActiveTabId === currentTabId) {
        await clearActiveFloatTabId();
      }
    }
  }
});

chrome.tabs.onRemoved.addListener(async function(tabId) {
  const activeTabId = await getActiveFloatTabId();
  if (activeTabId === tabId) {
    await clearActiveFloatTabId();
  }
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

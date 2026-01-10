let floatWindow = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let autoNext = true;

function getFloatWindowElement() {
  return floatWindow || document.getElementById("video-float-window");
}

function exportFloatWindowState() {
  var existing = getFloatWindowElement();
  if (!existing) return null;

  var video = existing.querySelector(".vfw-video");
  var state = {
    autoNext: autoNext,
    minimized: existing.classList.contains("vfw-minimized"),
    position: {
      left: existing.style.left || null,
      top: existing.style.top || null,
      right: existing.style.right || null,
      bottom: existing.style.bottom || null
    },
    video: null
  };

  if (video) {
    state.video = {
      src: video.currentSrc || video.src || null,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      paused: !!video.paused,
      muted: !!video.muted,
      volume: Number.isFinite(video.volume) ? video.volume : 1,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1
    };
  }

  return state;
}

function applyFloatWindowState(existing, state) {
  if (!existing || !state) return;

  if (typeof state.autoNext === "boolean") {
    autoNext = state.autoNext;
    var checkbox = existing.querySelector(".vfw-auto input");
    if (checkbox) checkbox.checked = autoNext;
  }

  if (state.minimized) {
    existing.classList.add("vfw-minimized");
  } else if (state.minimized === false) {
    existing.classList.remove("vfw-minimized");
  }

  if (state.position) {
    if (state.position.left !== null) existing.style.left = state.position.left;
    if (state.position.top !== null) existing.style.top = state.position.top;
    if (state.position.right !== null) existing.style.right = state.position.right;
    if (state.position.bottom !== null) existing.style.bottom = state.position.bottom;
  }

  if (state.video && state.video.src) {
    var video = existing.querySelector(".vfw-video");
    var loading = existing.querySelector(".vfw-loading");
    if (!video) return;

    if (loading) {
      loading.textContent = "加载中...";
      loading.style.display = "flex";
      loading.style.cursor = "default";
      loading.onclick = null;
    }

    var targetTime = Number.isFinite(state.video.currentTime) ? state.video.currentTime : 0;
    var shouldPlay = !state.video.paused;

    video.autoplay = false;
    if (typeof state.video.muted === "boolean") video.muted = state.video.muted;
    if (Number.isFinite(state.video.volume)) video.volume = state.video.volume;
    if (Number.isFinite(state.video.playbackRate)) video.playbackRate = state.video.playbackRate;

    function restorePlayback() {
      try {
        if (targetTime > 0) video.currentTime = targetTime;
      } catch (e) {
        // ignore
      }
      if (shouldPlay) {
        video.play().catch(function(e) { console.log("Play error:", e); });
      } else {
        try { video.pause(); } catch (e) { /* ignore */ }
      }
    }

    video.src = state.video.src;
    video.load();
    if (shouldPlay) {
      video.play().catch(function(e) { console.log("Play error:", e); });
    }

    if (video.readyState >= 1) {
      restorePlayback();
    } else {
      var onMeta = function() {
        video.removeEventListener("loadedmetadata", onMeta);
        restorePlayback();
      };
      video.addEventListener("loadedmetadata", onMeta);
    }
  }
}

function closeFloatWindow() {
  stopDrag();

  var existing = getFloatWindowElement();
  if (!existing) {
    floatWindow = null;
    return;
  }

  var video = existing.querySelector(".vfw-video");
  if (video) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (e) {
      // ignore
    }
  }

  existing.remove();
  floatWindow = null;
}

function createFloatWindow(initialState) {
  var existing = getFloatWindowElement();
  if (existing) {
    floatWindow = existing;
    if (initialState) applyFloatWindowState(existing, initialState);
    return;
  }

  if (initialState && typeof initialState.autoNext === "boolean") {
    autoNext = initialState.autoNext;
  }

  floatWindow = document.createElement("div");
  floatWindow.id = "video-float-window";
  floatWindow.innerHTML = `
    <div class="vfw-header">
      <span class="vfw-title">美女视频</span>
      <div class="vfw-controls">
        <button class="vfw-btn vfw-min">−</button>
        <button class="vfw-btn vfw-close">×</button>
      </div>
    </div>
    <div class="vfw-body">
      <video class="vfw-video" controls autoplay playsinline></video>
      <div class="vfw-loading">加载中...</div>
    </div>
    <div class="vfw-footer">
      <label class="vfw-auto"><input type="checkbox" checked>自动下一个</label>
      <button class="vfw-next">下一个</button>
    </div>
  `;
  document.body.appendChild(floatWindow);

  var header = floatWindow.querySelector(".vfw-header");
  var closeBtn = floatWindow.querySelector(".vfw-close");
  var minBtn = floatWindow.querySelector(".vfw-min");
  var nextBtn = floatWindow.querySelector(".vfw-next");
  var video = floatWindow.querySelector(".vfw-video");
  var loading = floatWindow.querySelector(".vfw-loading");
  var autoCheckbox = floatWindow.querySelector(".vfw-auto input");

  autoCheckbox.checked = autoNext;
  autoCheckbox.addEventListener("change", function() { autoNext = this.checked; });

  header.addEventListener("mousedown", startDrag);
  closeBtn.addEventListener("click", closeFloatWindow);
  minBtn.addEventListener("click", function() { floatWindow.classList.toggle("vfw-minimized"); });
  nextBtn.addEventListener("click", loadVideo);
  video.addEventListener("ended", function() { if (autoNext) loadVideo(); });
  video.addEventListener("canplay", function() { loading.style.display = "none"; });
  video.addEventListener("error", function() {
    loading.textContent = "加载失败，点击重试";
    loading.style.display = "flex";
    loading.style.cursor = "pointer";
    loading.onclick = loadVideo;
  });

  var hasVideoSrc = !!(initialState && initialState.video && initialState.video.src);
  if (initialState) applyFloatWindowState(floatWindow, initialState);
  if (!hasVideoSrc) loadVideo();
}

function startDrag(e) {
  if (e.target.tagName === "BUTTON") return;
  isDragging = true;
  var rect = floatWindow.getBoundingClientRect();
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
}

function onDrag(e) {
  if (!isDragging) return;
  if (!floatWindow) {
    stopDrag();
    return;
  }
  floatWindow.style.left = (e.clientX - dragOffset.x) + "px";
  floatWindow.style.top = (e.clientY - dragOffset.y) + "px";
  floatWindow.style.right = "auto";
  floatWindow.style.bottom = "auto";
}

function stopDrag() {
  isDragging = false;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
}

function loadVideo() {
  var existing = getFloatWindowElement();
  if (!existing) return;
  var video = existing.querySelector(".vfw-video");
  var loading = existing.querySelector(".vfw-loading");
  loading.textContent = "加载中...";
  loading.style.display = "flex";
  loading.style.cursor = "default";
  loading.onclick = null;

  chrome.runtime.sendMessage({ action: "fetchVideo" }, function(response) {
    if (chrome.runtime.lastError) {
      console.log("Message error:", chrome.runtime.lastError);
      loading.textContent = "连接失败";
      return;
    }
    if (response && response.url) {
      console.log("Playing video:", response.url);
      video.src = response.url;
      video.load();
      video.play().catch(function(e) { console.log("Play error:", e); });
    } else {
      loading.textContent = "获取失败";
      console.log("No video URL in response:", response);
    }
  });
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "status") {
    sendResponse({ open: !!getFloatWindowElement() });
    return;
  }
  if (request.action === "exportState") {
    var state = exportFloatWindowState();
    if (!state) {
      sendResponse({ open: false });
      return;
    }
    sendResponse({ open: true, state: state });
    return;
  }
  if (request.action === "toggle") {
    if (getFloatWindowElement()) {
      closeFloatWindow();
      sendResponse({ open: false });
    } else {
      createFloatWindow(null);
      sendResponse({ open: true });
    }
    return;
  }
  if (request.action === "open") {
    var stateToApply = request.state || null;
    createFloatWindow(stateToApply);
    sendResponse({ open: true });
    return;
  }
  if (request.action === "close") {
    closeFloatWindow();
    sendResponse({ open: false });
  }
});

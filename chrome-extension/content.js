let floatWindow = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let autoNext = true;

function createFloatWindow() {
  if (floatWindow) return;

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
  closeBtn.addEventListener("click", function() { floatWindow.remove(); floatWindow = null; });
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

  loadVideo();
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
  if (!floatWindow) return;
  var video = floatWindow.querySelector(".vfw-video");
  var loading = floatWindow.querySelector(".vfw-loading");
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

chrome.runtime.onMessage.addListener(function(request) {
  if (request.action === "toggle") {
    if (floatWindow) {
      floatWindow.remove();
      floatWindow = null;
    } else {
      createFloatWindow();
    }
  }
});

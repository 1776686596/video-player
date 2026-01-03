const video = document.getElementById('video');
const videoWrapper = document.getElementById('videoWrapper');
const loading = document.getElementById('loading');
const nextBtn = document.getElementById('nextBtn');
const autoPlayCheckbox = document.getElementById('autoPlay');
const status = document.getElementById('status');
const image = document.getElementById('image');
const imageLoading = document.getElementById('imageLoading');
const nextImageBtn = document.getElementById('nextImageBtn');
const imageStatus = document.getElementById('imageStatus');
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');

// 自定义控制栏元素
const playPauseBtn = document.getElementById('playPauseBtn');
const progressBar = document.getElementById('progressBar');
const timeDisplay = document.getElementById('timeDisplay');
const volumeBar = document.getElementById('volumeBar');
const speedSelect = document.getElementById('speedSelect');
const fsBtn = document.getElementById('fsBtn');

// 设置相关元素
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const categoryList = document.getElementById('categoryList');
const categorySelect = document.getElementById('categorySelect');
const newCategoryName = document.getElementById('newCategoryName');
const newApiName = document.getElementById('newApiName');
const newApiUrl = document.getElementById('newApiUrl');
const addApiBtn = document.getElementById('addApiBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const settingsTitle = document.getElementById('settingsTitle');
const settingsTabs = document.querySelectorAll('.settings-tab');

let isLoading = false;
let currentVideoSrc = null;
let cacheVersion = 0;
let autoSkipTimer = null;
let consecutiveErrors = 0;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 2000;
const PRELOAD_INTERVAL_MS = 5000;
const PRELOAD_MIN_BUFFER_SEC = 10;
let activePanel = 'video';
let settingsMode = 'video';
let isImageLoading = false;
let currentImageSrc = null;
let imageInitialized = false;

// 格式化时间
function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function revokeObjectUrlIfNeeded(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function makeStreamUrl() {
  return `stream:///video?ts=${Date.now()}`;
}

function clearAutoSkipTimer() {
  if (autoSkipTimer) {
    clearTimeout(autoSkipTimer);
    autoSkipTimer = null;
  }
}

function scheduleAutoSkip() {
  const exponent = Math.max(consecutiveErrors - 1, 0);
  const delay = Math.min(RETRY_BASE_MS * (1.5 ** exponent), RETRY_MAX_MS);
  clearAutoSkipTimer();
  autoSkipTimer = setTimeout(() => {
    autoSkipTimer = null;
    loadVideo();
  }, delay);
  return delay;
}

function setActivePanel(panelId) {
  activePanel = panelId;

  panels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === panelId);
  });
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });

  if (panelId === 'image') {
    if (!video.paused) {
      video.pause();
    }
    stopPreloadLoop();
    if (!imageInitialized) {
      initImage();
      imageInitialized = true;
    }
  } else {
    if (!video.paused) {
      startPreloadLoop();
    }
  }
}

// 自定义控制栏事件
playPauseBtn.addEventListener('click', () => {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
});

video.addEventListener('play', () => {
  playPauseBtn.textContent = '⏸';
  if (activePanel === 'video') {
    startPreloadLoop();
  }
});

video.addEventListener('pause', () => {
  playPauseBtn.textContent = '▶';
  stopPreloadLoop();
});

video.addEventListener('timeupdate', () => {
  if (video.duration) {
    const percent = (video.currentTime / video.duration) * 100;
    progressBar.value = percent;
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  }
});

progressBar.addEventListener('input', () => {
  if (video.duration) {
    video.currentTime = (progressBar.value / 100) * video.duration;
  }
});

volumeBar.addEventListener('input', () => {
  video.volume = volumeBar.value / 100;
});

speedSelect.addEventListener('change', () => {
  video.playbackRate = parseFloat(speedSelect.value);
});

fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    videoWrapper.requestFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
});

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setActivePanel(btn.dataset.panel);
  });
});

// 点击视频切换播放/暂停
video.addEventListener('click', () => {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
});

async function playVideoEl() {
  try {
    await video.play();
  } catch (err) {
    console.log('Autoplay blocked:', err);
  }
}

async function fetchVideoUrl() {
  const videoUrl = await window.__TAURI__.core.invoke('fetch_video');
  console.log('Fetching video:', videoUrl);
  return videoUrl;
}

function triggerPreload() {
  return window.__TAURI__.core.invoke('preload_next').catch(() => {});
}

let preloadInterval = null;
let preloadInFlight = false;
let preloadEnabled = false;

function getBufferedAheadSeconds() {
  try {
    const buffered = video.buffered;
    const current = video.currentTime;
    for (let i = 0; i < buffered.length; i += 1) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (current >= start && current <= end) {
        return Math.max(end - current, 0);
      }
    }
  } catch {}
  return 0;
}

function shouldPreload() {
  if (!preloadEnabled || activePanel !== 'video') return false;
  if (video.paused || video.readyState < 3) return false;
  return getBufferedAheadSeconds() >= PRELOAD_MIN_BUFFER_SEC;
}

async function runPreloadTick() {
  if (!shouldPreload() || preloadInFlight) return;
  preloadInFlight = true;
  try {
    await triggerPreload();
  } finally {
    preloadInFlight = false;
  }
}

function startPreloadLoop() {
  if (preloadInterval) return;
  preloadEnabled = true;
  runPreloadTick();
  preloadInterval = setInterval(runPreloadTick, PRELOAD_INTERVAL_MS);
}
function stopPreloadLoop() {
  preloadEnabled = false;
  if (preloadInterval) {
    clearInterval(preloadInterval);
    preloadInterval = null;
  }
}

async function tryPopPreloaded() {
  try {
    const count = await window.__TAURI__.core.invoke('get_preload_count');
    if (count > 0) {
      return await window.__TAURI__.core.invoke('pop_next_video');
    }
  } catch {}
  return null;
}

function waitForVideoReady(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      console.error('Video error code:', video.error?.code);
      reject(new Error('视频加载失败: code=' + video.error?.code));
    };

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, timeoutMs);
  });
}

async function setVideoSource(sourceUrl) {
  console.log('Playing:', sourceUrl);
  video.pause();
  video.currentTime = 0;
  video.src = sourceUrl;
  await waitForVideoReady();
}

async function fetchImageUrl() {
  const imageUrl = await window.__TAURI__.core.invoke('fetch_image');
  console.log('Fetching image:', imageUrl);
  return imageUrl;
}

async function fetchImageAsBlobByUrl(imageUrl) {
  const data = await window.__TAURI__.core.invoke('download_image', { url: imageUrl });
  const blob = new Blob([new Uint8Array(data)]);
  return URL.createObjectURL(blob);
}

function setImageSource(sourceUrl) {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      reject(new Error('图片加载失败'));
    };
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    image.src = sourceUrl;
  });
}

async function loadVideo() {
  if (isLoading) return;
  stopPreloadLoop();
  clearAutoSkipTimer();
  isLoading = true;
  nextBtn.disabled = true;
  status.classList.remove('error');
  const version = cacheVersion;
  let shouldAutoSkip = false;

  try {
    revokeObjectUrlIfNeeded(currentVideoSrc);
    currentVideoSrc = null;
    loading.classList.remove('hidden');
    status.textContent = '加载中...';

    const preloaded = await tryPopPreloaded();
    const directUrl = preloaded || await fetchVideoUrl();

    if (version !== cacheVersion) {
      return;
    }

    try {
      currentVideoSrc = directUrl;
      await setVideoSource(directUrl);
    } catch (err) {
      console.warn('Direct video load failed, using stream proxy:', err);
      const streamUrl = makeStreamUrl();
      currentVideoSrc = streamUrl;
      await setVideoSource(streamUrl);
    }

    if (version !== cacheVersion) {
      return;
    }

    await playVideoEl();
    startPreloadLoop();
    status.textContent = '';
    status.classList.remove('error');
    consecutiveErrors = 0;
    loading.classList.add('hidden');
  } catch (err) {
    console.error('Error:', err);
    shouldAutoSkip = true;
    consecutiveErrors += 1;
    const errMsg = err?.message || err;
    const delayMs = scheduleAutoSkip();
    const delaySeconds = Math.ceil(delayMs / 1000);
    status.textContent = `加载失败: ${errMsg}，${delaySeconds}秒后自动跳过`;
    status.classList.add('error');
    loading.classList.add('hidden');
  } finally {
    isLoading = false;
    nextBtn.disabled = false;
    if (shouldAutoSkip) {
      return;
    }
  }
}

async function loadImage() {
  if (isImageLoading) return;
  isImageLoading = true;
  nextImageBtn.disabled = true;
  imageStatus.classList.remove('error');
  imageLoading.classList.remove('hidden');

  try {
    revokeObjectUrlIfNeeded(currentImageSrc);
    currentImageSrc = null;
    imageStatus.textContent = '加载中...';
    const imageUrl = await fetchImageUrl();

    try {
      currentImageSrc = imageUrl;
      await setImageSource(imageUrl);
    } catch (err) {
      console.warn('Direct image load failed, using blob proxy:', err);
      const blobUrl = await fetchImageAsBlobByUrl(imageUrl);
      currentImageSrc = blobUrl;
      await setImageSource(blobUrl);
    }

    imageStatus.textContent = '';
    imageStatus.classList.remove('error');
    imageLoading.classList.add('hidden');
  } catch (err) {
    console.error('Image error:', err);
    const errMsg = err?.message || err;
    imageStatus.textContent = `加载失败: ${errMsg}`;
    imageStatus.classList.add('error');
    imageLoading.classList.add('hidden');
  } finally {
    isImageLoading = false;
    nextImageBtn.disabled = false;
  }
}

async function initImage() {
  imageLoading.classList.remove('hidden');
  imageStatus.textContent = '加载首张图片...';
  imageStatus.classList.remove('error');

  try {
    if (!window.__TAURI__?.core?.invoke) {
      throw new Error('Tauri API not available');
    }
    await loadImage();
  } catch (err) {
    console.error('Init image error:', err);
    const errMsg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
    imageStatus.textContent = '加载失败: ' + errMsg;
    imageStatus.classList.add('error');
    imageLoading.classList.add('hidden');
  }
}

function clearImageCache(showStatus = true) {
  revokeObjectUrlIfNeeded(currentImageSrc);
  currentImageSrc = null;
  image.removeAttribute('src');
  imageLoading.classList.add('hidden');
  if (showStatus) {
    imageStatus.classList.remove('error');
    imageStatus.textContent = '缓存已清理';
  }
}

async function clearVideoCache(showStatus = true) {
  cacheVersion += 1;
  consecutiveErrors = 0;
  clearAutoSkipTimer();
  stopPreloadLoop();

  revokeObjectUrlIfNeeded(currentVideoSrc);
  currentVideoSrc = null;

  video.pause();
  video.removeAttribute('src');
  video.load();
  loading.classList.add('hidden');
  status.classList.remove('error');
  if (showStatus) {
    status.textContent = '缓存已清理';
  }

  try {
    await window.__TAURI__.core.invoke('clear_preload_queue');
  } catch (err) {
    console.warn('clear_preload_queue failed:', err);
  }
}

nextBtn.addEventListener('click', loadVideo);

video.addEventListener('ended', () => {
  if (autoPlayCheckbox.checked) {
    loadVideo();
  }
});

nextImageBtn.addEventListener('click', loadImage);

async function init() {
  loading.classList.remove('hidden');
  status.textContent = '加载首个视频...';
  status.classList.remove('error');
  const version = cacheVersion;

  try {
    console.log('Tauri available:', !!window.__TAURI__);

    if (!window.__TAURI__?.core?.invoke) {
      throw new Error('Tauri API not available');
    }

    revokeObjectUrlIfNeeded(currentVideoSrc);
    currentVideoSrc = null;
    const directUrl = await fetchVideoUrl();
    console.log('Init video URL:', directUrl);

    if (version !== cacheVersion) {
      return;
    }

    try {
      currentVideoSrc = directUrl;
      await setVideoSource(directUrl);
    } catch (err) {
      console.warn('Direct video load failed, using stream proxy:', err);
      const streamUrl = makeStreamUrl();
      currentVideoSrc = streamUrl;
      await setVideoSource(streamUrl);
    }

    await playVideoEl();
    startPreloadLoop();
    status.textContent = '';
    status.classList.remove('error');
    consecutiveErrors = 0;
    loading.classList.add('hidden');
  } catch (err) {
    console.error('Init error:', err);
    const errMsg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
    consecutiveErrors += 1;
    if (window.__TAURI__?.core?.invoke) {
      const delayMs = scheduleAutoSkip();
      const delaySeconds = Math.ceil(delayMs / 1000);
      status.textContent = `加载失败: ${errMsg}，${delaySeconds}秒后自动跳过`;
    } else {
      status.textContent = '加载失败: ' + errMsg;
    }
    status.classList.add('error');
    loading.classList.add('hidden');
  }
}

if (window.__TAURI__) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
}

// ============================================================
// 设置功能
// ============================================================

const CATEGORY_COMMANDS = {
  video: {
    getCategories: 'get_categories',
    getCurrentCategory: 'get_current_category',
    setCurrentCategory: 'set_current_category',
    addCategory: 'add_custom_category',
    addApi: 'add_custom_api',
    deleteApi: 'delete_custom_api',
    deleteCategory: 'delete_custom_category',
    clearCache: 'clear_preload_queue',
  },
  image: {
    getCategories: 'get_image_categories',
    getCurrentCategory: 'get_current_image_category',
    setCurrentCategory: 'set_current_image_category',
    addCategory: 'add_custom_image_category',
    addApi: 'add_custom_image_api',
    deleteApi: 'delete_custom_image_api',
    deleteCategory: 'delete_custom_image_category',
  },
};

function getCommandsForMode(mode) {
  return CATEGORY_COMMANDS[mode] || CATEGORY_COMMANDS.video;
}

function setSettingsMode(mode) {
  settingsMode = mode;
  settingsTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  if (settingsTitle) {
    settingsTitle.textContent = '缓存管理';
  }
  if (clearCacheBtn) {
    clearCacheBtn.textContent = mode === 'image' ? '清理图片缓存' : '清理视频缓存';
  }
  newCategoryName.classList.add('hidden');
  newCategoryName.value = '';
  newApiName.value = '';
  newApiUrl.value = '';
  categorySelect.value = '';
  renderCategoryList(mode);
}

async function renderCategoryList(mode = settingsMode) {
  try {
    const commands = getCommandsForMode(mode);
    const categories = await window.__TAURI__.core.invoke(commands.getCategories);
    const currentCategory = await window.__TAURI__.core.invoke(commands.getCurrentCategory);

    // 随机选项
    const randomHtml = `
      <div class="category-item special ${currentCategory === 'random' ? 'active' : ''}" data-id="random">
        <div class="category-header">
          <input type="radio" name="category" ${currentCategory === 'random' ? 'checked' : ''}>
          <div class="category-info">
            <div class="category-name">🎲 随机 <span class="api-badge">推荐</span></div>
            <div class="category-meta">从所有分类中随机选择</div>
          </div>
        </div>
      </div>
    `;

    // 分类列表
    const categoriesHtml = categories.map(cat => `
      <div class="category-item ${cat.id === currentCategory ? 'active' : ''}" data-id="${cat.id}">
        <div class="category-header">
          <input type="radio" name="category" ${cat.id === currentCategory ? 'checked' : ''}>
          <div class="category-info">
            <div class="category-name">${cat.name} ${cat.builtin ? '<span class="api-badge">内置</span>' : ''}</div>
            <div class="category-meta">${cat.endpoints.length} 个接口</div>
          </div>
          <button class="category-toggle" data-id="${cat.id}">▼</button>
          ${!cat.builtin ? `<button class="category-delete" data-id="${cat.id}">×</button>` : ''}
        </div>
        <div class="category-endpoints" data-id="${cat.id}">
          ${cat.endpoints.map(ep => `
            <div class="endpoint-item">
              <span class="endpoint-name">${ep.name}</span>
              <span class="endpoint-url">${ep.url}</span>
              ${!ep.builtin ? `<button class="endpoint-delete" data-id="${ep.id}">×</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    categoryList.innerHTML = randomHtml + categoriesHtml;

    // 更新分类选择下拉框
    categorySelect.innerHTML = `
      <option value="">选择分类...</option>
      ${categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('')}
      <option value="__new__">+ 新建分类</option>
    `;

    // 绑定分类选择事件
    categoryList.querySelectorAll('.category-header').forEach(header => {
      header.addEventListener('click', async (e) => {
        if (e.target.closest('.category-toggle') || e.target.closest('.category-delete')) return;
        const categoryId = header.closest('.category-item').dataset.id;
        await window.__TAURI__.core.invoke(commands.setCurrentCategory, { categoryId });
        if (mode === 'video') {
          await window.__TAURI__.core.invoke(commands.clearCache);
        } else if (activePanel === 'image') {
          loadImage();
        }
        renderCategoryList(mode);
      });
    });

    // 绑定展开/折叠事件
    categoryList.querySelectorAll('.category-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const catId = btn.dataset.id;
        const endpoints = categoryList.querySelector(`.category-endpoints[data-id="${catId}"]`);
        endpoints.classList.toggle('open');
        btn.classList.toggle('open');
      });
    });

    // 绑定删除分类事件
    categoryList.querySelectorAll('.category-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除该分类及其所有接口？')) return;
        try {
          await window.__TAURI__.core.invoke(commands.deleteCategory, { categoryId: btn.dataset.id });
          renderCategoryList(mode);
        } catch (err) {
          alert(err);
        }
      });
    });

    // 绑定删除接口事件
    categoryList.querySelectorAll('.endpoint-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await window.__TAURI__.core.invoke(commands.deleteApi, { apiId: btn.dataset.id });
          renderCategoryList(mode);
        } catch (err) {
          alert(err);
        }
      });
    });
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// 分类选择切换
categorySelect.addEventListener('change', () => {
  if (categorySelect.value === '__new__') {
    newCategoryName.classList.remove('hidden');
    newCategoryName.focus();
  } else {
    newCategoryName.classList.add('hidden');
    newCategoryName.value = '';
  }
});

settingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  setSettingsMode(activePanel);
});

settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setSettingsMode(tab.dataset.mode);
  });
});

closeSettings.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.add('hidden');
  }
});

addApiBtn.addEventListener('click', async () => {
  const name = newApiName.value.trim();
  const url = newApiUrl.value.trim();
  let categoryId = categorySelect.value;
  const commands = getCommandsForMode(settingsMode);

  if (!name || !url) {
    alert('请填写接口名称和URL');
    return;
  }

  try {
    // 如果是新建分类
    if (categoryId === '__new__') {
      const catName = newCategoryName.value.trim();
      if (!catName) {
        alert('请填写新分类名称');
        return;
      }
      const newCat = await window.__TAURI__.core.invoke(commands.addCategory, { name: catName });
      categoryId = newCat.id;
    }

    if (!categoryId) {
      alert('请选择分类');
      return;
    }

    await window.__TAURI__.core.invoke(commands.addApi, { categoryId, name, url });

    // 清空表单
    newApiName.value = '';
    newApiUrl.value = '';
    newCategoryName.value = '';
    newCategoryName.classList.add('hidden');
    categorySelect.value = '';

    renderCategoryList(settingsMode);
  } catch (err) {
    alert(err);
  }
});

clearCacheBtn.addEventListener('click', async () => {
  const isImageMode = settingsMode === 'image';
  const confirmText = isImageMode
    ? '确定清理已下载的图片缓存？'
    : '确定清理已下载的视频缓存？当前播放会停止。';
  if (!confirm(confirmText)) return;

  if (isImageMode) {
    clearImageCache();
  } else {
    await clearVideoCache();
  }
});

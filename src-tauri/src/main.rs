#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use bytes::Bytes;
use rand::seq::SliceRandom;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_RANGE, CONTENT_TYPE,
    LOCATION, RANGE, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};
use uuid::Uuid;

// ============================================================
// 数据结构
// ============================================================

struct PreloadedVideo {
    id: String,
    url: String,
    data: Bytes,
}

struct PreloadGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> PreloadGuard<'a> {
    fn try_new(flag: &'a AtomicBool) -> Option<Self> {
        if flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Some(Self { flag })
        } else {
            None
        }
    }
}

impl Drop for PreloadGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct ApiEndpoint {
    id: String,
    name: String,
    url: String,
    builtin: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct ApiCategory {
    id: String,
    name: String,
    builtin: bool,
    endpoints: Vec<ApiEndpoint>,
}

const RANDOM_CATEGORY: &str = "random";

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn get_builtin_categories() -> Vec<ApiCategory> {
    vec![
        ApiCategory {
            id: "taozi".into(),
            name: "桃子API".into(),
            builtin: true,
            endpoints: vec![
                ApiEndpoint {
                    id: "taozi_1".into(),
                    name: "抖音快手美女".into(),
                    url: "https://api.tzjsy.cn/sp/dyksmn/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_2".into(),
                    name: "黑丝".into(),
                    url: "https://api.tzjsy.cn/sp/hs/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_3".into(),
                    name: "白丝".into(),
                    url: "https://api.tzjsy.cn/sp/bs/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_4".into(),
                    name: "JK制服".into(),
                    url: "https://api.tzjsy.cn/sp/jk/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_5".into(),
                    name: "甜美".into(),
                    url: "https://api.tzjsy.cn/sp/tm/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_6".into(),
                    name: "纯欲".into(),
                    url: "https://api.tzjsy.cn/sp/cy/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_7".into(),
                    name: "QC".into(),
                    url: "https://api.tzjsy.cn/sp/qc/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_8".into(),
                    name: "LL".into(),
                    url: "https://api.tzjsy.cn/sp/ll/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_9".into(),
                    name: "YZ".into(),
                    url: "https://api.tzjsy.cn/sp/yz/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_10".into(),
                    name: "515".into(),
                    url: "https://api.tzjsy.cn/sp/515/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_11".into(),
                    name: "COS".into(),
                    url: "https://api.tzjsy.cn/sp/cos/video.php".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "taozi_12".into(),
                    name: "YOZ".into(),
                    url: "https://api.tzjsy.cn/sp/yoz/video.php".into(),
                    builtin: true,
                },
            ],
        },
        ApiCategory {
            id: "wanfeng".into(),
            name: "晚风API".into(),
            builtin: true,
            endpoints: vec![ApiEndpoint {
                id: "wanfeng_1".into(),
                name: "跳舞视频".into(),
                url: "http://api.nonebot.top/api/v1/random/dance_video".into(),
                builtin: true,
            }],
        },
        ApiCategory {
            id: "huai".into(),
            name: "Huai API".into(),
            builtin: true,
            endpoints: vec![ApiEndpoint {
                id: "huai_1".into(),
                name: "抖音视频".into(),
                url: "http://api.huaiyan.top:81/api/dy?type=mp4".into(),
                builtin: true,
            }],
        },
    ]
}

fn get_builtin_image_categories() -> Vec<ApiCategory> {
    vec![
        ApiCategory {
            id: "btstu".into(),
            name: "BTSTU美图".into(),
            builtin: true,
            endpoints: vec![
                ApiEndpoint {
                    id: "btstu_1".into(),
                    name: "随机美女(直连)".into(),
                    url: "https://api.btstu.cn/sjbz/api.php?lx=meizi".into(),
                    builtin: true,
                },
                ApiEndpoint {
                    id: "btstu_2".into(),
                    name: "随机美女(JSON)".into(),
                    url: "https://api.btstu.cn/sjbz/api.php?lx=meizi&format=json".into(),
                    builtin: true,
                },
            ],
        },
        ApiCategory {
            id: "wanfeng".into(),
            name: "晚风API".into(),
            builtin: true,
            endpoints: vec![ApiEndpoint {
                id: "wanfeng_1".into(),
                name: "晚风api".into(),
                url: "http://api.nonebot.top/api/v1/random/tuwan".into(),
                builtin: true,
            }],
        },
    ]
}

// ============================================================
// 应用状态
// ============================================================

struct AppState {
    current_video_url: Mutex<Option<String>>,
    current_category: Mutex<String>,
    custom_categories: Mutex<Vec<ApiCategory>>,
    custom_endpoints: Mutex<Vec<(String, ApiEndpoint)>>,
    current_image_category: Mutex<String>,
    custom_image_categories: Mutex<Vec<ApiCategory>>,
    custom_image_endpoints: Mutex<Vec<(String, ApiEndpoint)>>,
    preload_queue: Mutex<VecDeque<PreloadedVideo>>,
    playing_video: Mutex<Option<PreloadedVideo>>,
    preload_in_progress: AtomicBool,
}

fn get_all_categories(state: &State<AppState>) -> Vec<ApiCategory> {
    let mut categories = get_builtin_categories();
    let custom_categories = state.custom_categories.lock().unwrap();
    let custom_endpoints = state.custom_endpoints.lock().unwrap();

    // 添加自定义接口到内置分类
    for cat in categories.iter_mut() {
        for (cat_id, ep) in custom_endpoints.iter() {
            if cat_id == &cat.id {
                cat.endpoints.push(ep.clone());
            }
        }
    }

    // 添加自定义分类
    for custom_cat in custom_categories.iter() {
        let mut cat = custom_cat.clone();
        for (cat_id, ep) in custom_endpoints.iter() {
            if cat_id == &cat.id {
                cat.endpoints.push(ep.clone());
            }
        }
        categories.push(cat);
    }

    categories
}

fn get_all_image_categories(state: &State<AppState>) -> Vec<ApiCategory> {
    let mut categories = get_builtin_image_categories();
    let custom_categories = state.custom_image_categories.lock().unwrap();
    let custom_endpoints = state.custom_image_endpoints.lock().unwrap();

    // 添加自定义接口到内置分类
    for cat in categories.iter_mut() {
        for (cat_id, ep) in custom_endpoints.iter() {
            if cat_id == &cat.id {
                cat.endpoints.push(ep.clone());
            }
        }
    }

    // 添加自定义分类
    for custom_cat in custom_categories.iter() {
        let mut cat = custom_cat.clone();
        for (cat_id, ep) in custom_endpoints.iter() {
            if cat_id == &cat.id {
                cat.endpoints.push(ep.clone());
            }
        }
        categories.push(cat);
    }

    categories
}

fn category_exists(state: &State<AppState>, category_id: &str) -> bool {
    if category_id == RANDOM_CATEGORY {
        return true;
    }
    get_all_categories(state).iter().any(|c| c.id == category_id)
}

fn image_category_exists(state: &State<AppState>, category_id: &str) -> bool {
    if category_id == RANDOM_CATEGORY {
        return true;
    }
    get_all_image_categories(state)
        .iter()
        .any(|c| c.id == category_id)
}

// ============================================================
// API 响应解析
// ============================================================

#[derive(Deserialize)]
struct ApiResponse {
    code: i32,
    #[allow(dead_code)]
    msg: Option<String>,
    data: String,
}

fn extract_image_url_from_json(value: &Value) -> Option<String> {
    if let Value::String(url) = value {
        return Some(url.clone());
    }

    let direct_keys = ["data", "imgurl", "url", "image", "pic"];
    for key in direct_keys {
        if let Some(url) = value.get(key).and_then(|v| v.as_str()) {
            return Some(url.to_string());
        }
    }

    if let Some(data) = value.get("data") {
        for key in ["url", "imgurl", "image", "pic"] {
            if let Some(url) = data.get(key).and_then(|v| v.as_str()) {
                return Some(url.to_string());
            }
        }
    }

    None
}

fn build_client() -> reqwest::Client {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
        ),
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("zh-CN,zh;q=0.9"));

    reqwest::Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default()
}

fn resolve_redirect_location(base: &reqwest::Url, location: &str) -> Option<String> {
    let location = location.trim();
    if location.is_empty() {
        return None;
    }
    base.join(location)
        .map(|url| url.to_string())
        .ok()
        .or_else(|| Some(location.to_string()))
}

fn header_value_to_string(value: &HeaderValue) -> String {
    if let Ok(s) = value.to_str() {
        s.to_string()
    } else {
        String::from_utf8_lossy(value.as_bytes()).to_string()
    }
}

// ============================================================
// Tauri Commands
// ============================================================

#[tauri::command]
async fn fetch_video(state: State<'_, AppState>) -> Result<String, String> {
    let api_url = {
        let current = state.current_category.lock().unwrap().clone();
        let categories = get_all_categories(&state);

        let candidates: Vec<&ApiEndpoint> = if current == RANDOM_CATEGORY {
            categories.iter().flat_map(|c| &c.endpoints).collect()
        } else {
            categories
                .iter()
                .find(|c| c.id == current)
                .map(|c| c.endpoints.iter().collect())
                .unwrap_or_default()
        };

        if candidates.is_empty() {
            return Err("没有可用的接口".into());
        }

        let mut rng = rand::thread_rng();
        candidates.choose(&mut rng).unwrap().url.clone()
    };

    // 使用跟随重定向的客户端获取最终视频URL
    let client = reqwest::Client::builder()
        .default_headers({
            let mut h = HeaderMap::new();
            h.insert(USER_AGENT, HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
            ));
            h.insert(ACCEPT, HeaderValue::from_static("*/*"));
            h
        })
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let final_url = resp.url().to_string();
    let status = resp.status();
    println!("fetch_video: api={}, final={}, status={}", api_url, final_url, status);

    if status.is_redirection() {
        if let Some(location) = resp
            .headers()
            .get(LOCATION)
            .map(header_value_to_string)
            .and_then(|loc| resolve_redirect_location(resp.url(), &loc))
        {
            *state.current_video_url.lock().unwrap() = Some(location.clone());
            return Ok(location);
        }
        return Err("重定向但无Location头".into());
    }

    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    // 直接返回视频流的接口（URL 可能不含扩展名）
    if content_type.starts_with("video/") || content_type.starts_with("application/octet-stream") {
        *state.current_video_url.lock().unwrap() = Some(final_url.clone());
        return Ok(final_url);
    }

    // 如果最终URL是视频文件，直接返回
    if final_url.contains(".mp4") || final_url.contains(".webm") || final_url.contains(".m3u8") {
        *state.current_video_url.lock().unwrap() = Some(final_url.clone());
        return Ok(final_url);
    }

    // 尝试解析JSON响应
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if text.starts_with('{') {
        let api_resp: ApiResponse =
            serde_json::from_str(&text).map_err(|e| format!("解析失败: {}", e))?;

        if api_resp.code != 200 {
            return Err("API返回错误".into());
        }

        println!("fetch_video: JSON data = {}", api_resp.data);
        *state.current_video_url.lock().unwrap() = Some(api_resp.data.clone());
        return Ok(api_resp.data);
    }

    // 如果最终URL不同于原始URL，可能是重定向到视频
    if final_url != api_url {
        *state.current_video_url.lock().unwrap() = Some(final_url.clone());
        return Ok(final_url);
    }

    Err(format!("未知响应格式, 状态码: {}", status))
}

#[tauri::command]
async fn fetch_image(state: State<'_, AppState>) -> Result<String, String> {
    let api_url = {
        let current = state.current_image_category.lock().unwrap().clone();
        let categories = get_all_image_categories(&state);

        let candidates: Vec<&ApiEndpoint> = if current == RANDOM_CATEGORY {
            categories.iter().flat_map(|c| &c.endpoints).collect()
        } else {
            categories
                .iter()
                .find(|c| c.id == current)
                .map(|c| c.endpoints.iter().collect())
                .unwrap_or_default()
        };

        if candidates.is_empty() {
            return Err("没有可用的接口".into());
        }

        let mut rng = rand::thread_rng();
        candidates.choose(&mut rng).unwrap().url.clone()
    };

    let client = reqwest::Client::builder()
        .default_headers({
            let mut h = HeaderMap::new();
            h.insert(
                USER_AGENT,
                HeaderValue::from_static(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
                ),
            );
            h.insert(ACCEPT, HeaderValue::from_static("*/*"));
            h
        })
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let final_url = resp.url().to_string();
    let status = resp.status();
    println!("fetch_image: api={}, final={}, status={}", api_url, final_url, status);

    if status.is_redirection() {
        if let Some(location) = resp
            .headers()
            .get(LOCATION)
            .map(header_value_to_string)
            .and_then(|loc| resolve_redirect_location(resp.url(), &loc))
        {
            return Ok(location);
        }
        return Err("重定向但无Location头".into());
    }

    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if content_type.starts_with("image/") || content_type.starts_with("application/octet-stream")
    {
        return Ok(final_url);
    }

    if final_url.contains(".jpg")
        || final_url.contains(".jpeg")
        || final_url.contains(".png")
        || final_url.contains(".webp")
        || final_url.contains(".gif")
        || final_url.contains(".bmp")
    {
        return Ok(final_url);
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let trimmed = text.trim();
    if trimmed.starts_with('{') {
        let value: Value =
            serde_json::from_str(trimmed).map_err(|e| format!("解析失败: {}", e))?;
        if let Some(url) = extract_image_url_from_json(&value) {
            return Ok(url);
        }
        return Err("JSON中未找到图片地址".into());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    if final_url != api_url {
        return Ok(final_url);
    }

    Err(format!("未知响应格式, 状态码: {}", status))
}

async fn get_video_url_internal(state: &State<'_, AppState>) -> Result<String, String> {
    let client = build_client();

    let api_url = {
        let current = state.current_category.lock().unwrap().clone();
        let categories = get_all_categories(state);

        let candidates: Vec<&ApiEndpoint> = if current == RANDOM_CATEGORY {
            categories.iter().flat_map(|c| &c.endpoints).collect()
        } else {
            categories
                .iter()
                .find(|c| c.id == current)
                .map(|c| c.endpoints.iter().collect())
                .unwrap_or_default()
        };

        if candidates.is_empty() {
            return Err("没有可用的接口".into());
        }

        let mut rng = rand::thread_rng();
        candidates.choose(&mut rng).unwrap().url.clone()
    };

    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    if status.is_redirection() {
        if let Some(location) = resp
            .headers()
            .get(LOCATION)
            .map(header_value_to_string)
            .and_then(|loc| resolve_redirect_location(resp.url(), &loc))
        {
            return Ok(location);
        }
        return Err("重定向但无Location头".into());
    }

    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if content_type.starts_with("video/") || content_type.starts_with("application/octet-stream") {
        return Ok(resp.url().to_string());
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if text.starts_with('{') {
        let api_resp: ApiResponse =
            serde_json::from_str(&text).map_err(|e| format!("解析失败: {}", e))?;

        if api_resp.code != 200 {
            return Err("API返回错误".into());
        }

        return Ok(api_resp.data);
    }

    Err(format!("未知响应格式, 状态码: {}", status))
}

#[tauri::command]
async fn download_video(url: String) -> Result<Vec<u8>, String> {
    println!("download_video: {}", url);

    let client = reqwest::Client::builder()
        .default_headers({
            let mut h = HeaderMap::new();
            h.insert(USER_AGENT, HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
            ));
            h.insert(REFERER, HeaderValue::from_static("https://api.tzjsy.cn/"));
            h
        })
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    // 先尝试直接下载，如果是重定向则跟随
    let mut current_url = url;
    let mut redirect_count = 0;

    let resp = loop {
        let resp = client
            .get(&current_url)
            .send()
            .await
            .map_err(|e| format!("下载失败: {}", e))?;

        if resp.status().is_redirection() {
            if redirect_count >= 5 {
                return Err("重定向次数过多".into());
            }

            let location = resp
                .headers()
                .get(LOCATION)
                .map(header_value_to_string)
                .and_then(|loc| resolve_redirect_location(resp.url(), &loc));

            if let Some(next_url) = location {
                println!("download_video: redirected to {}", next_url);
                current_url = next_url;
                redirect_count += 1;
                continue;
            }

            return Err("重定向但无Location头".into());
        }

        if !resp.status().is_success() {
            return Err(format!("HTTP错误: {}", resp.status()));
        }

        break resp;
    };

    let content_length = resp.content_length().unwrap_or(0);
    println!("download_video: content_length = {}", content_length);

    if content_length > 100 * 1024 * 1024 {
        return Err("视频文件过大 (>100MB)".into());
    }

    let data = resp
        .bytes()
        .await
        .map_err(|e| format!("读取视频失败: {}", e))?;

    println!("download_video: downloaded {} bytes", data.len());
    Ok(data.to_vec())
}

#[tauri::command]
async fn download_image(url: String) -> Result<Vec<u8>, String> {
    println!("download_image: {}", url);

    let client = reqwest::Client::builder()
        .default_headers({
            let mut h = HeaderMap::new();
            h.insert(
                USER_AGENT,
                HeaderValue::from_static(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
                ),
            );
            h
        })
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let mut current_url = url;
    let mut redirect_count = 0;

    let resp = loop {
        let resp = client
            .get(&current_url)
            .send()
            .await
            .map_err(|e| format!("下载失败: {}", e))?;

        if resp.status().is_redirection() {
            if redirect_count >= 5 {
                return Err("重定向次数过多".into());
            }

            let location = resp
                .headers()
                .get(LOCATION)
                .map(header_value_to_string)
                .and_then(|loc| resolve_redirect_location(resp.url(), &loc));

            if let Some(next_url) = location {
                println!("download_image: redirected to {}", next_url);
                current_url = next_url;
                redirect_count += 1;
                continue;
            }

            return Err("重定向但无Location头".into());
        }

        if !resp.status().is_success() {
            return Err(format!("HTTP错误: {}", resp.status()));
        }

        break resp;
    };

    let content_length = resp.content_length().unwrap_or(0);
    println!("download_image: content_length = {}", content_length);

    if content_length > 15 * 1024 * 1024 {
        return Err("图片文件过大 (>15MB)".into());
    }

    let data = resp
        .bytes()
        .await
        .map_err(|e| format!("读取图片失败: {}", e))?;

    if data.len() > 15 * 1024 * 1024 {
        return Err("图片文件过大 (>15MB)".into());
    }

    println!("download_image: downloaded {} bytes", data.len());
    Ok(data.to_vec())
}

const MAX_PRELOAD: usize = 2;

async fn preload_one(state: &State<'_, AppState>) -> Result<(), String> {
    let url = get_video_url_internal(state).await?;

    let client = reqwest::Client::builder()
        .default_headers({
            let mut h = HeaderMap::new();
            h.insert(USER_AGENT, HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
            ));
            h.insert(REFERER, HeaderValue::from_static("https://api.tzjsy.cn/"));
            h
        })
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let resp = client.get(&url).send().await.map_err(|e| format!("下载失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP错误: {}", resp.status()));
    }
    if resp.content_length().unwrap_or(0) > 100 * 1024 * 1024 {
        return Err("视频文件过大".into());
    }

    let data = resp.bytes().await.map_err(|e| format!("读取失败: {}", e))?;
    if data.len() > 100 * 1024 * 1024 {
        return Err("视频文件过大".into());
    }

    let mut queue = state.preload_queue.lock().unwrap();
    if queue.len() < MAX_PRELOAD {
        queue.push_back(PreloadedVideo {
            id: Uuid::new_v4().to_string(),
            url,
            data,
        });
    }
    Ok(())
}

#[tauri::command]
async fn preload_next(state: State<'_, AppState>) -> Result<usize, String> {
    let _guard = match PreloadGuard::try_new(&state.preload_in_progress) {
        Some(guard) => guard,
        None => return Ok(state.preload_queue.lock().unwrap().len()),
    };

    let queue_len = state.preload_queue.lock().unwrap().len();
    let need = MAX_PRELOAD.saturating_sub(queue_len);
    if need == 0 {
        return Ok(queue_len);
    }

    let _ = preload_one(&state).await;

    Ok(state.preload_queue.lock().unwrap().len())
}

#[tauri::command]
fn get_preload_count(state: State<'_, AppState>) -> usize {
    state.preload_queue.lock().unwrap().len()
}

#[tauri::command]
fn pop_next_video(state: State<'_, AppState>) -> Result<String, String> {
    let video = state
        .preload_queue
        .lock()
        .unwrap()
        .pop_front()
        .ok_or_else(|| "没有预加载的视频".to_string())?;

    let id = video.id.clone();
    *state.current_video_url.lock().unwrap() = Some(video.url.clone());
    *state.playing_video.lock().unwrap() = Some(video);
    Ok(format!("stream:///video/{}", id))
}

#[tauri::command]
fn clear_preload_queue(state: State<'_, AppState>) {
    state.preload_queue.lock().unwrap().clear();
    *state.playing_video.lock().unwrap() = None;
}

#[tauri::command]
fn get_categories(state: State<'_, AppState>) -> Vec<ApiCategory> {
    get_all_categories(&state)
}

#[tauri::command]
fn get_current_category(state: State<'_, AppState>) -> String {
    state.current_category.lock().unwrap().clone()
}

#[tauri::command]
fn set_current_category(state: State<'_, AppState>, category_id: String) -> Result<(), String> {
    if !category_exists(&state, &category_id) {
        return Err("分类不存在".into());
    }
    *state.current_category.lock().unwrap() = category_id;
    Ok(())
}

#[tauri::command]
fn add_custom_category(state: State<'_, AppState>, name: String) -> Result<ApiCategory, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".into());
    }

    let category = ApiCategory {
        id: format!("custom_cat_{}", now_millis()),
        name: name.into(),
        builtin: false,
        endpoints: vec![],
    };

    state.custom_categories.lock().unwrap().push(category.clone());
    Ok(category)
}

#[tauri::command]
fn add_custom_api(
    state: State<'_, AppState>,
    category_id: String,
    name: String,
    url: String,
) -> Result<ApiEndpoint, String> {
    let name = name.trim();
    let url = url.trim();

    if name.is_empty() || url.is_empty() {
        return Err("名称和URL不能为空".into());
    }

    // 验证分类存在（不能是 random）
    if category_id == RANDOM_CATEGORY || !category_exists(&state, &category_id) {
        return Err("分类不存在".into());
    }

    let endpoint = ApiEndpoint {
        id: format!("custom_ep_{}", now_millis()),
        name: name.into(),
        url: url.into(),
        builtin: false,
    };

    state
        .custom_endpoints
        .lock()
        .unwrap()
        .push((category_id, endpoint.clone()));

    Ok(endpoint)
}

#[tauri::command]
fn delete_custom_api(state: State<'_, AppState>, api_id: String) -> Result<(), String> {
    let mut endpoints = state.custom_endpoints.lock().unwrap();
    let len_before = endpoints.len();
    endpoints.retain(|(_, ep)| ep.id != api_id);

    if endpoints.len() == len_before {
        return Err("未找到该接口".into());
    }
    drop(endpoints);

    // 检查当前分类是否还有接口，没有则回退到随机
    let current = state.current_category.lock().unwrap().clone();
    if current != RANDOM_CATEGORY {
        let categories = get_all_categories(&state);
        let has_endpoints = categories
            .iter()
            .find(|c| c.id == current)
            .map(|c| !c.endpoints.is_empty())
            .unwrap_or(false);

        if !has_endpoints {
            *state.current_category.lock().unwrap() = RANDOM_CATEGORY.into();
        }
    }

    Ok(())
}

#[tauri::command]
fn delete_custom_category(state: State<'_, AppState>, category_id: String) -> Result<(), String> {
    // 不能删除内置分类
    if get_builtin_categories().iter().any(|c| c.id == category_id) {
        return Err("无法删除内置分类".into());
    }

    let mut categories = state.custom_categories.lock().unwrap();
    let len_before = categories.len();
    categories.retain(|c| c.id != category_id);

    if categories.len() == len_before {
        return Err("未找到该分类".into());
    }

    // 删除该分类下的所有接口
    state
        .custom_endpoints
        .lock()
        .unwrap()
        .retain(|(cat_id, _)| cat_id != &category_id);

    // 如果当前选中的是被删除的分类，切换到随机
    let mut current = state.current_category.lock().unwrap();
    if *current == category_id {
        *current = RANDOM_CATEGORY.into();
    }

    Ok(())
}

#[tauri::command]
fn get_image_categories(state: State<'_, AppState>) -> Vec<ApiCategory> {
    get_all_image_categories(&state)
}

#[tauri::command]
fn get_current_image_category(state: State<'_, AppState>) -> String {
    state.current_image_category.lock().unwrap().clone()
}

#[tauri::command]
fn set_current_image_category(state: State<'_, AppState>, category_id: String) -> Result<(), String> {
    if !image_category_exists(&state, &category_id) {
        return Err("分类不存在".into());
    }
    *state.current_image_category.lock().unwrap() = category_id;
    Ok(())
}

#[tauri::command]
fn add_custom_image_category(state: State<'_, AppState>, name: String) -> Result<ApiCategory, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".into());
    }

    let category = ApiCategory {
        id: format!("custom_img_cat_{}", now_millis()),
        name: name.into(),
        builtin: false,
        endpoints: vec![],
    };

    state
        .custom_image_categories
        .lock()
        .unwrap()
        .push(category.clone());
    Ok(category)
}

#[tauri::command]
fn add_custom_image_api(
    state: State<'_, AppState>,
    category_id: String,
    name: String,
    url: String,
) -> Result<ApiEndpoint, String> {
    let name = name.trim();
    let url = url.trim();

    if name.is_empty() || url.is_empty() {
        return Err("名称和URL不能为空".into());
    }

    if category_id == RANDOM_CATEGORY || !image_category_exists(&state, &category_id) {
        return Err("分类不存在".into());
    }

    let endpoint = ApiEndpoint {
        id: format!("custom_img_ep_{}", now_millis()),
        name: name.into(),
        url: url.into(),
        builtin: false,
    };

    state
        .custom_image_endpoints
        .lock()
        .unwrap()
        .push((category_id, endpoint.clone()));

    Ok(endpoint)
}

#[tauri::command]
fn delete_custom_image_api(state: State<'_, AppState>, api_id: String) -> Result<(), String> {
    let mut endpoints = state.custom_image_endpoints.lock().unwrap();
    let len_before = endpoints.len();
    endpoints.retain(|(_, ep)| ep.id != api_id);

    if endpoints.len() == len_before {
        return Err("未找到该接口".into());
    }
    drop(endpoints);

    let current = state.current_image_category.lock().unwrap().clone();
    if current != RANDOM_CATEGORY {
        let categories = get_all_image_categories(&state);
        let has_endpoints = categories
            .iter()
            .find(|c| c.id == current)
            .map(|c| !c.endpoints.is_empty())
            .unwrap_or(false);

        if !has_endpoints {
            *state.current_image_category.lock().unwrap() = RANDOM_CATEGORY.into();
        }
    }

    Ok(())
}

#[tauri::command]
fn delete_custom_image_category(
    state: State<'_, AppState>,
    category_id: String,
) -> Result<(), String> {
    if get_builtin_image_categories()
        .iter()
        .any(|c| c.id == category_id)
    {
        return Err("无法删除内置分类".into());
    }

    let mut categories = state.custom_image_categories.lock().unwrap();
    let len_before = categories.len();
    categories.retain(|c| c.id != category_id);

    if categories.len() == len_before {
        return Err("未找到该分类".into());
    }

    state
        .custom_image_endpoints
        .lock()
        .unwrap()
        .retain(|(cat_id, _)| cat_id != &category_id);

    let mut current = state.current_image_category.lock().unwrap();
    if *current == category_id {
        *current = RANDOM_CATEGORY.into();
    }

    Ok(())
}

// ============================================================
// Main
// ============================================================

fn parse_range(header: &str, total_len: usize) -> Option<(usize, usize)> {
    let header = header.strip_prefix("bytes=")?;
    let mut parts = header.split('-');
    let start = parts.next()?.parse::<usize>().ok()?;
    let end = parts
        .next()
        .and_then(|s| if s.is_empty() { None } else { s.parse::<usize>().ok() })
        .unwrap_or(total_len.saturating_sub(1));
    if start <= end && end < total_len {
        Some((start, end))
    } else {
        None
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            current_video_url: Mutex::new(None),
            current_category: Mutex::new(RANDOM_CATEGORY.into()),
            custom_categories: Mutex::new(Vec::new()),
            custom_endpoints: Mutex::new(Vec::new()),
            current_image_category: Mutex::new(RANDOM_CATEGORY.into()),
            custom_image_categories: Mutex::new(Vec::new()),
            custom_image_endpoints: Mutex::new(Vec::new()),
            preload_queue: Mutex::new(VecDeque::new()),
            playing_video: Mutex::new(None),
            preload_in_progress: AtomicBool::new(false),
        })
        .plugin(tauri_plugin_shell::init())
        .register_uri_scheme_protocol("stream", |ctx, request| {
            let state: State<AppState> = ctx.app_handle().state();
            let path = request.uri().path();
            let host = request.uri().host().unwrap_or_default();

            // stream:///video/{id} 或兼容 stream://video/{id}
            let video_id = path
                .strip_prefix("/video/")
                .or_else(|| if host == "video" { path.strip_prefix('/') } else { None });

            if let Some(video_id) = video_id {
                let playing = state.playing_video.lock().unwrap();
                if let Some(ref video) = *playing {
                    if video.id == video_id {
                        let range_header = request
                            .headers()
                            .get("range")
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_string());

                        let data = &video.data;
                        let total_len = data.len();

                        if let Some(range_str) = range_header {
                            if let Some((start, end)) = parse_range(&range_str, total_len) {
                                let slice = data.slice(start..=end);
                                return tauri::http::Response::builder()
                                    .status(206)
                                    .header("Content-Type", "video/mp4")
                                    .header("Accept-Ranges", "bytes")
                                    .header("Content-Length", slice.len().to_string())
                                    .header("Content-Range", format!("bytes {}-{}/{}", start, end, total_len))
                                    .body(slice.to_vec())
                                    .unwrap();
                            }
                        }

                        return tauri::http::Response::builder()
                            .status(200)
                            .header("Content-Type", "video/mp4")
                            .header("Accept-Ranges", "bytes")
                            .header("Content-Length", total_len.to_string())
                            .body(data.to_vec())
                            .unwrap();
                    }
                }
                drop(playing);
            }

            // Fallback: 原有的代理逻辑
            let url_lock = state.current_video_url.lock().unwrap();
            let incoming_range = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            println!("Stream request - path: {}, host: {}, range: {:?}, url: {:?}",
                path, host, incoming_range, url_lock.as_ref());

            if let Some(video_url) = url_lock.as_ref() {
                let video_url = video_url.clone();
                drop(url_lock);

                let range_header = request
                    .headers()
                    .get("range")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                let rt = tokio::runtime::Runtime::new().unwrap();
                let result = rt.block_on(async {
                    let client = build_client();
                    let mut req = client
                        .get(&video_url)
                        .header(REFERER, "https://api.tzjsy.cn/");

                    if let Some(range) = &range_header {
                        req = req.header(RANGE, range);
                    }

                    req.send().await
                });

                match result {
                    Ok(resp) => {
                        let status = resp.status();
                        let content_type = resp
                            .headers()
                            .get(CONTENT_TYPE)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("video/mp4")
                            .to_string();
                        let content_range = resp
                            .headers()
                            .get(CONTENT_RANGE)
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_string());

                        println!("Proxy: status={}, type={}, range={:?}", status, content_type, content_range);

                        let body = rt.block_on(async { resp.bytes().await });

                        match body {
                            Ok(bytes) => {
                                println!("Proxy: body size = {} bytes", bytes.len());
                                let mut builder = tauri::http::Response::builder()
                                    .status(status.as_u16())
                                    .header("Content-Type", content_type)
                                    .header("Accept-Ranges", "bytes")
                                    .header("Content-Length", bytes.len().to_string());

                                if let Some(range) = content_range {
                                    builder = builder.header("Content-Range", range);
                                }

                                builder.body(bytes.to_vec()).unwrap()
                            }
                            Err(e) => {
                                println!("Proxy: body read error: {}", e);
                                tauri::http::Response::builder()
                                    .status(500)
                                    .body(Vec::new())
                                    .unwrap()
                            }
                        }
                    }
                    Err(e) => {
                        println!("Proxy: request error: {}", e);
                        tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .unwrap()
                    }
                }
            } else {
                tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            }
        })
        .invoke_handler(tauri::generate_handler![
            fetch_video,
            fetch_image,
            download_video,
            download_image,
            preload_next,
            get_preload_count,
            pop_next_video,
            clear_preload_queue,
            get_categories,
            get_current_category,
            set_current_category,
            add_custom_category,
            add_custom_api,
            delete_custom_api,
            delete_custom_category,
            get_image_categories,
            get_current_image_category,
            set_current_image_category,
            add_custom_image_category,
            add_custom_image_api,
            delete_custom_image_api,
            delete_custom_image_category
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

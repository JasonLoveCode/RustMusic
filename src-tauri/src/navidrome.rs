//! Navidrome（Subsonic 兼容 API）客户端
//!
//! 连接用户自建的 Navidrome / Subsonic 服务器：搜索、专辑浏览、播放流。
//! 认证采用 Subsonic 标准的 salt+token 方案（token = md5(密码 + salt)）；
//! **密码保存在 Windows 凭据管理器**（keyring），不落数据库、不进前端。

use md5::{Digest as Md5Digest, Md5};
use rand::Rng;
use serde::Serialize;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(15);
const CLIENT: &str = "RustMusic";
const API_VER: &str = "1.16.1";

// ---------- 凭据管理器 ----------

fn keyring_entry(server: &str, username: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("RustMusic Navidrome", &format!("{server}|{username}"))
        .map_err(|e| format!("凭据管理器不可用: {e}"))
}

/// 密码存入 Windows 凭据管理器
pub fn save_password(server: &str, username: &str, password: &str) -> Result<(), String> {
    keyring_entry(server, username)?
        .set_password(password)
        .map_err(|e| format!("凭据保存失败: {e}"))
}

/// 从凭据管理器删除密码
pub fn delete_password(server: &str, username: &str) -> Result<(), String> {
    match keyring_entry(server, username)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("凭据删除失败: {e}")),
    }
}

fn get_password(server: &str, username: &str) -> Result<String, String> {
    keyring_entry(server, username)?
        .get_password()
        .map_err(|_| "未找到保存的密码，请重新保存连接".to_string())
}

// ---------- 基础 ----------

/// 归一化服务器地址：补 scheme、去尾部斜杠
pub fn norm_base(server: &str) -> String {
    let s = server.trim();
    let s = if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("http://{s}")
    };
    s.trim_end_matches('/').to_string()
}

fn md5_hex(s: &str) -> String {
    let mut h = Md5::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

const SALT_ALPHABET: &str = "0123456789abcdefghijklmnopqrstuvwxyz";

fn rand_salt() -> String {
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| SALT_ALPHABET.as_bytes()[rng.gen_range(0..SALT_ALPHABET.len())] as char)
        .collect()
}

fn enc(s: &str) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

/// Subsonic 鉴权查询串（token = md5(密码 + salt)，密码来自凭据管理器）
fn auth_query(server: &str, username: &str) -> Result<String, String> {
    let password = get_password(server, username)?;
    let salt = rand_salt();
    let token = md5_hex(&format!("{password}{salt}"));
    Ok(format!(
        "u={}&t={}&s={}&v={API_VER}&c={CLIENT}&f=json",
        enc(username),
        token,
        salt
    ))
}

fn get_json(server: &str, username: &str, endpoint: &str, extra: &str) -> Result<serde_json::Value, String> {
    let base = norm_base(server);
    let url = format!("{base}/rest/{endpoint}?{}&{extra}", auth_query(server, username)?);
    let resp = ureq::get(&url)
        .timeout(TIMEOUT)
        .call()
        .map_err(|e| format!("连接 Navidrome 服务器失败: {e}"))?;
    let text = resp
        .into_string()
        .map_err(|e| format!("Navidrome 响应读取失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Navidrome 响应解析失败: {e}"))?;
    let status = v.pointer("/subsonic-response/status").and_then(|s| s.as_str());
    if status != Some("ok") {
        let msg = v
            .pointer("/subsonic-response/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("Navidrome 错误: {msg}"));
    }
    Ok(v)
}

// ---------- 数据模型 ----------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NdSong {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// 秒
    pub duration: u64,
    pub cover_url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NdAlbum {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub cover_url: String,
    pub song_count: u64,
    pub duration: u64,
}

fn jstr(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| {
            x.as_str()
                .map(|s| s.to_string())
                .or_else(|| x.as_i64().map(|n| n.to_string()))
        })
        .unwrap_or_default()
}

fn jnum(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0)
}

fn song_from(v: &serde_json::Value, server: &str, username: &str, password: &str) -> NdSong {
    let cover_art = jstr(v, "coverArt");
    NdSong {
        id: jstr(v, "id"),
        title: jstr(v, "title"),
        artist: jstr(v, "artist"),
        album: jstr(v, "album"),
        duration: jnum(v, "duration"),
        cover_url: cover_art_url(server, username, password, &cover_art),
    }
}

fn album_from(v: &serde_json::Value, server: &str, username: &str, password: &str) -> NdAlbum {
    let cover_art = jstr(v, "coverArt");
    NdAlbum {
        id: jstr(v, "id"),
        name: jstr(v, "name").is_empty().then_some(()).map_or_else(
            || jstr(v, "name"),
            |_| jstr(v, "album"),
        ),
        artist: jstr(v, "artist"),
        cover_url: cover_art_url(server, username, password, &cover_art),
        song_count: jnum(v, "songCount"),
        duration: jnum(v, "duration"),
    }
}

// ---------- API ----------

/// 连接测试 + 取用户信息
pub fn ping(server: &str, username: &str, password: &str) -> Result<(), String> {
    let base = norm_base(server);
    let salt = rand_salt();
    let token = md5_hex(&format!("{password}{salt}"));
    let url = format!(
        "{base}/rest/ping?u={}&t={token}&s={salt}&v={API_VER}&c={CLIENT}&f=json",
        enc(username)
    );
    let resp = ureq::get(&url).timeout(TIMEOUT).call().map_err(|e| format!("无法连接服务器: {e}"))?;
    let text = resp.into_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("响应解析失败: {e}"))?;
    if v.pointer("/subsonic-response/status").and_then(|s| s.as_str()) != Some("ok") {
        let msg = v
            .pointer("/subsonic-response/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("认证失败或服务器错误");
        return Err(msg.to_string());
    }
    Ok(())
}

/// 搜索歌曲（search3）
pub fn search_songs(server: &str, username: &str, query: &str) -> Result<Vec<NdSong>, String> {
    let password = get_password(server, username)?;
    let extra = format!("query={}&songCount=50&artistCount=0&albumCount=0", enc(query));
    let v = get_json(server, username, "search3", &extra)?;
    let empty = Vec::new();
    let songs = v
        .pointer("/subsonic-response/searchResult3/song")
        .and_then(|x| x.as_array())
        .unwrap_or(&empty);
    Ok(songs
        .iter()
        .map(|s| song_from(s, server, username, &password))
        .collect())
}

/// 专辑列表（字母序，最多 300 张）
pub fn album_list(server: &str, username: &str) -> Result<Vec<NdAlbum>, String> {
    let password = get_password(server, username)?;
    let extra = "type=alphabeticalByName&size=300&offset=0".to_string();
    let v = get_json(server, username, "getAlbumList2", &extra)?;
    let empty = Vec::new();
    let albums = v
        .pointer("/subsonic-response/albumList2/album")
        .and_then(|x| x.as_array())
        .unwrap_or(&empty);
    Ok(albums
        .iter()
        .map(|a| album_from(a, server, username, &password))
        .collect())
}

/// 专辑详情 + 曲目
pub fn album_songs(
    server: &str,
    username: &str,
    id: &str,
) -> Result<(String, String, Vec<NdSong>), String> {
    let password = get_password(server, username)?;
    let extra = format!("id={}", enc(id));
    let v = get_json(server, username, "getAlbum", &extra)?;
    let album = v
        .pointer("/subsonic-response/album")
        .ok_or_else(|| "专辑不存在".to_string())?;
    let empty = Vec::new();
    let songs = album
        .get("song")
        .and_then(|x| x.as_array())
        .unwrap_or(&empty);
    Ok((
        jstr(album, "name"),
        jstr(album, "artist"),
        songs
            .iter()
            .map(|s| song_from(s, server, username, &password))
            .collect(),
    ))
}

/// 播放流地址（带鉴权，直接喂给播放引擎）
pub fn stream_url(server: &str, username: &str, id: &str) -> Result<String, String> {
    let base = norm_base(server);
    let password = get_password(server, username)?;
    let salt = rand_salt();
    let token = md5_hex(&format!("{password}{salt}"));
    Ok(format!(
        "{base}/rest/stream?u={}&t={token}&s={salt}&v={API_VER}&c={CLIENT}&f=json&id={}",
        enc(username),
        enc(id)
    ))
}

/// 封面图地址（带鉴权，<img> 直接可用）
pub fn cover_art_url(server: &str, username: &str, password: &str, cover_art: &str) -> String {
    if cover_art.is_empty() {
        return String::new();
    }
    let base = norm_base(server);
    let salt = rand_salt();
    let token = md5_hex(&format!("{password}{salt}"));
    format!(
        "{base}/rest/getCoverArt?u={}&t={token}&s={salt}&v={API_VER}&c={CLIENT}&id={}",
        enc(username),
        enc(cover_art)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_base_cases() {
        assert_eq!(norm_base("192.168.1.10:4533"), "http://192.168.1.10:4533");
        assert_eq!(norm_base("http://srv:4533/"), "http://srv:4533");
        assert_eq!(norm_base("https://music.example.com"), "https://music.example.com");
    }

    #[test]
    #[ignore] // 需要网络：Navidrome 官方演示服务器
    fn test_demo_server() {
        let server = "https://demo.navidrome.org";
        let (u, p) = ("demo", "demo");
        save_password(server, u, p).expect("存凭据失败");
        ping(server, u, p).expect("ping 失败");
        let songs = search_songs(server, "demo", "love").expect("search 失败");
        assert!(!songs.is_empty(), "搜索应命中歌曲");
        let albums = album_list(server, "demo").expect("album list 失败");
        assert!(!albums.is_empty(), "专辑列表不应为空");
        let (name, _artist, songs) = album_songs(server, "demo", &albums[0].id).expect("album 失败");
        assert!(!songs.is_empty(), "专辑应有曲目");
        let url = stream_url(server, u, &songs[0].id).expect("stream_url 失败");
        let _ = delete_password(server, u);
        let resp = ureq::head(&url).call().expect("流地址请求失败");
        assert!(resp.status() < 400, "流应可访问");
        let _ = name;
    }
}

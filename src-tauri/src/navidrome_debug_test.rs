// 临时诊断：用应用数据库里的真实连接调歌词
#[test]
#[ignore]
fn debug_real_lyrics() {
    let db = std::path::PathBuf::from(std::env::var("APPDATA").unwrap())
        .join("com.rustmusic.app")
        .join("library.db");
    let conn = rusqlite::Connection::open_with_flags(
        &db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let get = |k: &str| -> String {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [k], |r| {
            r.get::<_, String>(0)
        })
        .unwrap_or_default()
    };
    let server = get("navidrome_server");
    let username = get("navidrome_username");
    println!("server={server} username={username}");
    let payload =
        crate::navidrome::lyrics(&server, &username, "434ekWZclWOsrUJsxB2PSd").unwrap();
    println!(
        "payload: synced={} lines={}",
        payload.synced,
        payload.lines.len()
    );
    for l in payload.lines.iter().take(5) {
        println!("  {:?}", l.text);
    }
}

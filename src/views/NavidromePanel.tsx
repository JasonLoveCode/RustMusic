import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  Download,
  ListPlus,
  Loader2,
  LogIn,
  MoreHorizontal,
  Play,
  Search,
  Server,
} from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import type { NdAlbum, NdSong } from "../types";
import { clampMenuPos, fmtTime } from "../utils";
import Modal from "../components/Modal";

const LS_SERVER = "navidrome.ui.server";
const LS_USER = "navidrome.ui.username";

type View =
  | { page: "albums" }
  | { page: "songs" }
  | { page: "album"; id: string; name: string; artist: string }
  | { page: "search"; query: string };

export default function NavidromePanel() {
  const toast = useStore((s) => s.toast);
  const playNext = useStore((s) => s.playNext);
  const addToQueue = useStore((s) => s.addToQueue);
  const toggleLikeOnline = useStore((s) => s.toggleLikeOnline);
  const addOnlineToPlaylist = useStore((s) => s.addOnlineToPlaylist);
  const playlists = useStore((s) => s.playlists);

  const [server, setServer] = useState(localStorage.getItem(LS_SERVER) ?? "");
  const [username, setUsername] = useState(localStorage.getItem(LS_USER) ?? "");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const [view, setView] = useState<View>({ page: "albums" });
  const [albums, setAlbums] = useState<NdAlbum[]>([]);
  const [albumSongs, setAlbumSongs] = useState<NdSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [seg, setSeg] = useState<"albums" | "songs">("albums");
  const [allSongs, setAllSongs] = useState<NdSong[]>([]);
  const [total, setTotal] = useState(0);

  const [kw, setKw] = useState("");
  const [searched, setSearched] = useState(false);

  const [menu, setMenu] = useState<{ x: number; y: number; song: NdSong } | null>(null);
  const [pickerSong, setPickerSong] = useState<NdSong | null>(null);
  const [downloading, setDownloading] = useState(false);

  const navStack = useRef<View[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 打开页签即尝试用已保存的连接信息恢复专辑列表
    if (!server || !username) return;
    let dead = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.navidromeAlbums(server, username);
        if (!dead) {
          setAlbums(list);
          setConnected(true);
          const r = await api.navidromeAllSongs(server, username, 0);
          if (!dead) {
            setAllSongs(r.songs);
            setTotal(r.total);
          }
        }
      } catch {
        /* 未连接或失效：保持连接表单 */
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    if (!server.trim() || !username.trim() || !password) {
      toast("服务器地址、用户名、密码均不能为空", "error");
      return;
    }
    setConnecting(true);
    try {
      await api.navidromeSave(server.trim(), username.trim(), password);
      const list = await api.navidromeAlbums(server.trim(), username.trim());
      localStorage.setItem(LS_SERVER, server.trim());
      localStorage.setItem(LS_USER, username.trim());
      setServer(server.trim());
      setAlbums(list);
      setConnected(true);
      try {
        const r = await api.navidromeAllSongs(server.trim(), username.trim(), 0);
        setAllSongs(r.songs);
        setTotal(r.total);
      } catch {
        /* 全曲库拉取失败不阻塞连接 */
      }
      setPassword("");
      setView({ page: "albums" });
      toast("Navidrome 已连接", "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setConnecting(false);
    }
  };

  const forget = async () => {
    try {
      await api.navidromeForget(server, username);
    } catch {
      /* 凭据可能已不存在 */
    }
    localStorage.removeItem(LS_SERVER);
    localStorage.removeItem(LS_USER);
    setServer("");
    setUsername("");
    setConnected(false);
    setAlbums([]);
    setView({ page: "albums" });
    toast("已断开并清除保存的密码", "success");
  };

  const playSong = (s: NdSong) => {
    if (!server || !username) return;
    // 队列/收藏/播放列表都需要元数据缓存
    useStore.setState((st) => ({
      ndCache: {
        ...st.ndCache,
        [s.id]: {
          title: s.title,
          artist: s.artist,
          album: s.album,
          cover: s.coverUrl,
          durationMs: s.duration * 1000,
        },
      },
    }));
    api
      .navidromePlay(server, username, {
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        cover: s.coverUrl,
        durationMs: s.duration * 1000,
      })
      .catch((e) => toast(String(e), "error"));
  };

  const queueItemOf = (s: NdSong) => {
    useStore.setState((st) => ({
      ndCache: {
        ...st.ndCache,
        [s.id]: {
          title: s.title,
          artist: s.artist,
          album: s.album,
          cover: s.coverUrl,
          durationMs: s.duration * 1000,
        },
      },
    }));
    return { kind: "navidrome" as const, id: s.id };
  };

  const likeRowOf = (s: NdSong) => ({
    kind: "navidrome",
    id: s.id,
    name: s.title,
    artist: s.artist,
    album: s.album,
    cover: s.coverUrl,
    durationMs: s.duration * 1000,
    mediaMid: "",
    vip: false,
  });

  const openAlbum = async (a: NdAlbum) => {
    navStack.current.push(view);
    setLoading(true);
    try {
      const r = await api.navidromeAlbumSongs(server, username, a.id);
      setAlbumSongs(r.songs);
      setView({ page: "album", id: a.id, name: r.name, artist: r.artist });
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const submitSearch = async () => {
    const q = kw.trim();
    if (!q) return;
    navStack.current.push(view);
    setLoading(true);
    try {
      const r = await api.navidromeSearch(server, username, q);
      setAlbumSongs(r);
      setView({ page: "search", query: q });
      setSearched(true);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const loadMoreSongs = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await api.navidromeAllSongs(server, username, allSongs.length);
      setAllSongs((prev) => [...prev, ...r.songs]);
      setTotal(r.total);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    const prev = navStack.current.pop();
    if (prev) setView(prev);
  };

  const downloadSong = async (s: NdSong) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const name = await api.downloadOnline({
        kind: "navidrome",
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        durationMs: s.duration * 1000,
        mediaMid: "",
      });
      await useStore.getState().refreshTracks();
      useStore.getState().toast(`已下载到资料库：${name}`, "success");
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    } finally {
      setDownloading(false);
    }
  };

  const rows: { s: NdSong; i: number }[] = albumSongs.map((s, i) => ({ s, i }));

  return (
    <div className="h-full flex flex-col min-h-0" ref={listRef}>
      {!connected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <Server size={26} className="text-[var(--ink-3)]" />
          </div>
          <div className="text-[13.5px] text-[var(--ink-2)]">连接你的 Navidrome 服务器</div>
          <div className="flex flex-col gap-2.5 w-[360px]">
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="服务器地址（如 music.example.com 或 192.168.1.10:4533）"
              className="w-full h-10 rounded-xl bg-[var(--shade)] border border-[var(--line)] px-3.5 text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)]"
            />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className="w-full h-10 rounded-xl bg-[var(--shade)] border border-[var(--line)] px-3.5 text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder="密码（保存在 Windows 凭据管理器）"
              className="w-full h-10 rounded-xl bg-[var(--shade)] border border-[var(--line)] px-3.5 text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)]"
            />
            <button className="btn-primary h-10" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
              连接
            </button>
          </div>
          <div className="text-[11px] text-[var(--ink-3)] max-w-[360px] text-center leading-relaxed">
            兼容 Navidrome 及所有 Subsonic API 服务器。密码仅保存在本机 Windows
            凭据管理器中，不上传、不落明文。
          </div>
        </div>
      ) : (
        <>
          {/* 头部：标题 + 搜索 + 断开 */}
          <div className="flex items-center gap-2.5 mb-3 shrink-0">
            {navStack.current.length > 0 && (
              <button
                className="btn-ghost w-10 h-10 shrink-0"
                onClick={goBack}
                title="返回上一页"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span className="text-[12.5px] text-[var(--ink-2)] truncate max-w-[220px]" title={`${server} · ${username}`}>
              <Server size={13} className="inline mr-1.5 -mt-0.5" />
              {view.page === "album"
                ? view.name
                : view.page === "search"
                  ? `搜索：${view.query}`
                  : `专辑库 · ${username}`}
            </span>
            <div className="relative flex-1 max-w-[380px] ml-auto">
              <Search
                size={14}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]"
              />
              <input
                type="text"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                placeholder="搜索服务器曲库…"
                className="w-full h-10 rounded-xl bg-[var(--shade)] border border-[var(--line)] pl-9 pr-3 text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)]"
              />
            </div>
            <button className="btn-primary h-10" onClick={submitSearch} disabled={loading}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              搜索
            </button>
            <button className="btn-secondary h-9 !px-3 text-[12px]" onClick={forget} title="断开并清除保存的密码">
              断开
            </button>
          </div>

          {/* 分段：专辑 / 歌曲 */}
          <div className="flex items-center gap-1.5 mb-3 shrink-0">
            {(
              [
                ["albums", `专辑 (${albums.length})`],
                ["songs", `歌曲 (${total || allSongs.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setSeg(k);
                  setView({ page: k });
                  navStack.current = [];
                }}
                className={`px-3.5 py-1.5 rounded-full text-[12px] transition-colors ${
                  seg === k
                    ? "bg-[var(--accent-weak)] text-[var(--accent-strong)] font-medium"
                    : "text-[var(--ink-2)] hover:bg-[var(--shade-hover)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {loading && (
              <div className="flex items-center justify-center gap-2.5 text-[var(--ink-3)] text-[13px] pt-16">
                <Loader2 size={15} className="animate-spin" />
                加载中…
              </div>
            )}
            {!loading && view.page === "songs" && (
              <>
                <div className="pb-4">
                  {allSongs.map((s) => (
                    <div
                      key={s.id}
                      className="group grid grid-cols-[36px_minmax(0,1fr)_160px_70px_120px] items-center gap-4 h-[56px] px-3 rounded-[13px] hover:bg-[var(--shade-hover)] transition-colors"
                      onDoubleClick={() => playSong(s)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, song: s });
                      }}
                    >
                      <button
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--ink-3)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-on)] transition-colors"
                        onClick={() => playSong(s)}
                        title="播放"
                      >
                        <Play size={14} className="fill-current ml-px" />
                      </button>
                      <div className="min-w-0">
                        <div className="text-[13.5px] text-[var(--ink)] truncate">{s.title}</div>
                        <div className="text-[11.5px] text-[var(--ink-3)] truncate">{s.artist}</div>
                      </div>
                      <div className="text-[12.5px] text-[var(--ink-3)] truncate">{s.album}</div>
                      <div className="text-[12.5px] text-[var(--ink-2)] tabular-nums text-right">
                        {fmtTime(s.duration * 1000)}
                      </div>
                      <div className="flex items-center justify-end gap-1 pr-1">
                        <button
                          className="btn-ghost w-8 h-8"
                          onClick={() => downloadSong(s)}
                          title="下载到资料库"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          className="btn-ghost w-8 h-8"
                          onClick={(ev) => {
                            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenu({ x: r.right - 200, y: r.bottom + 4, song: s });
                          }}
                        >
                          <MoreHorizontal size={16} className="opacity-0 group-hover:opacity-100" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {allSongs.length < total && (
                    <div className="flex justify-center pt-2 pb-4">
                      <button className="btn-secondary !py-1.5 !px-4" onClick={loadMoreSongs}>
                        {loading ? <Loader2 size={13} className="animate-spin" /> : null}
                        加载更多（{allSongs.length}/{total}）
                      </button>
                    </div>
                  )}
                  {!allSongs.length && (
                    <div className="text-center text-[var(--ink-3)] text-[13px] pt-10">
                      服务器曲库为空
                    </div>
                  )}
                </div>
              </>
            )}
            {!loading && view.page === "albums" && (
              <div className="grid grid-cols-4 gap-3.5 pb-4">
                {albums.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => openAlbum(a)}
                    className="text-left group"
                    title={`${a.name} · ${a.artist}`}
                  >
                    <div className="aspect-square rounded-xl overflow-hidden mb-2 bg-[var(--shade)]">
                      {a.coverUrl ? (
                        <img
                          src={a.coverUrl}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Server size={22} className="text-[var(--ink-3)]" />
                        </div>
                      )}
                    </div>
                    <div className="text-[13px] text-[var(--ink)] truncate font-medium">{a.name}</div>
                    <div className="text-[11.5px] text-[var(--ink-3)] truncate">
                      {a.artist} · {a.songCount} 首
                    </div>
                  </button>
                ))}
                {!albums.length && (
                  <div className="col-span-4 text-center text-[var(--ink-3)] text-[13px] pt-10">
                    服务器曲库为空
                  </div>
                )}
              </div>
            )}
            {!loading && view.page !== "albums" && (
              <>
                {view.page === "album" && (
                  <div className="flex items-end gap-4 mb-4">
                    <div className="text-[22px] font-extrabold text-[var(--ink)]">{view.name}</div>
                    <div className="text-[12.5px] text-[var(--ink-3)] pb-1">
                      {view.artist} · {rows.length} 首
                    </div>
                  </div>
                )}
                <div className="pb-4">
                  {rows.map(({ s }) => (
                    <div
                      key={s.id}
                      className="group grid grid-cols-[36px_minmax(0,1fr)_160px_70px_120px] items-center gap-4 h-[56px] px-3 rounded-[13px] hover:bg-[var(--shade-hover)] transition-colors"
                      onDoubleClick={() => playSong(s)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, song: s });
                      }}
                    >
                      <button
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--ink-3)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-on)] transition-colors"
                        onClick={() => playSong(s)}
                        title="播放"
                      >
                        <Play size={14} className="fill-current ml-px" />
                      </button>
                      <div className="min-w-0">
                        <div className="text-[13.5px] text-[var(--ink)] truncate">{s.title}</div>
                        <div className="text-[11.5px] text-[var(--ink-3)] truncate">{s.artist}</div>
                      </div>
                      <div className="text-[12.5px] text-[var(--ink-3)] truncate">{s.album}</div>
                      <div className="text-[12.5px] text-[var(--ink-2)] tabular-nums text-right">
                        {fmtTime(s.duration * 1000)}
                      </div>
                      <div className="flex items-center justify-end gap-1 pr-1">
                        <button
                          className="btn-ghost w-8 h-8"
                          onClick={() => downloadSong(s)}
                          title="下载到资料库"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          className="btn-ghost w-8 h-8"
                          onClick={(ev) => {
                            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenu({ x: r.right - 200, y: r.bottom + 4, song: s });
                          }}
                        >
                          <MoreHorizontal size={16} className="opacity-0 group-hover:opacity-100" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!rows.length && (
                    <div className="text-center text-[var(--ink-3)] text-[13px] pt-10">
                      {view.page === "search" && searched ? "没有找到相关歌曲" : "专辑暂无曲目"}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 右键菜单 */}
      {menu &&
        createPortal(
          <div
            className="fixed z-[75] w-[190px] glass-strong rounded-xl p-1.5 shadow-2xl anim-menu"
            style={(() => {
              const p = clampMenuPos(menu.x, menu.y, 190, 220);
              return { left: p.x, top: p.y };
            })()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseLeave={() => setMenu(null)}
          >
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                playSong(menu.song);
                setMenu(null);
              }}
            >
              <Play size={13} /> 播放
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                playNext(queueItemOf(menu.song));
                setMenu(null);
              }}
            >
              <ListPlus size={13} /> 下一首播放
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                addToQueue(queueItemOf(menu.song));
                setMenu(null);
              }}
            >
              <ListPlus size={13} /> 加入队列
            </button>
            <div className="my-1 mx-2 border-t border-[var(--line)]" />
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                toggleLikeOnline(likeRowOf(menu.song));
                setMenu(null);
              }}
            >
              <Check size={13} /> 收藏到“我喜欢”
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                setPickerSong(menu.song);
                setMenu(null);
              }}
            >
              <ListPlus size={13} /> 添加到播放列表…
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                downloadSong(menu.song);
                setMenu(null);
              }}
            >
              <Download size={13} /> 下载到资料库
            </button>
          </div>,
          document.body
        )}

      {/* 添加到播放列表 */}
      {pickerSong && (
        <Modal open onClose={() => setPickerSong(null)} title="添加到播放列表" width={380}>
          <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
            {playlists.map((p) => (
              <button
                key={p.id}
                className="h-10 px-3 rounded-lg text-left text-[13px] text-[var(--ink)] hover:bg-[var(--shade)] flex items-center justify-between transition-colors"
                onClick={async () => {
                  await addOnlineToPlaylist(p.id, likeRowOf(pickerSong));
                  toast(`已添加到「${p.name}」`, "success");
                  setPickerSong(null);
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className="text-[11px] text-[var(--ink-2)]">
                  {p.entries.length} 首
                </span>
              </button>
            ))}
            {!playlists.length && (
              <div className="text-[12.5px] text-[var(--ink-2)] py-2">
                还没有播放列表，请先在侧边栏创建
              </div>
            )}
          </div>
          <div className="flex justify-end mt-2">
            <button className="btn-secondary" onClick={() => setPickerSong(null)}>
              关闭
            </button>
          </div>
        </Modal>
      )}

      {/* 下载中提示 */}
      {downloading && (
        <div className="fixed bottom-24 right-8 z-[70]">
          <span className="chip text-[var(--ink-2)]" style={{ background: "var(--shade-strong)" }}>
            <Loader2 size={12} className="animate-spin" />
            正在下载…
          </span>
        </div>
      )}
    </div>
  );
}

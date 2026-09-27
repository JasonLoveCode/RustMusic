import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Check,
  Download,
  Heart,
  Link2,
  ListMusic,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
  Tv,
  Users,
  X,
} from "lucide-react";
import { useStore } from "../store";
import Modal from "../components/Modal";
import CoverImg from "../components/CoverImg";
import { fmtDate, fmtTime } from "../utils";
import type { BiliCollection, BiliSpaceItem, SourcesResult } from "../types";

const ORDERS: { key: "pubdate" | "click" | "stow"; label: string }[] = [
  { key: "pubdate", label: "最新发布" },
  { key: "click", label: "最多播放" },
  { key: "stow", label: "最多收藏" },
];

function fmtPlay(n: number): string {
  if (n >= 10000_0000) return `${(n / 10000_0000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export default function SourcesView() {
  const playSourceId = useStore((s) => s.playSourceId);
  const playBilibiliList = useStore((s) => s.playBilibiliList);
  const playNext = useStore((s) => s.playNext);
  const addToQueue = useStore((s) => s.addToQueue);
  const entryToQueueItem = useStore((s) => s.entryToQueueItem);
  const toggleLikeOnline = useStore((s) => s.toggleLikeOnline);
  const downloadOnline = useStore((s) => s.downloadOnline);
  const addOnlineToPlaylist = useStore((s) => s.addOnlineToPlaylist);
  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const savedOnline = useStore((s) => s.savedOnline);
  const current = useStore((s) => s.current);
  const biliLoggedIn = useStore((s) => s.biliLoggedIn);
  const biliNickname = useStore((s) => s.biliNickname);
  const biliSetLogin = useStore((s) => s.biliSetLogin);
  const biliLogout = useStore((s) => s.biliLogout);
  const result = useStore((s) => s.sourcesResult);
  const setResult = useStore((s) => s.setSourcesResult);

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [bili, setBili] = useState("");
  const [biliBusy, setBiliBusy] = useState(false);
  /** 多选模式与选中行（key = rid） */
  const [selMode, setSelMode] = useState(false);
  const [selKeys, setSelKeys] = useState<Set<string>>(new Set());
  /** 右键菜单 */
  const [menu, setMenu] = useState<{ x: number; y: number; row: BiliSpaceItem } | null>(null);
  /** “添加到播放列表”弹窗（支持批量） */
  const [pickerRows, setPickerRows] = useState<BiliSpaceItem[] | null>(null);
  const [newPlName, setNewPlName] = useState("");
  /** B 站扫码登录弹窗 */
  const [qr, setQr] = useState<{ qr: string } | null>(null);
  const qrRunRef = useRef(0);

  const canAdd = useMemo(() => /^https?:\/\//.test(url.trim()), [url]);

  const rowKey = (r: BiliSpaceItem) => `bilibili-${r.rid}`;
  const rowActive = (r: BiliSpaceItem) =>
    current?.kind === "bilibili" && current.qid != null && current.qid === r.rid;
  const rowLiked = (r: BiliSpaceItem) => !!savedOnline[rowKey(r)];

  const toOnlineRow = (r: BiliSpaceItem) => ({
    kind: "bilibili" as const,
    id: r.rid,
    name: r.title,
    artist: r.artist,
    album: "哔哩哔哩",
    cover: r.cover,
    durationMs: r.durationMs,
    mediaMid: "",
    vip: false,
  });

  const menuEntryToQueueItem = (r: BiliSpaceItem) =>
    entryToQueueItem({
      rowid: 0,
      kind: "bilibili",
      trackId: null,
      onlineId: r.rid,
      title: r.title,
      artist: r.artist,
      album: "哔哩哔哩",
      cover: r.cover,
      duration: r.durationMs / 1000,
      mediaMid: "",
      vip: false,
      lastPlayed: 0,
    });

  /** 当前结果区的行（多选/全选操作对象） */
  const visibleRows: BiliSpaceItem[] = !result
    ? []
    : result.type === "video"
      ? result.rows
      : result.type === "direct"
        ? result.rows
        : result.activeCollection
          ? result.activeCollection.rows
          : result.rows;

  const replaceResult = (r: SourcesResult | null) => {
    setResult(r);
    setSelKeys(new Set());
  };

  const submitBili = async () => {
    const input = bili.trim();
    if (!input || biliBusy) return;
    setBiliBusy(true);
    try {
      if (/space\.bilibili\.com\/\d+/.test(input) || /^\d+$/.test(input)) {
        const r = await useStore.getState().biliSpace(input, "pubdate");
        replaceResult({
          type: "space",
          mid: r.mid,
          name: r.name,
          face: r.face,
          fans: r.fans,
          total: r.total,
          order: "pubdate",
          rows: r.items,
          pn: 1,
          hasMore: r.hasMore,
          loadingMore: false,
          collections: r.collections,
          activeCollection: null,
        });
      } else {
        const rows = await useStore.getState().biliVideoInfo(input);
        if (!rows.length) throw new Error("未解析到视频");
        replaceResult({ type: "video", rows });
      }
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    } finally {
      setBiliBusy(false);
      setBili("");
    }
  };

  const changeOrder = async (order: "pubdate" | "click" | "stow") => {
    if (!result || result.type !== "space") return;
    const s = result;
    try {
      setResult({
        ...s,
        order,
        rows: [],
        pn: 0,
        hasMore: false,
        loadingMore: true,
        activeCollection: null,
      });
      setSelKeys(new Set());
      const r = await useStore.getState().biliSpaceMore(s.mid, order, 1);
      setResult((cur) =>
        cur && cur.type === "space" && cur.mid === s.mid
          ? { ...cur, order, rows: r.items, pn: 1, hasMore: r.hasMore, loadingMore: false }
          : cur
      );
    } catch (e) {
      setResult({ ...s, loadingMore: false });
      useStore.getState().toast(String(e), "error");
    }
  };

  const loadMore = async () => {
    if (!result || result.type !== "space") return;
    const s = result;
    if (s.activeCollection) {
      const c = s.activeCollection;
      if (c.loadingMore || !c.hasMore) return;
      setResult({ ...s, activeCollection: { ...c, loadingMore: true } });
      try {
        const r = await useStore
          .getState()
          .biliSpaceCollectionMore(s.mid, c.id, c.kind, c.pn + 1);
        setResult((cur) =>
          cur && cur.type === "space" && cur.activeCollection?.id === c.id
            ? {
                ...cur,
                activeCollection: {
                  ...c,
                  rows: [...c.rows, ...r.items],
                  pn: c.pn + 1,
                  hasMore: r.hasMore,
                  loadingMore: false,
                },
              }
            : cur
        );
      } catch (e) {
        setResult({ ...s, activeCollection: { ...c, loadingMore: false } });
        useStore.getState().toast(String(e), "error");
      }
    } else {
      if (s.loadingMore || !s.hasMore) return;
      setResult({ ...s, loadingMore: true });
      try {
        const r = await useStore.getState().biliSpaceMore(s.mid, s.order, s.pn + 1);
        setResult((cur) =>
          cur && cur.type === "space" && cur.mid === s.mid
            ? {
                ...cur,
                rows: [...cur.rows, ...r.items],
                pn: s.pn + 1,
                hasMore: r.hasMore,
                loadingMore: false,
              }
            : cur
        );
      } catch (e) {
        setResult({ ...s, loadingMore: false });
        useStore.getState().toast(String(e), "error");
      }
    }
  };

  const openCollection = async (c: BiliCollection) => {
    if (!result || result.type !== "space") return;
    const s = result;
    try {
      setResult({
        ...s,
        activeCollection: { ...c, rows: [], pn: 0, hasMore: false, loadingMore: true },
      });
      setSelKeys(new Set());
      const r = await useStore.getState().biliSpaceCollection(s.mid, c.id, c.kind);
      setResult((cur) =>
        cur && cur.type === "space" && cur.mid === s.mid
          ? {
              ...cur,
              activeCollection: {
                ...c,
                rows: r.items,
                pn: 1,
                hasMore: r.hasMore,
                loadingMore: false,
              },
            }
          : cur
      );
    } catch (e) {
      setResult({ ...s, activeCollection: null });
      useStore.getState().toast(String(e), "error");
    }
  };

  /** 打开扫码登录：过期自动换新码循环，直到成功或关闭弹窗 */
  const startBiliLogin = async () => {
    const runId = ++qrRunRef.current;
    const { api } = await import("../api");
    try {
      for (;;) {
        if (qrRunRef.current !== runId) return;
        const { key, qr } = await api.biliQrCreate();
        if (qrRunRef.current !== runId) return;
        setQr({ qr });
        let scanned = false;
        const t0 = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 1000));
          if (qrRunRef.current !== runId) return;
          if (Date.now() - t0 > 100_000 && !scanned) break;
          let status = "";
          let nickname: string | undefined;
          try {
            const r = await api.biliQrCheck(key);
            status = r.status;
            nickname = r.nickname;
          } catch {
            continue;
          }
          if (status === "success") {
            biliSetLogin(true, nickname ?? "");
            useStore
              .getState()
              .toast(`B 站登录成功${nickname ? `：${nickname}` : ""}`, "success");
            setQr(null);
            return;
          }
          if (status === "scanned") scanned = true;
          if (status === "expired") {
            if (scanned) {
              useStore.getState().toast("确认超时，已刷新二维码", "info");
            }
            break;
          }
        }
      }
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  };

  // ---------- 多选批量 ----------

  const selRows = visibleRows.filter((r) => selKeys.has(r.rid));

  const toggleSel = (rid: string) => {
    setSelKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

  const selectAll = () => {
    if (selRows.length === visibleRows.length) setSelKeys(new Set());
    else setSelKeys(new Set(visibleRows.map((r) => r.rid)));
  };

  const batchLike = () => {
    const targets = selRows.filter((r) => !rowLiked(r));
    if (!targets.length) {
      useStore.getState().toast("所选都已收藏过", "info");
      return;
    }
    for (const r of targets) toggleLikeOnline(toOnlineRow(r));
    useStore.getState().toast(`正在收藏 ${targets.length} 首…`, "success");
  };

  const batchDownload = () => {
    if (!selRows.length) return;
    for (const r of selRows) downloadOnline(toOnlineRow(r));
    useStore.getState().toast(`开始下载 ${selRows.length} 首…`, "info");
  };

  /** 渲染一行结果 */
  const renderRow = (r: BiliSpaceItem, extra?: { sourceId?: number }) => {
    const active = !selMode && rowActive(r);
    const checked = selMode && selKeys.has(r.rid);
    return (
      <div
        key={r.rid}
        className={`group flex items-center gap-3 h-[62px] px-3.5 rounded-xl border transition-colors ${
          checked
            ? "bg-[var(--accent-weak)] border-[var(--accent)]"
            : "bg-white/[0.03] border-white/[0.05] hover:bg-[var(--shade)]"
        }`}
        onContextMenu={(e) => {
          if (selMode) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, row: r });
        }}
        onClick={() => {
          if (selMode) toggleSel(r.rid);
        }}
      >
        {selMode ? (
          <span
            className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
              checked
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-on)]"
                : "border-[var(--line)]"
            }`}
          >
            {checked && <Check size={13} strokeWidth={3} />}
          </span>
        ) : (
          <button
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105"
            style={{ background: "linear-gradient(135deg, #fb7299, #d95d8a)" }}
            onClick={(e) => {
              e.stopPropagation();
              if (extra?.sourceId != null) playSourceId(extra.sourceId);
              else {
                const idx = visibleRows.findIndex((x) => x.rid === r.rid);
                playBilibiliList(visibleRows, idx >= 0 ? idx : 0);
              }
            }}
          >
            <Play size={14} className="fill-current text-[var(--ink)] ml-px" />
          </button>
        )}
        <CoverImg
          src={r.cover}
          seed={r.title}
          className="w-11 h-11 rounded-lg shrink-0"
          iconSize={14}
        />
        <div className="min-w-0 flex-1">
          <div
            className={`text-[13px] truncate ${
              active ? "text-[#fb7299] font-semibold" : "text-[var(--ink)]"
            }`}
          >
            {r.title || "B站视频"}
          </div>
          <div className="text-[11.5px] text-[var(--ink-2)] truncate flex items-center gap-2.5">
            <span>{r.artist || "哔哩哔哩"}</span>
            {r.durationMs > 0 && <span>{fmtTime(r.durationMs)}</span>}
            {r.play > 0 && <span>{fmtPlay(r.play)}次播放</span>}
            {r.created > 0 && (
              <span className="flex items-center gap-1">
                <Calendar size={10} />
                {fmtDate(r.created)}
              </span>
            )}
          </div>
        </div>
        {rowLiked(r) && (
          <Heart size={12} className="fill-[#e0533f] text-[#e0533f] shrink-0" />
        )}
        {!selMode && (
          <button
            className="btn-ghost w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 hover:!text-rose-400"
            title="从结果中移除"
            onClick={(e) => {
              e.stopPropagation();
              setResult((cur) => {
                if (!cur) return cur;
                if (cur.type === "video")
                  return { ...cur, rows: cur.rows.filter((x) => x.rid !== r.rid) };
                if (cur.type === "space") {
                  if (cur.activeCollection)
                    return {
                      ...cur,
                      activeCollection: {
                        ...cur.activeCollection,
                        rows: cur.activeCollection.rows.filter((x) => x.rid !== r.rid),
                      },
                    };
                  return { ...cur, rows: cur.rows.filter((x) => x.rid !== r.rid) };
                }
                return { ...cur, rows: cur.rows.filter((x) => x.rid !== r.rid) };
              });
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  };

  const space = result && result.type === "space" ? result : null;
  const listRows = selMode ? visibleRows : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col pb-[84px]">
      <header className="pt-5 pb-3 px-5">
        <h1 className="text-[22px] font-bold flex items-center gap-2.5">
          <Radio size={20} className="text-[var(--accent)]" />
          在线音源
        </h1>
        <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5 leading-relaxed">
          粘贴 B 站视频（链接 / BV / av / 短链）或 UP 主空间（space.bilibili.com/UID）解析音频，
          也可添加音频文件直链。仅显示当前结果。请仅添加你有权使用的音源。
        </p>

        <div className="flex gap-2 mt-3.5">
          <div className="relative flex-1 max-w-[480px]">
            <Tv
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#fb7299]"
            />
            <input
              type="text"
              value={bili}
              onChange={(e) => setBili(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && bili.trim() && !biliBusy) submitBili();
              }}
              placeholder="B站视频链接 / BV号，或 UP 主空间链接 / UID"
              className="w-full h-9 rounded-lg bg-[var(--shade)] border border-[var(--line)] pl-8 pr-3 text-[12.5px] focus:border-[var(--line)] transition-colors"
            />
          </div>
          <button
            className="btn-primary"
            disabled={!bili.trim() || biliBusy}
            style={{ opacity: bili.trim() && !biliBusy ? 1 : 0.45 }}
            onClick={submitBili}
          >
            <Tv size={14} />
            解析
          </button>
          <button
            className="btn-secondary h-9 px-3 text-[12px] shrink-0 flex items-center gap-1.5"
            onClick={() => (biliLoggedIn ? undefined : startBiliLogin())}
            title={biliLoggedIn ? "" : "登录 B 站后可显示视频字幕（作歌词）、按收藏排序"}
          >
            <Tv size={13} className={biliLoggedIn ? "text-[#fb7299]" : ""} />
            {biliLoggedIn ? biliNickname || "已登录" : "B站登录"}
          </button>
          {biliLoggedIn && (
            <button
              className="btn-ghost h-9 px-2 text-[12px] shrink-0 text-[var(--ink-2)]"
              onClick={() => biliLogout()}
              title="退出 B 站登录"
            >
              退出
            </button>
          )}
        </div>

        <div className="flex gap-2 mt-2">
          <div className="relative flex-1 max-w-[480px]">
            <Link2
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-2)]"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) submitDirect();
              }}
              placeholder="https://example.com/song.mp3（添加后立即播放）"
              className="w-full h-9 rounded-lg bg-[var(--shade)] border border-[var(--line)] pl-8 pr-3 text-[12.5px] focus:border-[var(--line)] transition-colors"
            />
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) submitDirect();
            }}
            placeholder="名称（可选）"
            className="w-[160px] h-9 rounded-lg bg-[var(--shade)] border border-[var(--line)] px-3 text-[12.5px] focus:border-[var(--line)] transition-colors"
          />
          <button
            className="btn-primary"
            disabled={!canAdd}
            style={{ opacity: canAdd ? 1 : 0.45 }}
            onClick={submitDirect}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
      </header>

      {/* 多选操作条 */}
      {selMode && (
        <div className="mx-5 mb-2 h-10 px-3 rounded-xl glass-strong flex items-center gap-1.5 shrink-0">
          <Square size={13} className="text-[var(--accent)] shrink-0" />
          <span className="text-[12px] text-[var(--ink)] mr-1 shrink-0">
            已选 {selRows.length}
          </span>
          <button className="btn-ghost h-7 px-2.5 text-[11.5px]" onClick={selectAll}>
            {selRows.length === visibleRows.length && visibleRows.length > 0
              ? "全不选"
              : "全选"}
          </button>
          <button
            className="btn-ghost h-7 px-2.5 text-[11.5px] flex items-center gap-1"
            disabled={!selRows.length}
            onClick={batchLike}
          >
            <Heart size={12} /> 收藏
          </button>
          <button
            className="btn-ghost h-7 px-2.5 text-[11.5px] flex items-center gap-1"
            disabled={!selRows.length}
            onClick={batchDownload}
          >
            <Download size={12} /> 下载
          </button>
          <button
            className="btn-ghost h-7 px-2.5 text-[11.5px] flex items-center gap-1"
            disabled={!selRows.length}
            onClick={() => {
              if (selRows.length) setPickerRows(selRows);
            }}
          >
            <ListMusic size={12} /> 加歌单
          </button>
          <div className="flex-1" />
          <button
            className="btn-ghost h-7 px-2.5 text-[11.5px] flex items-center gap-1"
            onClick={() => {
              setSelMode(false);
              setSelKeys(new Set());
            }}
          >
            <X size={12} /> 完成
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-2">
        {!result ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--ink-3)]">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <Tv size={26} className="text-[var(--ink-3)]" />
            </div>
            <div className="text-[13.5px]">粘贴 B 站视频或 UP 主空间链接开始</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {space && (
              <>
                <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <CoverImg
                    src={space.face}
                    seed={space.name}
                    className="w-12 h-12 rounded-full shrink-0"
                    iconSize={16}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-[var(--ink)] truncate flex items-center gap-2">
                      <Tv size={13} className="text-[#fb7299] shrink-0" />
                      {space.name}
                    </div>
                    <div className="text-[11.5px] text-[var(--ink-2)] flex items-center gap-1.5 mt-0.5">
                      <Users size={10} />
                      {space.fans} · 共 {space.total} 个视频
                    </div>
                  </div>
                  {!selMode && (
                    <button
                      className="btn-ghost h-8 px-3 text-[12px] shrink-0 flex items-center gap-1.5"
                      onClick={() => {
                        setSelMode(true);
                        setSelKeys(new Set());
                      }}
                    >
                      <Square size={12} /> 多选
                    </button>
                  )}
                  <button
                    className="btn-ghost h-8 px-3 text-[12px] shrink-0"
                    onClick={() => {
                      replaceResult(null);
                      setSelMode(false);
                    }}
                  >
                    关闭
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ORDERS.map((o) => (
                    <button
                      key={o.key}
                      className={`h-7 px-3 rounded-full text-[11.5px] transition-colors ${
                        !space.activeCollection && space.order === o.key
                          ? "bg-[#fb7299]/15 text-[#fb7299] font-semibold"
                          : "text-[var(--ink-2)] hover:bg-[var(--shade)]"
                      }`}
                      onClick={() => changeOrder(o.key)}
                    >
                      {o.label}
                    </button>
                  ))}
                  {space.collections.map((c) => (
                    <button
                      key={`${c.kind}-${c.id}`}
                      className={`h-7 px-3 rounded-full text-[11.5px] transition-colors max-w-[220px] truncate ${
                        space.activeCollection?.id === c.id
                          ? "bg-[var(--accent-weak)] text-[var(--accent-strong)] font-semibold"
                          : "text-[var(--ink-2)] hover:bg-[var(--shade)]"
                      }`}
                      title={`${c.title}（${c.total}个）`}
                      onClick={() => openCollection(c)}
                    >
                      <ListMusic size={10} className="inline mr-1 -mt-px" />
                      {c.title}
                    </button>
                  ))}
                  {/* 多选时非 space 结果也要能进多选：video/direct 的入口在列表上方 */}
                </div>
                {space.activeCollection && (
                  <div className="text-[12px] text-[var(--ink-2)] px-1 flex items-center gap-2">
                    <span className="text-[var(--ink)] font-medium">
                      {space.activeCollection.title}
                    </span>
                    <span>{space.activeCollection.total} 个视频</span>
                    <button
                      className="text-[var(--accent)] hover:underline"
                      onClick={() => {
                        setResult((cur) =>
                          cur && cur.type === "space"
                            ? { ...cur, activeCollection: null }
                            : cur
                        );
                        setSelKeys(new Set());
                      }}
                    >
                      返回全部投稿
                    </button>
                  </div>
                )}
              </>
            )}
            {!space && !selMode && visibleRows.length > 0 && (
              <div className="flex items-center justify-between px-1">
                <span className="text-[11.5px] text-[var(--ink-3)]">
                  {visibleRows.length} 个结果
                </span>
                <button
                  className="btn-ghost h-7 px-2.5 text-[11.5px] flex items-center gap-1.5"
                  onClick={() => {
                    setSelMode(true);
                    setSelKeys(new Set());
                  }}
                >
                  <Square size={12} /> 多选
                </button>
              </div>
            )}
            {!space && selMode && listRows.length === 0 && (
              <div className="text-[12px] text-[var(--ink-3)] text-center py-2">
                当前结果为空
              </div>
            )}

            {result.type === "video" && result.rows.map((r) => renderRow(r))}
            {result.type === "direct" &&
              result.rows.map((r) => renderRow(r, { sourceId: r.sourceId }))}
            {space &&
              (space.activeCollection ? space.activeCollection.rows : space.rows).map(
                (r) => renderRow(r)
              )}

            {space &&
              (space.activeCollection ? space.activeCollection.hasMore : space.hasMore) && (
                <button
                  className="h-10 rounded-xl text-[12.5px] text-[var(--ink-2)] hover:bg-[var(--shade)] border border-white/[0.05] flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  disabled={
                    space.activeCollection
                      ? space.activeCollection.loadingMore
                      : space.loadingMore
                  }
                  onClick={loadMore}
                >
                  <Plus size={13} />
                  {space.activeCollection
                    ? space.activeCollection.loadingMore
                      ? "加载中…"
                      : `加载更多（已显示 ${space.activeCollection.rows.length}/${space.activeCollection.total}）`
                    : space.loadingMore
                      ? "加载中…"
                      : `加载更多（已显示 ${space.rows.length}/${space.total}）`}
                </button>
              )}
          </div>
        )}
      </div>

      {/* 右键菜单（Portal 到 body：fixed 相对视口定位） */}
      {menu &&
        createPortal(
          <div
            className="fixed z-[75] w-[190px] glass-strong rounded-xl p-1.5 shadow-2xl anim-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseLeave={() => setMenu(null)}
          >
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                const idx = visibleRows.findIndex((x) => x.rid === menu.row.rid);
                playBilibiliList(visibleRows, idx >= 0 ? idx : 0);
                setMenu(null);
              }}
            >
              <Play size={13} /> 播放
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                const item = menuEntryToQueueItem(menu.row);
                if (item) playNext(item);
                setMenu(null);
              }}
            >
              <Play size={13} /> 下一首播放
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                const item = menuEntryToQueueItem(menu.row);
                if (item) addToQueue(item);
                setMenu(null);
              }}
            >
              <Play size={13} /> 加入队列
            </button>
            <div className="my-1 mx-2 border-t border-[var(--line)]" />
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                setPickerRows([menu.row]);
                setMenu(null);
              }}
            >
              <ListMusic size={13} /> 添加到播放列表…
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                toggleLikeOnline(toOnlineRow(menu.row));
                setMenu(null);
              }}
            >
              <Heart size={13} /> {rowLiked(menu.row) ? "取消喜欢" : "收藏到“我喜欢”"}
            </button>
            <button
              className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--shade-strong)] text-left"
              onClick={() => {
                downloadOnline(toOnlineRow(menu.row));
                setMenu(null);
              }}
            >
              <ListMusic size={13} /> 下载到本地
            </button>
          </div>,
          document.body
        )}

      {/* 添加到播放列表弹窗（单行/批量共用） */}
      <Modal
        open={pickerRows != null}
        onClose={() => setPickerRows(null)}
        title={pickerRows && pickerRows.length > 1 ? `添加 ${pickerRows.length} 首到播放列表` : "添加到播放列表"}
        width={380}
      >
        <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
          {playlists.map((p) => (
            <button
              key={p.id}
              className="h-10 px-3 rounded-lg text-left text-[13px] text-[var(--ink)] hover:bg-[var(--shade)] flex items-center justify-between transition-colors"
              onClick={async () => {
                if (pickerRows) {
                  for (const r of pickerRows) {
                    await addOnlineToPlaylist(p.id, toOnlineRow(r));
                  }
                }
                setPickerRows(null);
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
              还没有播放列表，在下方创建
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newPlName}
            onChange={(e) => setNewPlName(e.target.value)}
            placeholder="新播放列表名称"
            className="flex-1 h-9 rounded-lg bg-[var(--shade)] border border-[var(--line)] px-3 text-[13px] focus:border-[var(--line)] outline-none"
          />
          <button
            className="btn-secondary"
            onClick={async () => {
              if (!newPlName.trim() || !pickerRows?.length) return;
              const pid = await createPlaylist(newPlName.trim());
              if (pid >= 0) {
                for (const r of pickerRows) {
                  await addOnlineToPlaylist(pid, toOnlineRow(r));
                }
              }
              setNewPlName("");
              setPickerRows(null);
            }}
          >
            创建并添加
          </button>
        </div>
      </Modal>

      {/* B 站扫码登录弹窗 */}
      <Modal
        open={!!qr}
        onClose={() => {
          qrRunRef.current++;
          setQr(null);
        }}
        title="B 站登录"
        width={300}
      >
        <div className="flex flex-col items-center gap-3 py-2">
          {qr && (
            <img
              src={qr.qr}
              alt="B站登录二维码"
              className="w-[220px] h-[220px] rounded-xl bg-white p-2"
            />
          )}
          <div className="text-[12.5px] text-[var(--ink-2)] text-center leading-relaxed">
            用 <span className="text-[#fb7299] font-medium">哔哩哔哩 App</span> 扫码登录
            <br />
            登录后可显示视频字幕（作歌词）、按收藏排序
          </div>
        </div>
      </Modal>
    </div>
  );

  /** 直链：入库（供 playSource 播放）+ 作为当前结果展示 */
  async function submitDirect() {
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return;
    try {
      const { api } = await import("../api");
      const id = await api.addSource(u, title.trim());
      setUrl("");
      setTitle("");
      replaceResult({
        type: "direct",
        rows: [
          {
            rid: `direct-${id}`,
            title: title.trim() || u.split("/").pop() || "在线音源",
            artist: "在线音源",
            cover: "",
            durationMs: 0,
            play: 0,
            created: Date.now() / 1000,
            sourceId: id,
          },
        ],
      });
      useStore.getState().toast("已添加并播放", "success");
      playSourceId(id);
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  }
}

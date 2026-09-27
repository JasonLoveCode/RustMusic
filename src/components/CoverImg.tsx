import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { coverSrc } from "../api";
import { gradientFor } from "../utils";

interface CoverImgProps {
  src?: string;
  seed: string;
  className?: string;
  iconSize?: number;
}

export default function CoverImg({ src, seed, className = "", iconSize = 18 }: CoverImgProps) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);

  const url = src
    ? src.startsWith("http://") || src.startsWith("https://")
      ? src
      : coverSrc(src)
    : "";
  if (url && !err) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        // lazy：不在可视区附近的封面不发起加载（长列表滚动时按需解码，
        // 渲染进程的图片缓存不再随曲库规模线性增长）
        loading="lazy"
        decoding="async"
        // 不带 Referer：应用来源（tauri.localhost）会被 B 站等图床的
        // 防盗链拒绝（403），无 Referer 反而放行
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
        className={`object-cover bg-[var(--shade)] ${className}`}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center text-[var(--ink)]/40 ${className}`}
      style={{ background: gradientFor(seed) }}
    >
      <Music2 size={iconSize} strokeWidth={1.6} />
    </div>
  );
}

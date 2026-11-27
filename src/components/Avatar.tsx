import { useEffect, useState } from 'react';
import { lineFaces, type LineFace } from '../lib/api';

/* Thai vowels written before the consonant: skip them so "เอ" shows "อ", not "เ". */
const LEADING = /^[เแโใไ]/;
function initial(name: string) {
  const chars = Array.from(name.trim().replace(LEADING, ''));
  return (chars[0] ?? '?').toUpperCase();
}

/** Round picture; falls back to the first letter of the name if there is none or it fails to load
 *  (LINE picture links stop working when the person changes their photo). */
export function Avatar({ src, name, size = 36, title }: { src?: string | null; name: string; size?: number; title?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (src && broken !== src) {
    return (
      <img src={src} alt="" title={title} style={style} width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setBroken(src)} className="rounded-full object-cover shrink-0 bg-line" />
    );
  }
  return (
    <span title={title} aria-hidden style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className="rounded-full bg-line text-ink-soft font-semibold shrink-0 inline-flex items-center justify-center select-none">
      {initial(name)}
    </span>
  );
}

/** Avatar for someone who may have a LINE account: shows their LINE profile picture when known. */
export function LineAvatar({ lineUserId, name, size }: { lineUserId: string | null | undefined; name: string; size?: number }) {
  const [face, setFace] = useState<LineFace | null>(null);
  useEffect(() => {
    if (!lineUserId) { setFace(null); return; }
    let live = true;
    lineFaces().then((m) => { if (live) setFace(m.get(lineUserId) ?? null); }).catch(() => { /* fall back to the letter */ });
    return () => { live = false; };
  }, [lineUserId]);
  return <Avatar src={face?.picture_url} name={name} size={size} title={face?.display_name ? `LINE: ${face.display_name}` : undefined} />;
}

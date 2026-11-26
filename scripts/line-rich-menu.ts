/* LINE rich menu for the dorm OA: four buttons under the chat, the same as the bot's main menu
 * plus "Language". Taps send the same postbacks as the quick-reply buttons ("bot=info", ...), so
 * the line-webhook handles them in the user's chosen language.
 *
 *   npm run richmenu:png                       draws supabase/line/richmenu.png (2500 x 843), nothing else
 *   npm run richmenu:create -- --yes           creates the menu ON THE REAL LINE ACCOUNT and makes it the
 *                                              default for everyone. Needs LINE_CHANNEL_ACCESS_TOKEN set in
 *                                              the terminal for that one command (never saved in a file).
 *   npm run richmenu:create -- --yes --image my.png   same, with your own 2500 x 843 PNG/JPEG (< 1 MB)
 *
 * The picture is drawn here with Node's built-in zlib (no image library): coloured tiles in the
 * app's colours, a simple icon and a short label on each. Replace it with a designed image any time.
 * To remove the menu later: LINE OA Manager -> Rich menus, or DELETE /v2/bot/richmenu/{id}. */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const W = 2500, H = 843;
const OUT = 'supabase/line/richmenu.png';

/* ------------------------------------------------------------------ the menu definition */
// Same postback data as _shared/bot.ts botData(): "bot=info", "bot=connect", "bot=contact", "bot=langpick".
export const AREAS = [
  { key: 'info', data: 'bot=info', label: 'INFO', color: '#2F6F6D' },        // teal
  { key: 'connect', data: 'bot=connect', label: 'MY ROOM', color: '#4F6E47' }, // sage
  { key: 'contact', data: 'bot=contact', label: 'CONTACT', color: '#B14A34' }, // terracotta
  { key: 'language', data: 'bot=langpick', label: 'TH / EN', color: '#21262B' }, // ink
] as const;
const PAPER = '#F6F3EC';
const TILE = W / AREAS.length;   // 625

export function richMenuBody() {
  return {
    size: { width: W, height: H },
    selected: true,
    name: 'Dorm main menu',
    chatBarText: 'เมนู / Menu',
    areas: AREAS.map((a, i) => ({
      bounds: { x: Math.round(i * TILE), y: 0, width: Math.round(TILE), height: H },
      action: { type: 'postback', data: a.data },
    })),
  };
}

/* ------------------------------------------------------------------ tiny drawing kit */
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const cover = (d: number) => clamp01(0.5 - d);            // signed distance (px) -> pixel coverage

// Signed distance functions (negative inside), in pixels.
const sdCircle = (x: number, y: number, cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) - r;
const sdRing = (x: number, y: number, cx: number, cy: number, r: number, w: number) => Math.abs(sdCircle(x, y, cx, cy, r)) - w / 2;
function sdBox(x: number, y: number, cx: number, cy: number, hw: number, hh: number, rad = 0) {
  const qx = Math.abs(x - cx) - hw + rad, qy = Math.abs(y - cy) - hh + rad;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}
function sdEllipseRing(x: number, y: number, cx: number, cy: number, rx: number, ry: number, w: number) {
  const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return Math.abs((k - 1) * Math.min(rx, ry)) - w / 2;  // good enough for a thin ring
}
function sdTriangle(x: number, y: number, a: [number, number], b: [number, number], c: [number, number]) {
  const edge = (p: [number, number], q: [number, number]) => {
    const ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey);
    return ((x - p[0]) * ey - (y - p[1]) * ex) / len;
  };
  const s = Math.sign(edge(a, b) + edge(b, c) + edge(c, a)) || 1;
  return Math.max(-s * edge(a, b), -s * edge(b, c), -s * edge(c, a));
}

/** The white icon of a tile as one distance function, centred on (cx, cy). */
function iconSdf(key: string, cx: number, cy: number): (x: number, y: number) => number {
  const S = 150;   // icon radius
  switch (key) {
    case 'info':      // circle with an "i"
      return (x, y) => Math.min(
        sdRing(x, y, cx, cy, S, 26),
        sdCircle(x, y, cx, cy - 72, 20),
        sdBox(x, y, cx, cy + 30, 16, 62, 10),
      );
    case 'connect':   // a key
      return (x, y) => Math.min(
        sdRing(x, y, cx - 70, cy, 62, 28),
        sdBox(x, y, cx + 55, cy, 78, 14, 6),
        sdBox(x, y, cx + 105, cy + 34, 14, 30, 4),
        sdBox(x, y, cx + 60, cy + 26, 13, 22, 4),
      );
    case 'contact': { // a chat bubble with three dots
      const bubble = (x: number, y: number) => Math.min(
        sdBox(x, y, cx, cy - 15, S, 105, 40),
        sdTriangle(x, y, [cx - 95, cy + 70], [cx - 25, cy + 70], [cx - 110, cy + 140]),
      );
      return (x, y) => {
        const dots = Math.min(sdCircle(x, y, cx - 62, cy - 15, 20), sdCircle(x, y, cx, cy - 15, 20), sdCircle(x, y, cx + 62, cy - 15, 20));
        return Math.max(bubble(x, y), -dots);   // dots cut out of the bubble
      };
    }
    default:          // language: a globe
      return (x, y) => {
        const inside = sdCircle(x, y, cx, cy, S);   // everything but the outline is clipped to the globe
        return Math.min(
          sdRing(x, y, cx, cy, S, 24),
          Math.max(inside, Math.min(
            sdEllipseRing(x, y, cx, cy, 62, S, 20),
            sdBox(x, y, cx, cy, S, 11),
            sdBox(x, y, cx, cy - 75, S, 10),
            sdBox(x, y, cx, cy + 75, S, 10),
          )),
        );
      };
  }
}

// 5 x 7 pixel font, only the letters the labels use.
const FONT: Record<string, string[]> = {
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const PX = 9;                       // one font pixel = 9 x 9 image pixels
const CHAR_W = 6 * PX;              // 5 columns + 1 space

function textMask(label: string, cx: number, top: number): (x: number, y: number) => boolean {
  const left = Math.round(cx - (label.length * CHAR_W - PX) / 2);
  return (x, y) => {
    const row = Math.floor((y - top) / PX);
    if (row < 0 || row > 6 || x < left) return false;
    const i = Math.floor((x - left) / CHAR_W), col = Math.floor(((x - left) % CHAR_W) / PX);
    if (i >= label.length || col > 4) return false;
    return FONT[label[i]]?.[row][col] === '#';
  };
}

/* ------------------------------------------------------------------ render + PNG */
export function renderRichMenu(): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const paper = hex(PAPER);
  const GAP = 6;
  const tiles = AREAS.map((a, i) => {
    const x0 = Math.round(i * TILE), x1 = Math.round((i + 1) * TILE);
    const cx = (x0 + x1) / 2;
    return { x0, x1, bg: hex(a.color), icon: iconSdf(a.key, cx, 330), text: textMask(a.label, cx, 600) };
  });
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0;                                  // PNG filter: none
    let t = 0;
    for (let x = 0; x < W; x++) {
      while (x >= tiles[t].x1) t++;
      const tile = tiles[t];
      const inGap = (t > 0 && x < tile.x0 + GAP / 2) || (t < tiles.length - 1 && x >= tile.x1 - GAP / 2);
      let a = 0;
      if (!inGap) {
        a = (y > 150 && y < 520) ? cover(tile.icon(x + 0.5, y + 0.5)) : 0;
        if (y >= 600 && y < 600 + 7 * PX && tile.text(x, y)) a = 1;
      }
      const base = inGap ? paper : tile.bg;
      const o = row + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(base[c] * (1 - a) + paper[c] * a);
    }
  }
  return png(W, H, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ LINE API (only with --create --yes) */
async function line(token: string, url: string, init: { method?: string; body?: BodyInit; type?: string } = {}) {
  const res = await fetch(url, {
    method: init.method ?? 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(init.type ? { 'Content-Type': init.type } : {}) },
    body: init.body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function create(imagePath: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('Set LINE_CHANNEL_ACCESS_TOKEN in this terminal first (see the header of this file).');
  const img = readFileSync(imagePath);
  if (img.length > 1024 * 1024) throw new Error('The image must be under 1 MB.');
  const type = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const made = await line(token, 'https://api.line.me/v2/bot/richmenu', { body: JSON.stringify(richMenuBody()), type: 'application/json' });
  const id = String(made.richMenuId);
  await line(token, `https://api-data.line.me/v2/bot/richmenu/${id}/content`, { body: img, type });
  await line(token, `https://api.line.me/v2/bot/user/all/richmenu/${id}`);
  console.log(`Rich menu ${id} created and set as the default for everyone.`);
}

/* ------------------------------------------------------------------ command line */
const args = process.argv.slice(2);
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/line-rich-menu.ts')) {   // run directly, not imported by a test
  if (args.includes('--create')) {
    if (!args.includes('--yes')) {
      console.log('This changes the REAL LINE account (the menu every follower sees). Add --yes to go ahead.');
      process.exit(1);
    }
    const i = args.indexOf('--image');
    await create(i >= 0 ? args[i + 1] : OUT);
  } else {
    const pngBytes = renderRichMenu();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, pngBytes);
    console.log(`${OUT}: ${W} x ${H}, ${(pngBytes.length / 1024).toFixed(0)} KB (LINE limit 1024 KB)`);
  }
}

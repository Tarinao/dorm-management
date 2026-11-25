/* QR code -> PNG bytes, for the PromptPay QR sent on LINE (LINE can only show images from a URL).
 * The QR module matrix comes from the "qrcode" library; the PNG is written here with the
 * platform's own zlib (CompressionStream 'deflate' = zlib format, which PNG requires). */
import QRCode from 'npm:qrcode@1.5.4';

/** Black/white PNG of the QR for `text`. `scale` pixels per module, 4-module white border. */
export async function qrPng(text: string, scale = 10): Promise<Uint8Array> {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n: number = qr.modules.size;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && qr.modules.get(y, x) === 1;
  return pngFromMatrix(n, dark, scale);
}

/** Exported for the tests: any square matrix to an 8-bit grayscale PNG. */
export async function pngFromMatrix(n: number, dark: (x: number, y: number) => boolean, scale: number, border = 4): Promise<Uint8Array> {
  const size = (n + border * 2) * scale;
  const raw = new Uint8Array(size * (size + 1));          // each row: filter byte 0 + pixels
  for (let py = 0; py < size; py++) {
    const row = py * (size + 1);
    raw[row] = 0;
    const my = Math.floor(py / scale) - border;
    for (let px = 0; px < size; px++) raw[row + 1 + px] = dark(Math.floor(px / scale) - border, my) ? 0 : 255;
  }
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size);
  ihdr.set([8, 0, 0, 0, 0], 8);                           // 8-bit, grayscale, deflate, no filter, no interlace
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

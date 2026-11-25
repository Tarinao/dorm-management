/* Read the QR printed on a bank slip photo (JPEG, as LINE delivers images).
 * Returns the QR text, or null when the photo has no readable QR (staff then check it by eye). */
import jpeg from 'npm:jpeg-js@0.4.4';
import jsQR from 'npm:jsqr@1.4.0';

export function readSlipQr(bytes: Uint8Array): string | null {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isJpeg) return null;
  const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
  const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  // Slip QRs are dark-on-light, so one pass without colour inversion is enough (and half the work).
  const hit = jsQR(data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return hit?.data?.trim() || null;
}

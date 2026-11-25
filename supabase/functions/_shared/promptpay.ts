/* PromptPay QR payload (EMVCo merchant-presented QR, Thai PromptPay profile) and the reference
 * inside a Thai bank-slip QR. Pure functions: shared by the Edge Functions and the Node tests.
 *
 * A payload is a list of TLV fields: 2-digit tag, 2-digit length, value. It ends with tag 63
 * (CRC), whose value is the CRC-16/CCITT-FALSE of everything before it, including "6304". */

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR), as 4 uppercase hex digits. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (tag: string, value: string) => {
  if (value.length > 99) throw new Error(`TLV value too long for tag ${tag}`);
  return tag + String(value.length).padStart(2, '0') + value;
};

export type PromptPayKind = 'phone' | 'national_id';

/** Which PromptPay type a number is: 10-digit phone starting with 0, or 13-digit ID. Dashes/spaces ignored. */
export function promptPayKind(id: string): PromptPayKind | null {
  const d = String(id ?? '').replace(/[\s-]/g, '');
  if (/^0[0-9]{9}$/.test(d)) return 'phone';
  if (/^[0-9]{13}$/.test(d)) return 'national_id';
  return null;
}

/** The text inside a PromptPay QR. With an amount (> 0) the QR is single-use style ("12") and the
 *  banking app fills in that exact amount; without one it is the reusable kind ("11"). */
export function promptPayPayload(id: string, amount?: number | null): string {
  const d = String(id ?? '').replace(/[\s-]/g, '');
  const kind = promptPayKind(d);
  if (!kind) throw new Error('BAD_PROMPTPAY_ID');
  // Phone numbers are sent in international form, 13 characters: 0812345678 -> 0066812345678.
  const target = kind === 'phone' ? tlv('01', ('0066' + d.slice(1)).padStart(13, '0')) : tlv('02', d);
  const amt = amount != null && Number(amount) > 0 ? (Math.round(Number(amount) * 100) / 100).toFixed(2) : null;
  const body =
    tlv('00', '01') +                                         // payload format indicator
    tlv('01', amt ? '12' : '11') +                            // point of initiation
    tlv('29', tlv('00', 'A000000677010111') + target) +       // PromptPay merchant account
    tlv('58', 'TH') +                                         // country
    tlv('53', '764') +                                        // currency: THB
    (amt ? tlv('54', amt) : '') +                             // amount
    '6304';                                                   // CRC tag + length
  return body + crc16(body);
}

/** Split a TLV string into tag -> value. Null if it is not well-formed. */
export function parseTlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4));
    if (!/^[0-9]{2}$/.test(tag) || !/^[0-9]{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) return null;
    out.set(tag, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** True when the last 4 characters are the correct CRC of the rest (for payloads ending in 6304xxxx). */
export function hasValidCrc(payload: string): boolean {
  return payload.length > 8 && payload.slice(-8, -4) === '6304' && crc16(payload.slice(0, -4)) === payload.slice(-4).toUpperCase();
}

/** The transaction reference in a Thai bank slip's QR ("mini QR" used by all Thai banks for
 *  slip verification): field 00 holds sub-fields 00 = "000001", 01 = sending bank code,
 *  02 = transaction reference. Returned as "bank:reference", e.g. "004:016330...".
 *  Null when the text is not a slip QR. */
export function slipReference(qrText: string | null | undefined): string | null {
  const s = String(qrText ?? '').trim();
  const top = parseTlv(s);
  const inner = top?.get('00');
  const sub = inner ? parseTlv(inner) : null;
  const ref = sub?.get('02')?.trim();
  if (!sub || sub.get('00') !== '000001' || !ref) return null;
  return `${sub.get('01') ?? ''}:${ref}`;
}

/** The value stored in the UNIQUE slip column: the slip reference when the QR is a slip QR,
 *  otherwise the raw QR text (so the same unknown QR sent twice is still caught). Null = no QR. */
export function slipKey(qrText: string | null | undefined): string | null {
  const s = String(qrText ?? '').trim();
  if (!s) return null;
  return slipReference(s) ?? `raw:${s.slice(0, 300)}`;
}

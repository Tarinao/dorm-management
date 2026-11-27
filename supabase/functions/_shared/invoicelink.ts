/* The LINE "View invoice" link: one unguessable token per bill (32 random bytes, base64url).
 * Only its SHA-256 is stored (public.invoice_links); the token itself is only in the LINE message.
 * A link expires after 90 days; making a new one for the same bill replaces (and so cancels) the old one. */

export const LINK_DAYS = 90;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export const isToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

/** SHA-256 of the token, lowercase hex (what invoice_links.token_hash holds). */
export async function hashToken(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The page that shows the invoice: the app's public route (the app is a static site; Edge
 *  Functions on supabase.co cannot serve HTML pages). The token sits after '#', so it is never
 *  sent to the web host; the page sends it to the "invoice" function. */
export function invoiceUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/#/i/${token}`;
}

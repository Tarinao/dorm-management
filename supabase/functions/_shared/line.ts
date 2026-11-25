/* LINE Messaging API calls (Deno). The access token is passed in by the caller, which reads it
 * from the Edge Function secret LINE_CHANNEL_ACCESS_TOKEN. Never log the token. */

export type LineMessage = { type: 'text'; text: string } | Record<string, unknown>;

const API = 'https://api.line.me/v2/bot';

async function call(token: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // LINE's error body says what was wrong (e.g. expired reply token); it contains no secrets.
    throw new Error(`LINE ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

export const text = (t: string): LineMessage => ({ type: 'text', text: t });

/** Answer an event (free, but the reply token works only once and only shortly after the event). */
export function reply(token: string, replyToken: string, messages: LineMessage[]) {
  return call(token, '/message/reply', { replyToken, messages });
}

/** Send a message to a user at any time (counts toward the monthly message quota). */
export function push(token: string, to: string, messages: LineMessage[]) {
  return call(token, '/message/push', { to, messages });
}

/** Display name and picture. Returns empty strings if LINE does not give them (e.g. user blocked the OA). */
export async function getProfile(token: string, userId: string): Promise<{ displayName: string; pictureUrl: string }> {
  try {
    const res = await fetch(`${API}/profile/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { displayName: '', pictureUrl: '' };
    const p = await res.json() as { displayName?: string; pictureUrl?: string };
    return { displayName: p.displayName ?? '', pictureUrl: p.pictureUrl ?? '' };
  } catch {
    return { displayName: '', pictureUrl: '' };
  }
}

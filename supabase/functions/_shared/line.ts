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

/** Text with tap-to-answer buttons under it. Each button sends a postback (data) to the webhook
 *  and shows `said` in the chat as if the tenant typed it. LINE: label <= 20 chars, data <= 300. */
export function textWithButtons(t: string, buttons: { label: string; data: string; said: string }[]): LineMessage {
  return {
    type: 'text',
    text: t,
    quickReply: {
      items: buttons.map((b) => ({ type: 'action', action: { type: 'postback', label: b.label, data: b.data, displayText: b.said } })),
    },
  };
}

/** An image LINE downloads from an https URL (JPEG or PNG). */
export const image = (url: string): LineMessage => ({ type: 'image', originalContentUrl: url, previewImageUrl: url });

/** The bytes of an image the user sent (e.g. a payment slip). */
export async function getContent(token: string, messageId: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE content failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
}

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

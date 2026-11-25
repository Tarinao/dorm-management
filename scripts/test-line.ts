/* Tests for the LINE helpers shared by the Edge Functions and the app.
 * Run: npm run test:line */
import { createHmac } from 'node:crypto';
import { MSG, parseRoomNumber, tenantLabel, tenantShort, verifyLineSignature } from '../supabase/functions/_shared/core.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`); }
}
function eq<T>(actual: T, expected: T, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// A made-up secret for the test only (not the real channel secret).
const SECRET = 'test-channel-secret-0123456789abcdef';
const BODY = JSON.stringify({ destination: 'Uxxxxxxxx', events: [{ type: 'follow', replyToken: 'r1', source: { type: 'user', userId: 'U' + 'a'.repeat(32) } }] });
// Reference signature computed independently with Node's crypto (what LINE does on its side).
const GOOD = createHmac('sha256', SECRET).update(BODY).digest('base64');

console.log('LINE signature');
await test('accepts the correct signature', async () => eq(await verifyLineSignature(SECRET, BODY, GOOD), true));
await test('rejects a wrong signature', async () => eq(await verifyLineSignature(SECRET, BODY, 'AAAA' + GOOD.slice(4)), false));
await test('rejects a signature made with another secret', async () =>
  eq(await verifyLineSignature(SECRET, BODY, createHmac('sha256', 'other').update(BODY).digest('base64')), false));
await test('rejects a changed body', async () => eq(await verifyLineSignature(SECRET, BODY.replace('follow', 'unfollow'), GOOD), false));
await test('rejects a missing signature', async () => eq(await verifyLineSignature(SECRET, BODY, null), false));
await test('rejects an empty secret', async () => eq(await verifyLineSignature('', BODY, GOOD), false));
await test('works with Thai text in the body', async () => {
  const body = JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: 'ห้อง ๑๐๑' } }] });
  eq(await verifyLineSignature(SECRET, body, createHmac('sha256', SECRET).update(body).digest('base64')), true);
});

console.log('Room number typed in the chat');
await test('plain and decorated room numbers', () => {
  eq(parseRoomNumber('101'), '101');
  eq(parseRoomNumber('  204 '), '204');
  eq(parseRoomNumber('ห้อง 101'), '101');
  eq(parseRoomNumber('ห้องที่ 315'), '315');
  eq(parseRoomNumber('Room 537'), '537');
  eq(parseRoomNumber('#102'), '102');
  eq(parseRoomNumber('๑๐๑'), '101');
});
await test('not a room number', () => {
  eq(parseRoomNumber('hello'), null);
  eq(parseRoomNumber('สวัสดีค่ะ'), null);
  eq(parseRoomNumber('101 102'), null);
  eq(parseRoomNumber('0812345678'), null);
  eq(parseRoomNumber(''), null);
  eq(parseRoomNumber(undefined), null);
});

console.log('Tenant label "101 (nickname)"');
await test('nickname wins', () => eq(tenantLabel('101', { full_name: 'สมชาย ใจดี', nickname: 'ต้น' }), '101 (ต้น)'));
await test('else first name, without the title', () => {
  eq(tenantLabel('101', { full_name: 'นางสาว สุดา มีสุข', nickname: '' }), '101 (สุดา)');
  eq(tenantLabel('102', { full_name: 'นายสมชาย ใจดี' }), '102 (สมชาย)');
  eq(tenantShort({ full_name: 'Mr. John Smith' }), 'John');
});
await test('no tenant -> just the room', () => eq(tenantLabel('103', null), '103'));

console.log('Messages are Thai first, then English');
await test('every message starts with Thai', () => {
  const all = [MSG.askRoom, MSG.waiting, MSG.roomNotFound('999'), MSG.alreadyLinked('101'), MSG.linked('101'), MSG.rejected('101')];
  for (const m of all) eq(/^[฀-๿]/.test(m), true, m.slice(0, 20));
  eq(MSG.linked('101').startsWith('เชื่อมต่อห้อง 101 เรียบร้อย'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

/* Checks the "How to use" guide is complete in both languages. Run: npm run test:guide */
import assert from 'node:assert/strict';
import { GUIDE, type Pair } from '../src/guide/content.ts';

const thai = /[฀-๿]/;
const checkPair = (p: Pair, where: string) => {
  assert.equal(p.length, 2, `${where}: needs English and Thai`);
  assert.ok(p[0].trim().length > 0 && !thai.test(p[0]), `${where}: English text missing or contains Thai`);
  assert.ok(thai.test(p[1]), `${where}: Thai text missing`);
};

const required = ['check-in', 'meters', 'bills', 'payment', 'check-out', 'line-link', 'line-bills', 'line-slips', 'viewings', 'reservations', 'maintenance', 'line-chats'];
assert.deepEqual(GUIDE.map((s) => s.id), required, 'the required topics, in order');
let steps = 0;
for (const s of GUIDE) {
  checkPair(s.title, `${s.id}.title`);
  checkPair(s.intro, `${s.id}.intro`);
  if (s.tip) checkPair(s.tip, `${s.id}.tip`);
  assert.ok(s.steps.length >= 4, `${s.id}: at least 4 steps`);
  s.steps.forEach((p, i) => checkPair(p, `${s.id}.step${i + 1}`));
  steps += s.steps.length;
}
console.log(`guide ok: ${GUIDE.length} topics, ${steps} steps, each in English and Thai`);

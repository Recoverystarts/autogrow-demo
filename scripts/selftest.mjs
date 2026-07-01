// Pure-logic self test — no network, no KV. Run: node scripts/selftest.mjs
import { chunkText, retrieve } from '../functions/api/_lib.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('chunkText:');
const long = 'AutoGrow builds AI chatbots for local businesses. ' +
  'We serve Calgary barbershops, dentists, and restaurants. '.repeat(40);
const chunks = chunkText(long, 'https://x.com');
ok('produces multiple chunks', chunks.length > 1);
ok('chunks carry source', chunks.every(c => c.source === 'https://x.com'));
ok('chunks have ids + text', chunks.every(c => typeof c.id === 'number' && c.text.length > 0));
ok('respects ~target size', chunks.every(c => c.text.length < 1100));
ok('empty input → []', chunkText('').length === 0);

console.log('retrieve (keyword fallback path):');
const kb = { chunks: [
  { id: 0, text: 'Our barbershop is open Monday to Saturday 9am to 6pm.' },
  { id: 1, text: 'A classic haircut is $35 and a beard trim is $20.' },
  { id: 2, text: 'We are located at 123 Main Street in downtown Calgary.' }
] };
const env = {}; // no GEMINI key → keyword path
const hoursHit = await retrieve(env, kb, 'what are your hours and when are you open', 2);
ok('hours question retrieves the hours chunk', hoursHit.some(c => c.id === 0));
const priceHit = await retrieve(env, kb, 'how much does a haircut cost price', 2);
ok('price question retrieves the price chunk', priceHit.some(c => c.id === 1));
const locHit = await retrieve(env, kb, 'where are you located address', 2);
ok('location question retrieves the location chunk', locHit.some(c => c.id === 2));
const none = await retrieve(env, kb, 'zzzz qqqq', 2);
ok('no-match still returns context (non-empty)', none.length > 0);
ok('empty KB → []', (await retrieve(env, { chunks: [] }, 'x', 2)).length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTle, tleChecksumOk } from '../src/iss.js';
import { getIss, _resetIssCache } from '../src/data.js';
import worker from '../src/index.js';

const L1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const L2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';
const CELESTRAK = `ISS (ZARYA)             \r\n${L1}\r\n${L2}\r\n`;

test('TLE: checksums and parsing', () => {
  assert.ok(tleChecksumOk(L1) && tleChecksumOk(L2));
  assert.equal(tleChecksumOk(L1.slice(0, 68) + '3'), false);
  assert.equal(tleChecksumOk('1 25544U <script>'), false);
  assert.deepEqual(parseTle(CELESTRAK), [L1, L2]);
  assert.equal(parseTle(`${L1}\n${L2.replace('51.6433', '51.6434')}`), null, 'damaged line refused');
  assert.equal(parseTle('<html>error</html>'), null);
});

test('getIss: cached 6 h, retries after 30 min on failure, keeps an older set', async () => {
  _resetIssCache();
  let calls = 0;
  let fail = false;
  const fetchImpl = async () => { calls++; if (fail) throw new Error('down'); return new Response(CELESTRAK); };
  const t0 = Date.parse('2026-10-23T12:00:00Z');
  assert.deepEqual((await getIss(new Date(t0), fetchImpl)).tle, [L1, L2]);
  await getIss(new Date(t0 + 5 * 3600e3), fetchImpl);
  assert.equal(calls, 1);
  fail = true;
  const r = await getIss(new Date(t0 + 7 * 3600e3), fetchImpl);
  assert.deepEqual(r.tle, [L1, L2], 'older set kept');
  await getIss(new Date(t0 + 7 * 3600e3 + 10 * 60e3), fetchImpl);
  assert.equal(calls, 2, 'no hammering while CelesTrak is down');
  const old = await getIss(new Date(t0 + 4 * 86400e3), fetchImpl);
  assert.equal(old.tle, null, 'too old to trust');
  const res = await worker.fetch(new Request('https://x.workers.dev/api/iss'), {
    GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(40), WHATSUP_CONFIG: '{"allowed_emails":["a@b.co"]}',
  });
  assert.equal(res.status, 401);
});

// Run with: npm test   (from the cloud/ folder)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyAccess, normaliseTeamDomain, _resetAccessCache } from '../src/access.js';
import {
  parseServiceAccount, getAccessToken, fetchCalendars, eventToItem, midnightIn, dayKeyIn, _resetTokenCache,
} from '../src/google.js';
import { parseWeather, weatherKind } from '../src/weather.js';
import { loadConfig } from '../src/config.js';
import worker from '../src/index.js';
import { getData } from '../src/data.js';

const enc = new TextEncoder();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const TEAM = 'https://family.cloudflareaccess.com';
const AUD = 'aud-123';

async function rsaPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
}

async function signJwt(privateKey, header, payload) {
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const accessKeys = await rsaPair();
const accessJwk = { ...(await crypto.subtle.exportKey('jwk', accessKeys.publicKey)), kid: 'k1' };
const certsFetch = async (url) => {
  assert.equal(url, `${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [accessJwk] }));
};
const now = () => 1_800_000_000;
const goodPayload = { aud: [AUD], iss: TEAM, exp: now() + 3600, iat: now(), email: 'parent@example.com' };
const env = { TEAM_DOMAIN: 'family.cloudflareaccess.com', POLICY_AUD: AUD };
const reqWith = (token) => new Request('https://whatsup.example.workers.dev/', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });

test('team domain is normalised and validated', () => {
  assert.equal(normaliseTeamDomain('family'), TEAM);
  assert.equal(normaliseTeamDomain('https://Family.cloudflareaccess.com/'), TEAM);
  assert.equal(normaliseTeamDomain('evil.example.com'), null);
});

test('access: valid token passes', async () => {
  _resetAccessCache();
  const token = await signJwt(accessKeys.privateKey, { alg: 'RS256', kid: 'k1' }, goodPayload);
  const r = await verifyAccess(reqWith(token), env, certsFetch, now);
  assert.deepEqual(r, { ok: true, email: 'parent@example.com' });
});

test('access: fails closed when not configured', async () => {
  const token = await signJwt(accessKeys.privateKey, { alg: 'RS256', kid: 'k1' }, goodPayload);
  const r = await verifyAccess(reqWith(token), {}, certsFetch, now);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test('access: rejects missing, expired, wrong-audience, wrong-issuer and forged tokens', async () => {
  _resetAccessCache();
  const sign = (p, h = { alg: 'RS256', kid: 'k1' }) => signJwt(accessKeys.privateKey, h, p);
  const cases = {
    'no-token': null,
    expired: await sign({ ...goodPayload, exp: now() - 3600 }),
    'wrong-audience': await sign({ ...goodPayload, aud: ['other'] }),
    'wrong-issuer': await sign({ ...goodPayload, iss: 'https://evil.cloudflareaccess.com' }),
    'bad-alg': await sign(goodPayload, { alg: 'none', kid: 'k1' }),
  };
  for (const [reason, token] of Object.entries(cases)) {
    const r = await verifyAccess(reqWith(token), env, certsFetch, now);
    assert.equal(r.ok, false, reason);
    assert.equal(r.reason, reason);
  }
  // a key id that matches a built-in object property must not crash or pass
  const proto = await sign(goodPayload, { alg: 'RS256', kid: 'constructor' });
  const rp = await verifyAccess(reqWith(proto), env, certsFetch, now);
  assert.equal(rp.ok, false);
  assert.equal(rp.reason, 'unknown-key');
  const other = await rsaPair();
  const forged = await signJwt(other.privateKey, { alg: 'RS256', kid: 'k1' }, goodPayload);
  const r = await verifyAccess(reqWith(forged), env, certsFetch, now);
  assert.equal(r.reason, 'bad-signature');
});

// ---------------------------------------------------------------- google

const saKeys = await rsaPair();
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', saKeys.privateKey)).toString('base64');
const SA = {
  type: 'service_account',
  client_email: 'whatsup@family-dash.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`,
};

test('service account JSON is validated', () => {
  assert.throws(() => parseServiceAccount('nope'), /not valid JSON/);
  assert.throws(() => parseServiceAccount('{"type":"authorized_user"}'), /service account/);
  assert.equal(parseServiceAccount(JSON.stringify(SA)).client_email, SA.client_email);
});

test('DST-safe midnight and day keys', () => {
  assert.equal(midnightIn('2026-10-25', 'Europe/Amsterdam').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(midnightIn('2026-10-26', 'Europe/Amsterdam').toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(midnightIn('2027-03-28', 'Europe/Amsterdam').toISOString(), '2027-03-27T23:00:00.000Z');
  assert.equal(dayKeyIn(new Date('2026-10-22T22:30:00Z'), 'Europe/Amsterdam'), '2026-10-23');
  // Santiago skips 00:00 → 01:00 on 6 Sep 2026: the day starts at 01:00 local (04:00Z)
  const sc = midnightIn('2026-09-06', 'America/Santiago');
  assert.equal(dayKeyIn(sc, 'America/Santiago'), '2026-09-06');
  assert.equal(dayKeyIn(new Date(sc.getTime() - 1000), 'America/Santiago'), '2026-09-05');
  assert.equal(midnightIn('2026-10-22', 'Asia/Kolkata').toISOString(), '2026-10-21T18:30:00.000Z');
});

test('events: private, hidden, all-day, cancelled and multi-day handling', () => {
  const tz = 'Europe/Amsterdam';
  const cal = { name: 'Family', color: '#6AA9FF', show_details: true };
  const timed = eventToItem({ summary: 'Swimming', start: { dateTime: '2026-10-22T15:30:00+02:00' }, end: { dateTime: '2026-10-22T16:30:00+02:00' } }, cal, tz);
  assert.deepEqual([timed.start_label, timed.end_label, timed.title, timed.busy, timed.days], ['15:30', '16:30', 'Swimming', false, ['2026-10-22']]);
  const priv = eventToItem({ summary: 'Doctor', visibility: 'private', start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T10:00:00+02:00' } }, cal, tz);
  assert.equal(priv.title, 'Busy');
  const noDetails = eventToItem({ start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T10:00:00+02:00' } }, cal, tz);
  assert.equal(noDetails.title, 'Busy');
  const hidden = eventToItem({ summary: 'Party', start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T10:00:00+02:00' } }, { ...cal, show_details: false }, tz);
  assert.equal(hidden.title, 'Busy');
  const allDay = eventToItem({ summary: 'Trip', start: { date: '2026-10-22' }, end: { date: '2026-10-24' } }, cal, tz);
  assert.deepEqual(allDay.days, ['2026-10-22', '2026-10-23']);
  assert.equal(eventToItem({ status: 'cancelled', start: { date: '2026-10-22' } }, cal, tz), null);
  assert.equal(eventToItem({ eventType: 'workingLocation', start: { date: '2026-10-22' } }, cal, tz), null);
  const overnight = eventToItem({ summary: 'Flight', start: { dateTime: '2026-10-22T23:00:00+02:00' }, end: { dateTime: '2026-10-23T02:00:00+02:00' } }, cal, tz);
  assert.deepEqual(overnight.days, ['2026-10-22', '2026-10-23']);
  const html = eventToItem({ summary: '<img src=x onerror=alert(1)>\u0007', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } }, cal, tz);
  assert.equal(html.title, '<img src=x onerror=alert(1)>'); // stays plain text; the page uses textContent
});

function googleFetch(eventsByCal, calls) {
  return async (url, init = {}) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(init.body);
      const [h, p, s] = params.get('assertion').split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', saKeys.publicKey, Buffer.from(s, 'base64url'), enc.encode(`${h}.${p}`));
      assert.ok(ok, 'assertion is signed with the service account key');
      const claims = JSON.parse(Buffer.from(p, 'base64url'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.readonly');
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }
    const m = url.match(/calendars\/([^/]+)\/events\?(.*)$/);
    assert.ok(m, url);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const id = decodeURIComponent(m[1]);
    const qs = new URLSearchParams(m[2]);
    assert.equal(qs.get('singleEvents'), 'true');
    assert.equal(qs.get('timeMin'), '2026-10-21T22:00:00.000Z');
    assert.equal(qs.get('timeMax'), '2026-10-23T22:00:00.000Z');
    if (!(id in eventsByCal)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ items: eventsByCal[id] }));
  };
}

test('fetchCalendars merges calendars, splits today/tomorrow and reports unshared calendars', async () => {
  _resetTokenCache();
  const config = loadConfig(JSON.stringify({
    calendars: [
      { name: 'Family', calendar_id: 'family@group.calendar.google.com', color: '#6AA9FF' },
      { name: 'Kids', calendar_id: 'kids@group.calendar.google.com', color: '#5ED39A' },
      { name: 'Missing', calendar_id: 'missing@group.calendar.google.com' },
    ],
  })).config;
  const calls = [];
  const fetchImpl = googleFetch({
    'family@group.calendar.google.com': [
      { id: 'a', summary: 'Dinner', start: { dateTime: '2026-10-22T18:30:00+02:00' }, end: { dateTime: '2026-10-22T19:30:00+02:00' } },
      { id: 'b', summary: 'Birthday', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
      { id: 'c', summary: 'School trip', start: { dateTime: '2026-10-23T08:00:00+02:00' }, end: { dateTime: '2026-10-23T15:00:00+02:00' } },
    ],
    'kids@group.calendar.google.com': [
      { id: 'd', summary: 'Swimming', start: { dateTime: '2026-10-22T15:30:00+02:00' }, end: { dateTime: '2026-10-22T16:30:00+02:00' } },
    ],
  }, calls);
  const res = await fetchCalendars(config, SA, new Date('2026-10-22T05:42:00Z'), fetchImpl);
  assert.deepEqual(res.today.map((e) => e.title), ['Birthday', 'Swimming', 'Dinner']);
  assert.deepEqual(res.tomorrow.map((e) => e.title), ['School trip']);
  assert.deepEqual(res.errors, ["Missing: not shared with the dashboard's robot account yet"]);
  assert.equal(res.today[1].color, '#5ED39A');
  assert.equal(calls.filter((u) => u.includes('oauth2')).length, 1);
  // token is reused
  await fetchCalendars(config, SA, new Date('2026-10-22T05:50:00Z'), fetchImpl);
  assert.equal(calls.filter((u) => u.includes('oauth2')).length, 1);
  assert.ok(!JSON.stringify(res).includes('calendar.google.com'), 'calendar IDs never reach the page');
});

// ---------------------------------------------------------------- weather & config

test('weather parsing', () => {
  const times = [...Array(48)].map((_, i) => `2026-10-${22 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
  const n = times.length;
  const data = {
    hourly: { time: times, temperature_2m: Array(n).fill(10.4), precipitation_probability: Array(n).fill(30), precipitation: Array(n).fill(0.1), wind_speed_10m: Array(n).fill(18.2), wind_direction_10m: Array(n).fill(225), weather_code: Array(n).fill(61) },
    daily: { time: ['2026-10-22', '2026-10-23', '2026-10-24'], weather_code: [2, 61, 3], temperature_2m_max: [13.2, 12, 11], temperature_2m_min: [7.6, 7, 6], precipitation_probability_max: [40, 80, 40], precipitation_sum: [2, 6, 1] },
  };
  const wx = parseWeather(data, new Date('2026-10-22T05:42:00Z'), 'Europe/Amsterdam');
  assert.equal(wx.hours.length, 13);
  assert.equal(wx.hours[0].time, '2026-10-22T07:00');
  assert.equal(wx.hours[0].label, 'Now');
  assert.equal(wx.hours[1].label, '08');
  assert.deepEqual([wx.today.max, wx.today.min], [13, 8]);
  assert.deepEqual(wx.next.map((d) => d.kind), ['rain', 'cloud']);
  assert.equal(weatherKind(0), 'sun');
});

test('config: problems are reported, not thrown', () => {
  assert.deepEqual(loadConfig(undefined).problems, ['WHATSUP_CONFIG secret is not set yet']);
  assert.deepEqual(loadConfig('{bad').problems, ['WHATSUP_CONFIG is not valid JSON']);
  const { config, problems } = loadConfig(JSON.stringify({
    location: { timezone: 'Mars/Base' },
    calendars: [{ name: 'X', calendar_id: 'PASTE-HERE' }],
    cameras: [{ name: 'Cam', youtube_video_id: 'abcdefghijk' }, { name: 'Bad', youtube_video_id: 'x' }, { name: 'Empty' }],
  }));
  assert.equal(config.location.timezone, 'Europe/Amsterdam');
  assert.equal(config.calendars.length, 0);
  assert.deepEqual(config.cameras.map((c) => c.name), ['Cam']);
  assert.equal(problems.length, 3);
});

// ---------------------------------------------------------------- whole worker

test('worker: locked without Access settings, serves settings without secrets when signed in', async () => {
  _resetAccessCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = certsFetch;
  try {
    const assets = { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) };
    const secrets = {
      WHATSUP_CONFIG: JSON.stringify({ calendars: [{ name: 'Family', calendar_id: 'secret-family-id@group.calendar.google.com' }] }),
      GOOGLE_SERVICE_ACCOUNT: JSON.stringify(SA),
      ASSETS: assets,
    };
    let res = await worker.fetch(new Request('https://x.workers.dev/'), secrets);
    assert.equal(res.status, 503);

    const token = await signJwt(accessKeys.privateKey, { alg: 'RS256', kid: 'k1' }, { ...goodPayload, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
    const fullEnv = { ...secrets, ...env };
    res = await worker.fetch(new Request('https://x.workers.dev/'), fullEnv);
    assert.equal(res.status, 403, 'no token → refused');

    const signed = (path) => new Request(`https://x.workers.dev${path}`, { headers: { 'Cf-Access-Jwt-Assertion': token } });
    res = await worker.fetch(signed('/'), fullEnv);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);

    res = await worker.fetch(signed('/api/settings'), fullEnv);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!body.includes('secret-family-id'), 'calendar id not exposed');
    assert.ok(!body.includes('PRIVATE KEY'), 'key not exposed');
    assert.equal(JSON.parse(body).mode, 'cloud');

    res = await worker.fetch(new Request('https://x.workers.dev/api/data', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token } }), fullEnv);
    assert.equal(res.status, 405);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getData keeps going when weather fails and reports a missing service account', async () => {
  const failing = async () => new Response('down', { status: 500 });
  const data = await getData({ WHATSUP_CONFIG: JSON.stringify({ calendars: [{ name: 'F', calendar_id: 'f@x' }] }) }, new Date('2026-10-22T05:42:00Z'), failing);
  assert.equal(data.weather, null);
  assert.match(data.weather_error, /weather HTTP 500/);
  assert.match(data.calendar_error, /GOOGLE_SERVICE_ACCOUNT/);
  assert.equal(data.calendars_configured, true);
});

// Run with: npm test   (from the cloud/ folder)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  seal, unseal, secretOk, readCookie, SESSION_COOKIE, OAUTH_COOKIE,
} from '../src/session.js';
import {
  buildAuthUrl, exchangeCode, accessTokenFor, SignInError, _resetOAuthCache,
} from '../src/oauth.js';
import {
  fetchCalendars, listVisibleCalendars, eventToItem, midnightIn, dayKeyIn, CalendarAuthError,
} from '../src/google.js';
import { parseWeather, weatherKind } from '../src/weather.js';
import { loadConfig } from '../src/config.js';
import { _resetDataCache } from '../src/data.js';
import worker from '../src/index.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeIdToken = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const nowSec = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- session cookies

test('sealed cookies round-trip, and reject tampering, wrong purpose and expiry', async () => {
  assert.ok(secretOk(SECRET));
  assert.ok(!secretOk('short'));
  const v = await seal(SECRET, 'session', { email: 'a@b.com', exp: nowSec() + 60 });
  assert.equal((await unseal(SECRET, 'session', v)).email, 'a@b.com');
  assert.equal(await unseal(SECRET, 'oauth', v), null, 'cookie for one purpose is useless for another');
  assert.equal(await unseal('another-secret-another-secret-another-1', 'session', v), null);
  const flipped = v.slice(0, -2) + (v.slice(-2) === 'AA' ? 'AB' : 'AA');
  assert.equal(await unseal(SECRET, 'session', flipped), null);
  const old = await seal(SECRET, 'session', { email: 'a@b.com', exp: nowSec() - 1 });
  assert.equal(await unseal(SECRET, 'session', old), null);
  assert.equal(await unseal(SECRET, 'session', 'garbage!!'), null);
});

// ---------------------------------------------------------------- oauth

test('auth URL asks only for email + read-only calendar, offline, with PKCE', () => {
  const u = new URL(buildAuthUrl({ clientId: CLIENT_ID, redirectUri: 'https://x.dev/auth/callback', state: 's', codeChallenge: 'c' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/calendar.readonly');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 's');
});

function tokenEndpoint(overrides = {}) {
  return async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const p = new URLSearchParams(init.body);
    assert.equal(p.get('grant_type'), 'authorization_code');
    assert.equal(p.get('code_verifier'), 'verifier');
    return new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt', expires_in: 3600,
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly',
      id_token: fakeIdToken({ aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: nowSec() + 3600, email: 'Parent@Gmail.com', email_verified: true, ...overrides.claims }),
      ...overrides.body,
    }));
  };
}
const exArgs = { code: 'c', codeVerifier: 'verifier', clientId: CLIENT_ID, clientSecret: 's', redirectUri: 'https://x.dev/auth/callback' };

test('code exchange checks audience, issuer, verified email, scope and refresh token', async () => {
  const ok = await exchangeCode(exArgs, tokenEndpoint());
  assert.deepEqual([ok.email, ok.refreshToken], ['parent@gmail.com', 'rt']);
  const bad = [
    [{ claims: { aud: 'someone-else' } }, 'failed'],
    [{ claims: { iss: 'https://evil.example' } }, 'failed'],
    [{ claims: { email_verified: false } }, 'failed'],
    [{ claims: { exp: nowSec() - 3600 } }, 'failed'],
    [{ body: { scope: 'openid email' } }, 'no_calendar'],
    [{ body: { refresh_token: undefined } }, 'failed'],
  ];
  for (const [o, code] of bad) {
    await assert.rejects(exchangeCode(exArgs, tokenEndpoint(o)), (e) => e instanceof SignInError && e.code === code, JSON.stringify(o));
  }
});

test('access tokens are reused; revoked sign-in becomes SignInError(expired)', async () => {
  _resetOAuthCache();
  let calls = 0;
  const ok = async (url, init) => {
    calls++;
    assert.equal(new URLSearchParams(init.body).get('grant_type'), 'refresh_token');
    return new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }));
  };
  assert.equal(await accessTokenFor('rt1', { clientId: 'c', clientSecret: 's' }, ok), 'fresh');
  assert.equal(await accessTokenFor('rt1', { clientId: 'c', clientSecret: 's' }, ok), 'fresh');
  assert.equal(calls, 1);
  const revoked = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  await assert.rejects(accessTokenFor('rt2', { clientId: 'c', clientSecret: 's' }, revoked), (e) => e.code === 'expired');
});

// ---------------------------------------------------------------- calendar

test('DST-safe midnight and day keys', () => {
  assert.equal(midnightIn('2026-10-25', 'Europe/Amsterdam').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(midnightIn('2026-10-26', 'Europe/Amsterdam').toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(midnightIn('2027-03-28', 'Europe/Amsterdam').toISOString(), '2027-03-27T23:00:00.000Z');
  assert.equal(dayKeyIn(new Date('2026-10-22T22:30:00Z'), 'Europe/Amsterdam'), '2026-10-23');
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
  const hidden = eventToItem({ summary: 'Party', start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T10:00:00+02:00' } }, { ...cal, show_details: false }, tz);
  assert.equal(hidden.title, 'Busy');
  const allDay = eventToItem({ summary: 'Trip', start: { date: '2026-10-22' }, end: { date: '2026-10-24' } }, cal, tz);
  assert.deepEqual(allDay.days, ['2026-10-22', '2026-10-23']);
  assert.equal(eventToItem({ status: 'cancelled', start: { date: '2026-10-22' } }, cal, tz), null);
  assert.equal(eventToItem({ eventType: 'workingLocation', start: { date: '2026-10-22' } }, cal, tz), null);
  const overnight = eventToItem({ summary: 'Flight', start: { dateTime: '2026-10-22T23:00:00+02:00' }, end: { dateTime: '2026-10-23T02:00:00+02:00' } }, cal, tz);
  assert.deepEqual(overnight.days, ['2026-10-22', '2026-10-23']);
});

function calendarApi(eventsByCal, calls = []) {
  return async (url, init = {}) => {
    calls.push(url);
    const m = url.match(/calendars\/([^/]+)\/events\?(.*)$/);
    assert.ok(m, url);
    if (init.headers.Authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
    const id = decodeURIComponent(m[1]);
    const qs = new URLSearchParams(m[2]);
    assert.equal(qs.get('singleEvents'), 'true');
    if (!(id in eventsByCal)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ items: eventsByCal[id] }));
  };
}

test('fetchCalendars merges calendars, splits today/tomorrow, reports unknown calendars', async () => {
  const config = loadConfig(JSON.stringify({
    allowed_emails: ['parent@gmail.com'],
    calendars: [
      { name: 'Mine', calendar_id: 'primary', color: '#6AA9FF' },
      { name: 'Kids', calendar_id: 'kids@group.calendar.google.com', color: '#5ED39A' },
      { name: 'Missing', calendar_id: 'missing@group.calendar.google.com' },
    ],
  })).config;
  const fetchImpl = calendarApi({
    primary: [
      { id: 'a', summary: 'Dinner', start: { dateTime: '2026-10-22T18:30:00+02:00' }, end: { dateTime: '2026-10-22T19:30:00+02:00' } },
      { id: 'b', summary: 'Birthday', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
      { id: 'c', summary: 'School trip', start: { dateTime: '2026-10-23T08:00:00+02:00' }, end: { dateTime: '2026-10-23T15:00:00+02:00' } },
    ],
    'kids@group.calendar.google.com': [
      { id: 'd', summary: 'Swimming', start: { dateTime: '2026-10-22T15:30:00+02:00' }, end: { dateTime: '2026-10-22T16:30:00+02:00' } },
    ],
  });
  const res = await fetchCalendars(config, 'tok', new Date('2026-10-22T05:42:00Z'), fetchImpl);
  assert.deepEqual(res.today.map((e) => e.title), ['Birthday', 'Swimming', 'Dinner']);
  assert.deepEqual(res.tomorrow.map((e) => e.title), ['School trip']);
  assert.deepEqual(res.errors, ['Missing: not found in your Google account (check the calendar ID)']);
  assert.ok(!JSON.stringify(res).includes('group.calendar.google.com'), 'calendar IDs never reach the page');
  await assert.rejects(fetchCalendars(config, 'bad-token', new Date(), fetchImpl), CalendarAuthError);
});

test('auto mode: shows every ticked calendar except hidden ones, Busy where asked, no duplicates', async () => {
  const config = loadConfig(JSON.stringify({
    allowed_emails: ['parent@gmail.com'],
    hide_calendars: ['Work'],
    busy_calendars: ['partner@gmail.com'],
  })).config;
  const list = {
    items: [
      { id: 'school@import.calendar.google.com', summary: 'ISG school calendar', backgroundColor: '#9fe1e7', selected: true },
      { id: 'parent@gmail.com', summary: 'parent@gmail.com', backgroundColor: '#ac725e', selected: true, primary: true },
      { id: 'work@company.com', summary: 'Work', selected: true },
      { id: 'partner@gmail.com', summary: 'Partner', selected: true },
      { id: 'unticked@group.calendar.google.com', summary: 'Old club', selected: false },
      { id: 'hidden@group.calendar.google.com', summary: 'Hidden', selected: true, hidden: true },
      { id: 'nl#holiday@group.v.calendar.google.com', summary: 'Holidays in the Netherlands', backgroundColor: 'not-a-colour', selected: true },
    ],
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (url.includes('/users/me/calendarList')) return new Response(JSON.stringify(list));
    const id = decodeURIComponent(url.match(/calendars\/([^/]+)\/events/)[1]);
    const school = { id: 'x1', iCalUID: 'trip-uid', summary: 'School trip', start: { dateTime: '2026-10-22T09:00:00+02:00' }, end: { dateTime: '2026-10-22T15:00:00+02:00' } };
    const byId = {
      'school@import.calendar.google.com': [school],
      'parent@gmail.com': [{ ...school, id: 'x2' }, { id: 'p1', summary: 'Dentist', start: { dateTime: '2026-10-22T16:00:00+02:00' }, end: { dateTime: '2026-10-22T17:00:00+02:00' } }],
      'partner@gmail.com': [{ id: 'q1', summary: 'Secret plans', start: { dateTime: '2026-10-22T18:00:00+02:00' }, end: { dateTime: '2026-10-22T19:00:00+02:00' } }],
      'nl#holiday@group.v.calendar.google.com': [],
    };
    assert.ok(id in byId, `should not read ${id}`);
    return new Response(JSON.stringify({ items: byId[id] }));
  };
  const cals = await listVisibleCalendars(config, 'tok', fetchImpl);
  assert.deepEqual(cals.map((c) => c.name), ['My calendar', 'ISG school calendar', 'Partner', 'Holidays in the Netherlands']);
  assert.equal(cals[1].color, '#9fe1e7');
  assert.match(cals[3].color, /^#[0-9A-F]{6}$/i);
  const res = await fetchCalendars({ ...config, calendars: cals }, 'tok', new Date('2026-10-22T05:42:00Z'), fetchImpl);
  assert.deepEqual(res.today.map((e) => e.title), ['School trip', 'Dentist', 'Busy']);
  assert.ok(!calls.some((u) => u.includes('work%40company.com')), 'hidden calendar never read');
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
  assert.deepEqual([wx.today.max, wx.today.min], [13, 8]);
  assert.equal(weatherKind(0), 'sun');
});

test('config: allow-list required, defaults to all ticked calendars, problems reported not thrown', () => {
  assert.deepEqual(loadConfig(undefined).problems, ['WHATSUP_CONFIG secret is not set yet']);
  const minimal = loadConfig(JSON.stringify({ allowed_emails: ['Parent@Gmail.com'] }));
  assert.deepEqual(minimal.problems, []);
  assert.deepEqual(minimal.config.allowed_emails, ['parent@gmail.com']);
  assert.equal(minimal.config.calendar_mode, 'auto');
  assert.equal(loadConfig(JSON.stringify({ allowed_emails: ['a@b.co'], calendars: 'all' })).config.calendar_mode, 'auto');
  const listed = loadConfig(JSON.stringify({ allowed_emails: ['a@b.co'], calendars: [{ name: 'Work', calendar_id: 'w@x' }], busy_calendars: ['work'] }));
  assert.equal(listed.config.calendar_mode, 'list');
  assert.equal(listed.config.calendars[0].show_details, false);
  const noList = loadConfig(JSON.stringify({}));
  assert.ok(noList.problems.some((p) => p.includes('allowed_emails')));
  assert.deepEqual(noList.config.allowed_emails, []);
  const bad = loadConfig(JSON.stringify({ allowed_emails: ['not-an-email'], cameras: [{ youtube_video_id: 'x' }] }));
  assert.equal(bad.problems.length, 3); // invalid email, then empty list, invalid camera
});

// ---------------------------------------------------------------- whole worker: sign-in flow

const ASSET_PAGES = {
  '/index.html': '<html><body>DASHBOARD</body></html>',
  '/signin.html': '<html><body>SIGN IN</body></html>',
  '/styles.css': 'body{}',
};
const assets = { fetch: async (req) => {
  const p = new URL(req.url).pathname;
  return p in ASSET_PAGES ? new Response(ASSET_PAGES[p], { headers: { 'Content-Type': 'text/html' } }) : new Response('nf', { status: 404 });
} };

const ENV = {
  ASSETS: assets,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: SECRET,
  WHATSUP_CONFIG: JSON.stringify({ allowed_emails: ['parent@gmail.com'], calendars: [{ name: 'Mine', calendar_id: 'primary' }] }),
};
const ORIGIN = 'https://whatsup.family.workers.dev';

function cookiesFrom(res) {
  const out = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

function googleMock({ email = 'parent@gmail.com', calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push(String(url));
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        return new Response(JSON.stringify({
          access_token: 'tok', refresh_token: `rt-${email}`, expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
          id_token: fakeIdToken({ aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: nowSec() + 3600, email, email_verified: true }),
        }));
      }
      if (p.get('refresh_token') === 'rt-revoked') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('');
    if (String(url).startsWith('https://www.googleapis.com/calendar/v3/')) {
      return new Response(JSON.stringify({ items: [{ id: '1', summary: 'Swimming', start: { dateTime: new Date(Date.now() + 3600e3).toISOString() }, end: { dateTime: new Date(Date.now() + 7200e3).toISOString() } }] }));
    }
    if (String(url).startsWith('https://api.open-meteo.com/')) return new Response('down', { status: 503 });
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function signIn(email = 'parent@gmail.com', calls = []) {
  return withFetch(googleMock({ email, calls }), async () => {
    const login = await worker.fetch(new Request(`${ORIGIN}/login`), ENV);
    assert.equal(login.status, 302);
    const to = new URL(login.headers.get('Location'));
    assert.equal(to.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
    const oauth = cookiesFrom(login)[OAUTH_COOKIE];
    assert.ok(oauth);
    const cb = await worker.fetch(new Request(`${ORIGIN}/auth/callback?code=abc&state=${to.searchParams.get('state')}`, {
      headers: { Cookie: `${OAUTH_COOKIE}=${oauth}` },
    }), ENV);
    return cb;
  });
}

test('worker: not set up → sign-in page, /login refuses, status lists what is missing', async () => {
  const bare = { ASSETS: assets };
  let res = await worker.fetch(new Request(`${ORIGIN}/`), bare);
  assert.equal(await res.text(), ASSET_PAGES['/signin.html']);
  res = await worker.fetch(new Request(`${ORIGIN}/login`), bare);
  assert.equal(res.status, 503);
  res = await worker.fetch(new Request(`${ORIGIN}/api/status`), bare);
  const st = await res.json();
  assert.equal(st.ready, false);
  assert.ok(st.missing.includes('GOOGLE_CLIENT_ID'));
  res = await worker.fetch(new Request(`${ORIGIN}/api/data`), bare);
  assert.equal(res.status, 401);
});

test('worker: full Google sign-in, dashboard, data, and sign-out', async () => {
  _resetOAuthCache();
  _resetDataCache();
  const calls = [];
  const cb = await signIn('Parent@gmail.com', calls);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('Location'), '/');
  const setCookies = cb.headers.getSetCookie().join('\n');
  assert.match(setCookies, /__Host-whatsup=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000/);
  const session = cookiesFrom(cb)[SESSION_COOKIE];
  const headers = { Cookie: `${SESSION_COOKIE}=${session}` };

  let res = await worker.fetch(new Request(`${ORIGIN}/`, { headers }), ENV);
  assert.equal(await res.text(), ASSET_PAGES['/index.html']);
  assert.equal(res.headers.get('X-Whatsup-Page'), 'dashboard');
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);

  res = await worker.fetch(new Request(`${ORIGIN}/api/settings`, { headers }), ENV);
  const settings = await res.json();
  assert.equal(settings.signed_in_as, 'parent@gmail.com');
  assert.ok(!JSON.stringify(settings).includes('rt-'), 'refresh token never reaches the page');

  res = await withFetch(googleMock({ calls }), () => worker.fetch(new Request(`${ORIGIN}/api/data`, { headers }), ENV));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.calendar.today[0].title, 'Swimming');
  assert.match(data.weather_error, /weather HTTP 503/);
  assert.equal(calls.filter((u) => u.endsWith('/token')).length, 1, 'access token from sign-in reused');

  // sign-out from another site is refused
  res = await worker.fetch(new Request(`${ORIGIN}/logout`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } }), ENV);
  assert.equal(res.status, 403);
  res = await withFetch(googleMock({ calls }), () => worker.fetch(new Request(`${ORIGIN}/logout`, { method: 'POST', headers: { ...headers, Origin: ORIGIN } }), ENV));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Set-Cookie'), /__Host-whatsup=; .*Max-Age=0/);
  assert.ok(!calls.includes('https://oauth2.googleapis.com/revoke'), 'sign-out is per device: other devices stay signed in');
});

test('worker: Google rejecting a cached token gets one fresh token; a revoked grant signs you out', async () => {
  _resetDataCache();
  _resetOAuthCache();
  // 1) cached token stale but grant fine → recovers with a fresh token
  let rejectOnce = true;
  const calls = [];
  const flaky = async (url, init = {}) => {
    calls.push(String(url));
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    if (String(url).startsWith('https://www.googleapis.com/calendar/v3/')) {
      if (rejectOnce) { rejectOnce = false; return new Response('{}', { status: 401 }); }
      return new Response(JSON.stringify({ items: [] }));
    }
    return new Response('down', { status: 503 });
  };
  const good = await seal(SECRET, 'session', { email: 'parent@gmail.com', rt: 'rt-ok', exp: nowSec() + 3600 });
  let res = await withFetch(flaky, () => worker.fetch(new Request(`${ORIGIN}/api/data`, { headers: { Cookie: `${SESSION_COOKIE}=${good}` } }), ENV));
  assert.equal(res.status, 200);
  assert.equal(calls.filter((u) => u.endsWith('/token')).length, 2);

  // 2) Calendar API keeps rejecting and the grant is revoked → 401 + cookie cleared (not a 500)
  _resetDataCache();
  _resetOAuthCache();
  const revoked = async (url, init = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const first = !revoked.done; revoked.done = true;
      return first ? new Response(JSON.stringify({ access_token: 'old', expires_in: 3600 }))
        : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    if (String(url).startsWith('https://www.googleapis.com/calendar/v3/')) return new Response('{}', { status: 401 });
    return new Response('down', { status: 503 });
  };
  res = await withFetch(revoked, () => worker.fetch(new Request(`${ORIGIN}/api/data`, { headers: { Cookie: `${SESSION_COOKIE}=${good}` } }), ENV));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, 'expired');
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('worker: accounts not on the list are turned away and their access revoked', async () => {
  const calls = [];
  const cb = await signIn('stranger@gmail.com', calls);
  assert.equal(cb.headers.get('Location'), '/?error=not_allowed');
  assert.equal(cookiesFrom(cb)[SESSION_COOKIE], undefined);
  assert.ok(calls.includes('https://oauth2.googleapis.com/revoke'));
});

test('worker: callback without matching state or cookie is refused', async () => {
  const res = await withFetch(googleMock(), () => worker.fetch(new Request(`${ORIGIN}/auth/callback?code=abc&state=forged`), ENV));
  assert.equal(res.headers.get('Location'), '/?error=failed');
  const denied = await worker.fetch(new Request(`${ORIGIN}/auth/callback?error=access_denied`), ENV);
  assert.equal(denied.headers.get('Location'), '/?error=denied');
});

test('worker: forged cookie, removed account and revoked Google access all sign you out', async () => {
  let res = await worker.fetch(new Request(`${ORIGIN}/api/data`, { headers: { Cookie: `${SESSION_COOKIE}=forged` } }), ENV);
  assert.equal(res.status, 401);

  const removed = await seal(SECRET, 'session', { email: 'ex@gmail.com', rt: 'rt-x', exp: nowSec() + 3600 });
  res = await worker.fetch(new Request(`${ORIGIN}/`, { headers: { Cookie: `${SESSION_COOKIE}=${removed}` } }), ENV);
  assert.equal(await res.text(), ASSET_PAGES['/signin.html']);

  _resetDataCache();
  _resetOAuthCache();
  const revoked = await seal(SECRET, 'session', { email: 'parent@gmail.com', rt: 'rt-revoked', exp: nowSec() + 3600 });
  res = await withFetch(googleMock(), () => worker.fetch(new Request(`${ORIGIN}/api/data`, { headers: { Cookie: `${SESSION_COOKIE}=${revoked}` } }), ENV));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, 'expired');
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('worker: only GET/HEAD (and POST /logout) allowed; /signin.html redirects to /', async () => {
  let res = await worker.fetch(new Request(`${ORIGIN}/api/data`, { method: 'POST' }), ENV);
  assert.equal(res.status, 405);
  res = await worker.fetch(new Request(`${ORIGIN}/signin.html`), ENV);
  assert.equal(res.headers.get('Location'), '/');
  assert.equal(readCookie(new Request(ORIGIN, { headers: { Cookie: 'a=1; __Host-whatsup=xyz' } }), SESSION_COOKIE), 'xyz');
});

// TEST-ONLY Worker. Runs the real dashboard Worker inside workerd (Cloudflare's
// runtime) with fake Google and weather services, so crypto, cookies, dates
// and routing are checked in the same runtime as production.
//
//   npm run test:runtime        (starts it, runs GET /__selftest, stops)
//
// Never deploy this: it signs people in without Google.
import worker from '../../src/index.js';
import { seal, SESSION_COOKIE, OAUTH_COOKIE } from '../../src/session.js';

const tz = 'Europe/Amsterdam';
const CLIENT_ID = 'probe-client.apps.googleusercontent.com';
const SECRET = 'probe-secret-probe-secret-probe-secret-99';
const calls = { token: 0, refresh: 0, events: 0, weather: 0, revoke: 0 };

const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const keyIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayStr = (offset) => keyIn(new Date(Date.now() + offset * 86400e3));
function at(offset, hh, mm) {
  const day = dayStr(offset);
  const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(`${day}T12:00:00Z`));
  const off = Number(local) - 12;
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${off >= 0 ? '+' : '-'}${String(Math.abs(off)).padStart(2, '0')}:00`;
}

async function fakeNetwork(input, init = {}) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(await request.text());
    if (p.get('grant_type') === 'authorization_code') {
      calls.token++;
      if (p.get('client_secret') !== 'probe-client-secret' || !p.get('code_verifier')) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({
        access_token: 'tok', refresh_token: 'rt-parent', expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly',
        id_token: `${b64({ alg: 'RS256' })}.${b64({ aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, email: 'parent@gmail.com', email_verified: true })}.sig`,
      }));
    }
    calls.refresh++;
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
  }
  if (url.href === 'https://oauth2.googleapis.com/revoke') {
    calls.revoke++;
    return new Response('');
  }
  if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/users/me/calendarList')) {
    if (request.headers.get('Authorization') !== 'Bearer tok') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ items: [
      { id: 'family-secret-id@group.calendar.google.com', summary: 'Family', backgroundColor: '#6AA9FF', selected: true },
      { id: 'work-secret@company.com', summary: 'Work', selected: true },
    ] }));
  }
  if (url.hostname === 'www.googleapis.com') {
    calls.events++;
    if (request.headers.get('Authorization') !== 'Bearer tok') return new Response('{}', { status: 401 });
    if (url.pathname.includes('work-secret')) return new Response('{"error":"hidden calendar was read"}', { status: 500 });
    return new Response(JSON.stringify({
      items: [
        { id: '1', summary: 'Birthday (sample)', start: { date: dayStr(0) }, end: { date: dayStr(1) } },
        { id: '2', summary: 'School drop-off', start: { dateTime: at(0, 7, 45) }, end: { dateTime: at(0, 8, 15) } },
        { id: '3', summary: 'Dentist', visibility: 'private', start: { dateTime: at(0, 9, 0) }, end: { dateTime: at(0, 10, 0) } },
        { id: '4', summary: 'Swimming', start: { dateTime: at(0, 15, 30) }, end: { dateTime: at(0, 16, 30) } },
        { id: '5', summary: 'Family dinner', start: { dateTime: at(0, 18, 30) }, end: { dateTime: at(0, 19, 30) } },
        { id: '6', summary: 'School trip', start: { dateTime: at(1, 8, 0) }, end: { dateTime: at(1, 15, 0) } },
      ],
    }));
  }
  if (url.hostname === 'api.open-meteo.com') {
    calls.weather++;
    const times = [];
    for (let d = 0; d < 4; d++) for (let h = 0; h < 24; h++) times.push(`${dayStr(d)}T${String(h).padStart(2, '0')}:00`);
    const hr = (i) => i % 24;
    return new Response(JSON.stringify({
      hourly: {
        time: times,
        temperature_2m: times.map((_, i) => 8.5 + 4.5 * Math.max(0, Math.sin(((hr(i) - 7) / 14) * Math.PI))),
        precipitation_probability: times.map((_, i) => (hr(i) >= 12 && hr(i) <= 17 ? 20 + (hr(i) - 12) * 5 : 5)),
        precipitation: times.map(() => 0.1),
        wind_speed_10m: times.map((_, i) => 12 + hr(i) / 2.5),
        wind_direction_10m: times.map(() => 225),
        weather_code: times.map(() => 2),
      },
      daily: {
        time: [0, 1, 2, 3].map(dayStr), weather_code: [2, 61, 3, 1], temperature_2m_max: [13, 12, 11, 12],
        temperature_2m_min: [8, 7, 6, 5], precipitation_probability_max: [40, 80, 40, 10], precipitation_sum: [2, 6, 1, 0],
      },
    }));
  }
  return new Response('blocked in probe', { status: 599 });
}

function envFor(baseEnv, overrides = {}) {
  return {
    ASSETS: baseEnv.ASSETS,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'probe-client-secret',
    SESSION_SECRET: SECRET,
    WHATSUP_CONFIG: JSON.stringify({
      allowed_emails: ['parent@gmail.com'],
      location: { name: 'Groningen', latitude: 53.2194, longitude: 6.5665, timezone: tz },
      hide_calendars: ['Work'],   // calendars: left out = every ticked calendar
      cameras: [],
    }),
    ...overrides,
  };
}

const cookieValue = (res, name) => {
  for (const line of res.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.split(';')[0].slice(name.length + 1);
  }
  return null;
};

function check(results, name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? undefined : detail });
}

async function selftest(baseEnv) {
  const env = envFor(baseEnv);
  const results = [];
  const base = 'https://probe.example';
  const get = (path, headers = {}) => worker.fetch(new Request(`${base}${path}`, { headers }), env);

  let r = await get('/');
  let body = await r.text();
  check(results, 'signed-out visitor gets the sign-in page', r.status === 200 && body.includes('Sign in with Google') && r.headers.get('X-Whatsup-Page') === 'signin', r.status);
  r = await get('/api/data');
  check(results, 'data refused when signed out', r.status === 401, r.status);
  r = await worker.fetch(new Request(`${base}/login`), { ASSETS: baseEnv.ASSETS });
  check(results, 'sign-in refused until set up', r.status === 503, r.status);
  r = await worker.fetch(new Request(`${base}/api/status`), { ASSETS: baseEnv.ASSETS });
  check(results, 'status lists missing settings', (await r.json()).missing.length >= 3, 'status');

  r = await get('/login');
  const to = new URL(r.headers.get('Location'));
  const oauth = cookieValue(r, OAUTH_COOKIE);
  check(results, 'login redirects to Google with PKCE', r.status === 302 && to.hostname === 'accounts.google.com' && to.searchParams.get('code_challenge') && oauth, r.status);
  r = await get(`/auth/callback?code=abc&state=${to.searchParams.get('state')}`, { Cookie: `${OAUTH_COOKIE}=${oauth}` });
  const session = cookieValue(r, SESSION_COOKIE);
  check(results, 'callback signs in and sets an encrypted cookie', r.status === 302 && r.headers.get('Location') === '/' && session && !session.includes('parent'), r.headers.get('Location'));
  const auth = { Cookie: `${SESSION_COOKIE}=${session}` };

  r = await get('/', auth);
  body = await r.text();
  check(results, 'dashboard served when signed in', r.status === 200 && body.includes('id="stage"') && r.headers.get('X-Whatsup-Page') === 'dashboard', r.status);
  check(results, 'security headers present', (r.headers.get('Content-Security-Policy') || '').includes("frame-ancestors 'none'"), r.headers.get('Content-Security-Policy'));
  r = await get('/api/settings', auth);
  const settings = await r.json();
  check(results, 'settings ok', settings.mode === 'cloud' && settings.problems.length === 0 && settings.signed_in_as === 'parent@gmail.com', settings.problems);
  r = await get('/api/data', auth);
  const data = await r.json();
  check(results, 'calendar fetched', data.calendar_error === null && data.calendar, data.calendar_error);
  check(results, 'weather fetched', data.weather_error === null && data.weather && data.weather.hours.length === 13, data.weather_error);
  const titles = data.calendar ? data.calendar.today.map((e) => e.title) : [];
  check(results, 'today events in order, private as Busy',
    JSON.stringify(titles) === JSON.stringify(['Birthday (sample)', 'School drop-off', 'Busy', 'Swimming', 'Family dinner']), titles);
  const labels = data.calendar ? data.calendar.today.filter((e) => !e.all_day).map((e) => e.start_label) : [];
  check(results, 'local time labels', JSON.stringify(labels) === JSON.stringify(['07:45', '09:00', '15:30', '18:30']), labels);
  check(results, 'tokens and calendar ids never exposed', !/rt-parent|family-secret-id/.test(JSON.stringify(data) + JSON.stringify(settings)), 'leak');
  check(results, 'no extra Google token calls', calls.token === 1 && calls.refresh === 0, calls);
  r = await get('/manifest.webmanifest');
  check(results, 'app manifest served', r.status === 200 && (await r.json()).short_name === 'Whatsup', r.status);

  r = await worker.fetch(new Request(`${base}/logout`, { method: 'POST', headers: { ...auth, Origin: base } }), env);
  check(results, 'sign-out clears this device only', r.status === 200 && /Max-Age=0/.test(r.headers.get('Set-Cookie')) && calls.revoke === 0, calls);
  return { ok: results.every((x) => x.ok), results, calls };
}

export default {
  async fetch(request, baseEnv) {
    globalThis.fetch = fakeNetwork; // all outbound traffic goes to the fakes above
    const url = new URL(request.url);
    if (url.pathname === '/__selftest') {
      return new Response(JSON.stringify(await selftest(baseEnv), null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    // Browse locally as a signed-in parent (for screenshots): add a session cookie.
    const env = envFor(baseEnv);
    const headers = new Headers(request.headers);
    if (!url.searchParams.has('signedout')) {
      const s = await seal(SECRET, 'session', { email: 'parent@gmail.com', rt: 'rt-parent', exp: Math.floor(Date.now() / 1000) + 3600 });
      headers.set('Cookie', `${SESSION_COOKIE}=${s}`);
    }
    return worker.fetch(new Request(request, { headers }), env);
  },
};

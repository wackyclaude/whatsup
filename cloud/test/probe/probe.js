// TEST-ONLY Worker. Runs the real dashboard Worker inside workerd (Cloudflare's
// runtime) with fake Google, weather and Access services, so crypto, dates and
// routing are checked in the same runtime as production.
//
//   npm run test:runtime        (starts it, runs GET /__selftest, stops)
//
// Never deploy this: it signs its own Access tokens.
import worker from '../../src/index.js';

const enc = new TextEncoder();
const b64url = (buf) => {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const TEAM = 'https://family.cloudflareaccess.com';
const AUD = 'probe-aud';
const tz = 'Europe/Amsterdam';

let setup = null;
async function init() {
  if (setup) return setup;
  const gen = () => crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  const access = await gen();
  const sa = await gen();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', access.publicKey)), kid: 'kid1' };
  const pkcs8 = b64url(await crypto.subtle.exportKey('pkcs8', sa.privateKey)).replace(/-/g, '+').replace(/_/g, '/');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  setup = { access, sa, jwk, pem, calls: { certs: 0, token: 0, events: 0, weather: 0 } };
  return setup;
}

async function token() {
  const { access } = await init();
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid: 'kid1' })));
  const p = b64url(enc.encode(JSON.stringify({ aud: [AUD], iss: TEAM, exp: now + 3600, iat: now, email: 'parent@example.com' })));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', access.privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(s)}`;
}

const keyIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayStr = (offset) => keyIn(new Date(Date.now() + offset * 86400e3));
function at(offset, hh, mm) {
  // local wall-clock time in Amsterdam, as an ISO string with offset
  const day = dayStr(offset);
  const probe = new Date(`${day}T12:00:00Z`);
  const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(probe);
  const off = Number(local) - 12;
  const sign = off >= 0 ? '+' : '-';
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${sign}${String(Math.abs(off)).padStart(2, '0')}:00`;
}

async function fakeNetwork(input, init = {}) {
  const st = await init_();
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.href === `${TEAM}/cdn-cgi/access/certs`) {
    st.calls.certs++;
    return new Response(JSON.stringify({ keys: [st.jwk] }));
  }
  if (url.href === 'https://oauth2.googleapis.com/token') {
    st.calls.token++;
    const assertion = new URLSearchParams(await request.text()).get('assertion');
    const [h, p, s] = assertion.split('.');
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', st.sa.publicKey, sig, enc.encode(`${h}.${p}`));
    if (!ok) return new Response('bad signature', { status: 400 });
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
  }
  if (url.hostname === 'www.googleapis.com') {
    st.calls.events++;
    if (request.headers.get('Authorization') !== 'Bearer tok') return new Response('{}', { status: 401 });
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
    st.calls.weather++;
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
const init_ = init;

function envFor(baseEnv) {
  return {
    ASSETS: baseEnv.ASSETS,
    TEAM_DOMAIN: 'family',
    POLICY_AUD: AUD,
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ type: 'service_account', client_email: 'robot@family-dash.iam.gserviceaccount.com', private_key: setup.pem }),
    WHATSUP_CONFIG: JSON.stringify({
      location: { name: 'Groningen', latitude: 53.2194, longitude: 6.5665, timezone: tz },
      calendars: [{ name: 'Family', calendar_id: 'family-secret-id@group.calendar.google.com', color: '#6AA9FF' }],
      cameras: [],
    }),
  };
}

function check(results, name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? undefined : detail });
}

async function selftest(baseEnv) {
  await init();
  const env = envFor(baseEnv);
  const results = [];
  const t = await token();
  const call = (path, tok = t) => worker.fetch(new Request(`https://probe.example${path}`, { headers: tok ? { 'Cf-Access-Jwt-Assertion': tok } : {} }), env);

  let r = await call('/', null);
  check(results, 'unsigned request refused', r.status === 403, r.status);
  r = await worker.fetch(new Request('https://probe.example/'), { ASSETS: baseEnv.ASSETS });
  check(results, 'locked when Access not configured', r.status === 503, r.status);
  r = await call('/');
  const html = await r.text();
  check(results, 'page served when signed in', r.status === 200 && html.includes('<html'), r.status);
  check(results, 'security headers present', (r.headers.get('Content-Security-Policy') || '').includes("frame-ancestors 'none'"), r.headers.get('Content-Security-Policy'));
  r = await call('/api/settings');
  const settings = await r.json();
  check(results, 'settings ok', settings.mode === 'cloud' && settings.problems.length === 0, settings.problems);
  r = await call('/api/data');
  const data = await r.json();
  check(results, 'calendar fetched', data.calendar_error === null && data.calendar, data.calendar_error);
  check(results, 'weather fetched', data.weather_error === null && data.weather && data.weather.hours.length === 13, data.weather_error);
  const titles = data.calendar ? data.calendar.today.map((e) => e.title) : [];
  check(results, 'today events in order, private as Busy',
    JSON.stringify(titles) === JSON.stringify(['Birthday (sample)', 'School drop-off', 'Busy', 'Swimming', 'Family dinner']), titles);
  const labels = data.calendar ? data.calendar.today.filter((e) => !e.all_day).map((e) => e.start_label) : [];
  check(results, 'local time labels', JSON.stringify(labels) === JSON.stringify(['07:45', '09:00', '15:30', '18:30']), labels);
  check(results, 'tomorrow first event', data.calendar && data.calendar.tomorrow[0] && data.calendar.tomorrow[0].title === 'School trip', data.calendar && data.calendar.tomorrow);
  check(results, 'calendar id never exposed', !JSON.stringify(data).includes('family-secret-id') && !JSON.stringify(settings).includes('family-secret-id'), 'leak');
  await (await call('/api/data')).json();
  check(results, 'Google token reused', setup.calls.token === 1, setup.calls);
  return { ok: results.every((x) => x.ok), results, calls: setup.calls };
}

export default {
  async fetch(request, baseEnv) {
    await init();
    globalThis.fetch = fakeNetwork; // all outbound traffic goes to the fakes above
    const url = new URL(request.url);
    if (url.pathname === '/__selftest') {
      return new Response(JSON.stringify(await selftest(baseEnv), null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    // Browse the signed-in dashboard locally (for screenshots): inject a token.
    const headers = new Headers(request.headers);
    headers.set('Cf-Access-Jwt-Assertion', await token());
    return worker.fetch(new Request(request, { headers }), envFor(baseEnv));
  },
};

// Reads family calendars with the Google Calendar API, using a service
// account (a "robot" Google account) that you share calendars with,
// read-only. It can only see the calendars you explicitly share with it.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const enc = new TextEncoder();

let tokenCache = { email: null, token: null, expiresAt: 0 };

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (str) => b64url(enc.encode(str));

export function parseServiceAccount(raw) {
  let sa;
  try {
    sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT is not valid JSON — paste the whole key file');
  }
  if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT should be the JSON key file of a Google service account');
  }
  return sa;
}

async function importPrivateKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function getAccessToken(sa, fetchImpl = fetch, nowMs = Date.now()) {
  if (tokenCache.email === sa.client_email && tokenCache.token && nowMs < tokenCache.expiresAt - 120000) {
    return tokenCache.token;
  }
  const iat = Math.floor(nowMs / 1000);
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlStr(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  }));
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (HTTP ${res.status}) — check the service account key`);
  const body = await res.json();
  tokenCache = { email: sa.client_email, token: body.access_token, expiresAt: nowMs + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

export function _resetTokenCache() {
  tokenCache = { email: null, token: null, expiresAt: 0 };
}

// ------------------------------------------------------------------ dates

// "YYYY-MM-DD" for an instant, in a time zone
export function dayKeyIn(date, timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function hhmmIn(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

// UTC offset (minutes) of a time zone at an instant
function offsetMinutes(date, timeZone) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t) => Number(p.find((x) => x.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Instant of local midnight for a "YYYY-MM-DD" in a time zone
export function midnightIn(key, timeZone) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off1 = offsetMinutes(guess, timeZone);
  let t = guess.getTime() - off1 * 60000;
  const off2 = offsetMinutes(new Date(t), timeZone);
  if (off2 !== off1) t = guess.getTime() - off2 * 60000;
  return new Date(t);
}

export function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ events

const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (v, limit = 120) => String(v || '').replace(CONTROL, ' ').trim().slice(0, limit);

export function eventToItem(ev, cal, timeZone) {
  if (ev.status === 'cancelled') return null;
  if (ev.eventType === 'workingLocation') return null;
  const start = ev.start || {};
  const end = ev.end || {};
  const isPrivate = ev.visibility === 'private' || ev.visibility === 'confidential';
  const show = cal.show_details !== false && !isPrivate && !!ev.summary;
  const base = {
    title: show ? clean(ev.summary) : 'Busy',
    busy: !show,
    calendar: clean(cal.name, 40),
    color: cal.color,
  };

  if (start.date) {
    const s = start.date;
    const e = end.date && end.date > s ? end.date : addDaysKey(s, 1);
    const days = [];
    for (let k = s; k < e; k = addDaysKey(k, 1)) days.push(k);
    return { ...base, start: s, end: e, start_label: '', end_label: '', all_day: true, days };
  }
  if (!start.dateTime) return null;
  const s = new Date(start.dateTime);
  const e = end.dateTime ? new Date(end.dateTime) : s;
  const days = [];
  const last = dayKeyIn(new Date(Math.max(s.getTime(), e.getTime() - 1000)), timeZone);
  for (let k = dayKeyIn(s, timeZone); k <= last; k = addDaysKey(k, 1)) days.push(k);
  return {
    ...base,
    start: s.toISOString(),
    end: e.toISOString(),
    start_label: hhmmIn(s, timeZone),
    end_label: hhmmIn(e, timeZone),
    all_day: false,
    days,
  };
}

export async function fetchCalendars(config, sa, now, fetchImpl = fetch) {
  const tz = config.location.timezone;
  const today = dayKeyIn(now, tz);
  const timeMin = midnightIn(today, tz).toISOString();
  const timeMax = midnightIn(addDaysKey(today, 2), tz).toISOString();
  const token = await getAccessToken(sa, fetchImpl, now.getTime());

  const items = [];
  const errors = [];
  await Promise.all(config.calendars.map(async (cal) => {
    const qs = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: tz,
      fields: 'items(id,status,summary,start,end,visibility,eventType)',
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?${qs}`;
    try {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404 || res.status === 403) {
        errors.push(`${cal.name}: not shared with the dashboard's robot account yet`);
        return;
      }
      if (!res.ok) {
        errors.push(`${cal.name}: HTTP ${res.status}`);
        return;
      }
      const body = await res.json();
      for (const ev of body.items || []) {
        const item = eventToItem(ev, cal, tz);
        if (item) items.push({ ...item, _id: `${cal.calendar_id}/${ev.id}` });
      }
    } catch (e) {
      errors.push(`${cal.name}: network error`);
    }
  }));

  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.all_day === b.all_day ? a.title.localeCompare(b.title) : (a.all_day ? -1 : 1))));
  const byDay = {};
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it._id)) continue;
    seen.add(it._id);
    const { days, _id, ...rest } = it;
    for (const d of days) (byDay[d] = byDay[d] || []).push(rest);
  }
  return {
    today: byDay[today] || [],
    tomorrow: byDay[addDaysKey(today, 1)] || [],
    errors,
    day: today,
  };
}

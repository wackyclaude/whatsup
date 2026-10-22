// Reads calendars with the Google Calendar API, using the signed-in
// person's own Google access (read-only). The API expands repeating events
// for us and returns only today's and tomorrow's events.

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
// (In zones where clocks jump at midnight, the day starts at 01:00 — this
// returns the first instant that belongs to that day.)
export function midnightIn(key, timeZone) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off1 = offsetMinutes(guess, timeZone);
  let t = guess.getTime() - off1 * 60000;
  const off2 = offsetMinutes(new Date(t), timeZone);
  if (off2 !== off1) t = guess.getTime() - off2 * 60000;
  // Make sure we landed on the right local day, then step back while the
  // previous instants are still the same day.
  for (let i = 0; i < 4 && dayKeyIn(new Date(t), timeZone) < key; i++) t += 3600000;
  for (let i = 0; i < 4 && dayKeyIn(new Date(t - 3600000), timeZone) === key; i++) t -= 3600000;
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

export class CalendarAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export async function fetchCalendars(config, token, now, fetchImpl = fetch) {
  const tz = config.location.timezone;
  const today = dayKeyIn(now, tz);
  const timeMin = midnightIn(today, tz).toISOString();
  const timeMax = midnightIn(addDaysKey(today, 2), tz).toISOString();

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
      if (res.status === 401) throw new CalendarAuthError('token rejected');
      if (res.status === 404 || res.status === 403) {
        errors.push(`${cal.name}: not found in your Google account (check the calendar ID)`);
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
      if (e instanceof CalendarAuthError) throw e;
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

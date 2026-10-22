// Reads and checks the WHATSUP_CONFIG secret. Personal settings live only
// in Cloudflare (as an encrypted secret), never in the public repo.

const HEX = /^#[0-9A-Fa-f]{6}$/;
const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

export const DEFAULT_LOCATION = { name: 'Groningen', latitude: 53.2194, longitude: 6.5665, timezone: 'Europe/Amsterdam' };

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

/** Returns { config, problems: [] }. Never throws. */
export function loadConfig(raw) {
  const problems = [];
  let input = {};
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    problems.push('WHATSUP_CONFIG secret is not set yet');
  } else {
    try {
      input = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      problems.push('WHATSUP_CONFIG is not valid JSON');
      input = {};
    }
  }

  const loc = { ...DEFAULT_LOCATION, ...(input.location || {}) };
  loc.latitude = Number(loc.latitude);
  loc.longitude = Number(loc.longitude);
  if (!(Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180)) {
    problems.push('location latitude/longitude are not valid numbers');
    Object.assign(loc, { latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude });
  }
  if (!validTimeZone(loc.timezone)) {
    problems.push(`location.timezone "${loc.timezone}" is not a valid time zone`);
    loc.timezone = DEFAULT_LOCATION.timezone;
  }
  loc.name = String(loc.name || '').slice(0, 40);

  // Google accounts allowed to sign in. Empty = nobody (fail closed).
  const allowed = [];
  (Array.isArray(input.allowed_emails) ? input.allowed_emails : []).forEach((e) => {
    const v = String(e || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) allowed.push(v);
    else problems.push(`allowed_emails has an invalid address: "${String(e).slice(0, 60)}"`);
  });
  if (!allowed.length && !problems.some((p) => p.startsWith('WHATSUP_CONFIG'))) {
    problems.push('allowed_emails is empty — add your Google address');
  }

  // Calendars: leave out (or "all") = every calendar ticked in Google Calendar.
  const listOf = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : []);
  const hideCalendars = listOf(input.hide_calendars);
  const busyCalendars = listOf(input.busy_calendars);
  const calendarMode = Array.isArray(input.calendars) && input.calendars.length ? 'list' : 'auto';
  if (input.calendars !== undefined && input.calendars !== 'all' && calendarMode === 'auto' && !Array.isArray(input.calendars)) {
    problems.push('calendars should be "all" or a list');
  }
  const calendars = [];
  const calInput = calendarMode === 'list' ? input.calendars : [];
  calInput.forEach((c, i) => {
    const id = String((c && c.calendar_id) || '').trim();
    if (!id || id.includes('PASTE')) {
      problems.push(`calendars[${i}] has no calendar_id`);
      return;
    }
    calendars.push({
      name: String(c.name || `Calendar ${i + 1}`).slice(0, 40),
      calendar_id: id,
      color: HEX.test(String(c.color)) ? c.color : '#6AA9FF',
      show_details: c.show_details !== false
        && !busyCalendars.includes(id.toLowerCase())
        && !busyCalendars.includes(String(c.name || '').toLowerCase()),
    });
  });

  const cameras = [];
  (Array.isArray(input.cameras) ? input.cameras : []).forEach((c, i) => {
    const vid = String((c && c.youtube_video_id) || '').trim();
    const chan = String((c && c.youtube_channel_id) || '').trim();
    if (!vid && !chan) return;
    if ((vid && !YT_VIDEO.test(vid)) || (chan && !YT_CHANNEL.test(chan))) {
      problems.push(`cameras[${i}] has an invalid YouTube ID`);
      return;
    }
    cameras.push({
      name: String(c.name || 'Live camera').slice(0, 40),
      place: String(c.place || '').slice(0, 40),
      timezone: validTimeZone(c.timezone) ? c.timezone : 'Asia/Kolkata',
      youtube_video_id: vid,
      youtube_channel_id: chan,
    });
  });

  const system = (input.panchang && input.panchang.month_system) === 'amanta' ? 'amanta' : 'purnimanta';
  const rotate = Math.max(0, Math.min(240, Number(input.camera_rotate_minutes) || 0));
  const refresh = input.refresh_minutes || {};

  return {
    config: {
      allowed_emails: allowed,
      location: loc,
      calendar_mode: calendarMode,
      calendars,
      hide_calendars: hideCalendars,
      busy_calendars: busyCalendars,
      cameras,
      panchang: { month_system: system },
      camera_rotate_minutes: rotate,
      refresh_minutes: {
        calendar: Math.max(5, Number(refresh.calendar) || 15),
        weather: Math.max(15, Number(refresh.weather) || 30),
      },
    },
    problems,
  };
}

export function publicSettings(config, festivals, problems, version, email) {
  return {
    version,
    mode: 'cloud',
    signed_in_as: email || null,
    location: config.location,
    panchang: config.panchang,
    cameras: config.cameras,
    camera_rotate_minutes: config.camera_rotate_minutes,
    festivals,
    problems,
  };
}

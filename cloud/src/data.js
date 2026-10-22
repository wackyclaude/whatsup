// Fetches and caches calendar + weather for /api/data.
import { loadConfig } from './config.js';
import { fetchCalendars, parseServiceAccount, dayKeyIn } from './google.js';
import { fetchWeather } from './weather.js';

export const VERSION = '1.1.0';

// Best-effort memory cache (per Worker instance). The page keeps showing
// its last good data if a refresh fails, so a cold cache is harmless.
const memory = { calendar: null, weather: null };

async function refresh(kind, ttlMin, now, dayKey, loader) {
  const entry = memory[kind];
  const fresh = entry && entry.day === dayKey && now.getTime() - entry.at < ttlMin * 60000;
  if (fresh) return entry;
  try {
    const data = await loader();
    memory[kind] = { data, at: now.getTime(), day: dayKey, error: null };
  } catch (e) {
    const msg = String((e && e.message) || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 160);
    memory[kind] = entry && entry.day === dayKey
      ? { ...entry, error: msg }
      : { data: null, at: null, day: dayKey, error: msg };
  }
  return memory[kind];
}

export async function getData(env, now = new Date(), fetchImpl = fetch) {
  const { config } = loadConfig(env.WHATSUP_CONFIG);
  const tz = config.location.timezone;
  const day = dayKeyIn(now, tz);
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

  const tasks = [refresh('weather', config.refresh_minutes.weather, now, day, () => fetchWeather(config, now, fetchImpl))];
  let calendarsConfigured = config.calendars.length > 0;
  let saProblem = null;
  if (calendarsConfigured) {
    let sa = null;
    try {
      sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT);
    } catch (e) {
      saProblem = e.message;
    }
    if (sa) {
      tasks.push(refresh('calendar', config.refresh_minutes.calendar, now, day, () => fetchCalendars(config, sa, now, fetchImpl)));
    }
  }
  const [wx, cal] = await Promise.all(tasks);
  return {
    demo: false,
    calendars_configured: calendarsConfigured,
    calendar: cal ? cal.data : null,
    calendar_updated: cal ? iso(cal.at) : null,
    calendar_error: saProblem || (cal ? cal.error : null),
    weather: wx.data,
    weather_updated: iso(wx.at),
    weather_error: wx.error,
    server_time: now.toISOString(),
  };
}


// Fetches and caches calendar + weather for /api/data.
import { loadConfig } from './config.js';
import { fetchCalendars, listVisibleCalendars, dayKeyIn, CalendarAuthError } from './google.js';
import { fetchWeather } from './weather.js';
import { accessTokenFor, dropAccessToken, SignInError } from './oauth.js';
import { fetchNews } from './news.js';

export const VERSION = '2.2.0';

// Best-effort memory cache per Worker instance. The page keeps showing its
// last good data if a refresh fails, so a cold cache is harmless.
let weatherEntry = null;
const calendarEntries = new Map(); // per signed-in person

function safeMessage(e) {
  return String((e && e.message) || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 160);
}

async function refresh(entry, ttlMin, now, dayKey, loader) {
  const fresh = entry && entry.day === dayKey && now.getTime() - entry.at < ttlMin * 60000;
  if (fresh) return entry;
  try {
    return { data: await loader(), at: now.getTime(), day: dayKey, error: null };
  } catch (e) {
    if (e instanceof SignInError || e instanceof CalendarAuthError) throw e;
    const msg = safeMessage(e);
    return entry && entry.day === dayKey ? { ...entry, error: msg } : { data: null, at: null, day: dayKey, error: msg };
  }
}

/**
 * session = { email, rt } from the sign-in cookie.
 * Throws SignInError('expired') if Google no longer accepts the sign-in.
 */
export async function getData(env, session, now = new Date(), fetchImpl = fetch) {
  const { config } = loadConfig(env.WHATSUP_CONFIG);
  const tz = config.location.timezone;
  const day = dayKeyIn(now, tz);
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  const creds = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };

  const [wx, cal] = await Promise.all([
    refresh(weatherEntry, config.refresh_minutes.weather, now, day, () => fetchWeather(config, now, fetchImpl))
      .then((e) => { weatherEntry = e; return e; }),
    refresh(calendarEntries.get(session.email), config.refresh_minutes.calendar, now, day, async () => {
      const load = async (token) => {
        const cfg = config.calendar_mode === 'auto'
          ? { ...config, calendars: await listVisibleCalendars(config, token, fetchImpl) }
          : config;
        return fetchCalendars(cfg, token, now, fetchImpl);
      };
      const token = await accessTokenFor(session.rt, creds, fetchImpl, now.getTime());
      try {
        return await load(token);
      } catch (e) {
        if (!(e instanceof CalendarAuthError)) throw e;
        // Google rejected the cached access token: get a fresh one once.
        // If the sign-in itself was revoked, this throws SignInError('expired').
        dropAccessToken(session.rt);
        return load(await accessTokenFor(session.rt, creds, fetchImpl, now.getTime()));
      }
    }).then((e) => {
      if (calendarEntries.size > 20) calendarEntries.clear();
      calendarEntries.set(session.email, e);
      return e;
    }),
  ]);

  return {
    demo: false,
    calendars_configured: config.calendar_mode === 'auto' || config.calendars.length > 0,
    calendar: cal.data,
    calendar_updated: iso(cal.at),
    calendar_error: cal.error,
    weather: wx.data,
    weather_updated: iso(wx.at),
    weather_error: wx.error,
    server_time: now.toISOString(),
  };
}

export function forgetUser(email) {
  calendarEntries.delete(email);
}

export function _resetDataCache() {
  weatherEntry = null;
  calendarEntries.clear();
}

// Kids' news: shared by everyone, refreshed at most every 30 minutes.
let newsEntry = null;
export async function getNews(env, now = new Date(), fetchImpl = fetch) {
  const { config } = loadConfig(env.WHATSUP_CONFIG);
  if (!config.news.enabled) return { enabled: false, items: [] };
  const fresh = newsEntry && now.getTime() - newsEntry.at < 30 * 60000;
  if (!fresh) {
    try {
      const res = await fetchNews(config.news, fetchImpl);
      if (res.items.length || !newsEntry) newsEntry = { ...res, at: now.getTime() };
      else newsEntry = { ...newsEntry, errors: res.errors, at: now.getTime() };
    } catch (e) {
      newsEntry = newsEntry || { items: [], errors: ['news unavailable'], at: now.getTime() };
    }
  }
  return { enabled: true, items: newsEntry.items, errors: newsEntry.errors, updated: new Date(newsEntry.at).toISOString() };
}

export function _resetNewsCache() {
  newsEntry = null;
}

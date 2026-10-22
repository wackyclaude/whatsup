// Weather from Open-Meteo (free, no account). Same output shape as the
// local Python server, so the page works with either.

export function weatherKind(code) {
  if (code === null || code === undefined) return 'cloud';
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly';
  if ([3, 45, 48].includes(code)) return 'cloud';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return 'rain';
}

function localHourKey(now, timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:00`;
}

export function parseWeather(data, now, timeZone) {
  const h = data.hourly;
  const times = h.time;
  let first = times.indexOf(localHourKey(now, timeZone));
  if (first < 0) first = 0;
  const hours = [];
  for (let i = first; i < Math.min(first + 13, times.length); i++) {
    const t = h.temperature_2m[i];
    hours.push({
      time: times[i],
      label: i === first ? 'Now' : times[i].slice(11, 13),
      temp: t === null ? null : Math.round(t),
      rain: h.precipitation_probability[i] || 0,
      rain_mm: h.precipitation[i] || 0,
      wind: Math.round(h.wind_speed_10m[i] || 0),
      wind_dir: h.wind_direction_10m[i] || 0,
      kind: weatherKind(h.weather_code[i]),
    });
  }
  const d = data.daily;
  const days = [];
  for (let i = 0; i < Math.min(3, d.time.length); i++) {
    days.push({
      date: d.time[i],
      max: Math.round(d.temperature_2m_max[i]),
      min: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] || 0,
      rain_mm: d.precipitation_sum[i] || 0,
      kind: weatherKind(d.weather_code[i]),
    });
  }
  return { hours, today: days[0] || null, next: days.slice(1, 3) };
}

export async function fetchWeather(config, now, fetchImpl = fetch) {
  const loc = config.location;
  const qs = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    timezone: loc.timezone,
    forecast_days: '4',
    hourly: 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    wind_speed_unit: 'kmh',
  });
  const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${qs}`, {
    headers: { 'User-Agent': 'whatsup-family-dashboard' },
  });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  return parseWeather(await res.json(), now, loc.timezone);
}

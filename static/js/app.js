// Whatsup family dashboard — page logic.
// All text from calendars is inserted with textContent, never as HTML.

import * as Sky from './sky.js';
import * as Night from './night.js';
import * as SkyIcons from './sky-icons.js';
import { festivalsBetween, mergeFestivals } from './festivals.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const MODE = params.get('mode') === 'screensaver' ? 'screensaver' : 'app';
const DATA_REFRESH_MS = 2 * 60 * 1000;
const SKY_REFRESH_MS = 5 * 60 * 1000;
const NEWS_REFRESH_MS = 30 * 60 * 1000;

const state = { tab: 'sky', skyOpen: null, iss: null, sideCollapsed: readPref('whatsup-side-collapsed') === '1', settings: null, data: null, camIndex: 0, camRendered: null, dayKey: null, festivals: null, festivalsDay: null };

const $ = (id) => document.getElementById(id);

// Small per-device choices (like the hidden side column). Browser storage can
// be missing or blocked; the dashboard works the same without it.
function readPref(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* not saved, that's fine */ }
}

function setupSideToggle() {
  const set = (collapsed) => {
    state.sideCollapsed = collapsed;
    writePref('whatsup-side-collapsed', collapsed ? '1' : '0');
    fitStage();
  };
  $('side-close').addEventListener('click', () => set(true));
  $('side-open').addEventListener('click', () => set(false));
}
const isCloud = () => !!(state.settings && state.settings.mode === 'cloud');
const hm = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
const shortDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
const longDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ------------------------------------------------------------ stage scaling

// The dashboard is designed at 1440 x 900 (16:10, the family MacBook).
// On wider screens the stage grows sideways and a side column (tonight's
// sky, kids' news) fills the room that would otherwise be empty margins.
const BASE_W = 1440;
const BASE_H = 900;
const WIDE_MIN_W = 1736; // narrowest stage that has room for the side column

function fitStage() {
  const stage = $('stage');
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const wideScreen = aspect >= 1.7;
  const wide = wideScreen && !state.sideCollapsed;
  $('side-open').hidden = !(wideScreen && state.sideCollapsed);
  const w = wide ? Math.max(WIDE_MIN_W, Math.round(aspect * BASE_H)) : BASE_W;
  stage.classList.toggle('wide', wide);
  stage.style.width = `${w}px`;
  const wasHidden = $('side').hidden;
  $('side').hidden = !wide;

  const scale = Math.min(window.innerWidth / w, window.innerHeight / BASE_H);
  const left = (window.innerWidth - w * scale) / 2;
  const top = (window.innerHeight - BASE_H * scale) / 2;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  if (wide && wasHidden && state.settings) { // the side column just appeared
    renderTonight();
    loadNews();
    loadIss();
  }
}

// ------------------------------------------------------------ clock & header

function renderClock() {
  const now = new Date();
  $('clock').textContent = hm(now);
  renderWorld(now);
  $('date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (state.dayKey !== dayKey(now)) {
    state.dayKey = dayKey(now);
    renderSky();
    renderCalendar();
  }
}

function renderStatus() {
  const d = state.data;
  const status = $('status');
  $('demo-badge').hidden = !(d && d.demo);
  if (!d) {
    status.textContent = 'Starting…';
    return;
  }
  const stamps = [d.calendar_updated, d.weather_updated].filter(Boolean).map((s) => new Date(s));
  const errors = [d.calendar_error, d.weather_error].filter(Boolean);
  const problems = (state.settings && state.settings.problems) || [];
  if (problems.length) {
    status.className = 'status warn';
    status.textContent = `Settings: ${problems[0]}`;
    return;
  }
  const latest = stamps.length ? new Date(Math.max(...stamps)) : null;
  if (errors.length) {
    status.className = 'status warn';
    status.textContent = latest ? `Offline · showing data from ${hm(latest)}` : 'Waiting for data…';
  } else {
    status.className = 'status';
    status.textContent = latest ? `Updated ${hm(latest)}` : 'Waiting for data…';
  }
}

// ------------------------------------------------------------ calendar

function renderCalendar() {
  const d = state.data;
  const list = clear($('cal-list'));
  const foot = clear($('cal-foot'));
  const allday = $('cal-allday');
  allday.textContent = '';
  $('cal-empty').hidden = true;
  if (!d) return;

  if (!d.calendars_configured) {
    $('cal-empty').hidden = false;
    $('cal-empty').textContent = isCloud()
      ? 'Add a calendar to WHATSUP_CONFIG in Cloudflare'
      : 'Add a calendar: scripts/configure.sh add-calendar';
    return;
  }
  const cal = d.calendar;
  if (!cal) {
    $('cal-empty').hidden = false;
    $('cal-empty').textContent = 'Loading calendar…';
    return;
  }
  // The server sends "today" as of its last refresh; if the day rolled over
  // and it hasn't refreshed yet, wait rather than show yesterday.
  // "Today" in the dashboard's configured time zone (not the viewing device's)
  const tz = state.settings && state.settings.location && state.settings.location.timezone;
  const keyInTz = (d) => (tz ? d.toLocaleDateString('en-CA', { timeZone: tz }) : dayKey(d));
  const today = keyInTz(new Date());
  const events = cal.today.filter((e) => (e.all_day
    ? e.start <= today && today < e.end
    : keyInTz(new Date(new Date(e.end).getTime() - 1000)) >= today));

  const allDay = events.filter((e) => e.all_day);
  if (allDay.length) allday.textContent = 'All day · ' + allDay.map((e) => e.title).join(', ');

  const timed = events.filter((e) => !e.all_day);
  const now = Date.now();
  for (const e of timed.slice(0, 8)) {
    const li = el('li', 'event');
    if (new Date(e.end).getTime() < now) li.classList.add('past');
    li.appendChild(el('div', 'event-time', e.start_label));
    const bar = el('div', 'event-bar');
    bar.style.background = e.busy ? '#5B6B7B' : e.color;
    li.appendChild(bar);
    const text = el('div', 'event-text');
    text.appendChild(el('div', 'event-title', e.title));
    const meta = e.busy ? `Private · until ${e.end_label}` : `${e.calendar} · until ${e.end_label}`;
    text.appendChild(el('div', 'event-meta', meta));
    li.appendChild(text);
    list.appendChild(li);
  }
  if (timed.length > 8) list.appendChild(el('li', 'event-meta', `+ ${timed.length - 8} more`));
  if (!timed.length && !allDay.length) $('cal-empty').hidden = false;
  if (!timed.length && !allDay.length) $('cal-empty').textContent = 'Nothing planned today';

  const tomorrow = (cal.tomorrow || []).filter((e) => !e.all_day);
  if (tomorrow.length) {
    foot.append('Tomorrow starts with ');
    foot.appendChild(el('b', null, `${tomorrow[0].start_label} ${tomorrow[0].title}`));
  } else {
    foot.textContent = 'Nothing planned tomorrow (yet)';
  }
  if (cal.errors && cal.errors.length) foot.appendChild(el('div', null, 'Couldn’t update: ' + cal.errors.join('; ')));
}

// ------------------------------------------------------------ sun, moon, panchang

function renderSky() {
  const s = state.settings;
  if (!s) return;
  const { latitude: lat, longitude: lon, name } = s.location;
  const now = new Date();
  $('pill-place').textContent = name;
  renderTonight(now);

  const sun = Sky.sunTimes(now, lat, lon);
  $('sun-rise').textContent = hm(sun.rise);
  $('sun-set').textContent = hm(sun.set);
  $('sun-daylight').textContent = sun.daylightMin != null
    ? `Daylight ${Math.floor(sun.daylightMin / 60)}h ${String(sun.daylightMin % 60).padStart(2, '0')}m` : '';
  $('sun-golden').textContent = sun.goldenHour ? `Golden hour ${hm(sun.goldenHour)}` : '';

  const moon = Sky.moonTimes(now, lat, lon);
  $('moon-rise').textContent = moon.rise ? hm(moon.rise) : (moon.alwaysUp ? 'up' : '—');
  $('moon-set').textContent = moon.set ? hm(moon.set) : (moon.alwaysDown ? 'down' : '—');
  const mi = Sky.moonInfo(now, lat, lon);
  $('moon-evening').textContent = mi.upEvening ? 'Up this evening' : 'Not up this evening';
  $('moon-rashi').textContent = `In ${mi.rashi}`;
  $('moon-lit').setAttribute('d', Sky.moonLitPath(mi.fraction, mi.waxing, 50, 50, 48));
  const pct = Math.round(mi.fraction * 100);
  $('moon-phase').textContent = `${pct}% lit · ${mi.phaseName}`;
  $('moon-svg').setAttribute('aria-label', `Moon tonight: ${pct}% lit, ${mi.phaseName}`);
  $('moon-full').textContent = `Full moon · ${longDay(mi.nextFull)}, ${hm(mi.nextFull)}`;
  $('moon-new').textContent = `New moon · ${longDay(mi.nextNew)}`;

  const skyDays = clear($('sky-days'));
  for (let i = 1; i <= 2; i++) {
    const day = addDays(now, i);
    const st = Sky.sunTimes(day, lat, lon);
    const mt = Sky.moonTimes(day, lat, lon);
    const row = el('div', 'grid-sky row');
    row.append(el('span', 'day', shortDay(day)), el('span', null, hm(st.rise)), el('span', null, hm(st.set)),
      el('span', 'm', mt.rise ? hm(mt.rise) : '—'), el('span', 'm', mt.set ? hm(mt.set) : '—'));
    skyDays.appendChild(row);
  }
  const cc = Sky.upcomingClockChange(now, 3);
  $('clock-change').textContent = cc
    ? `Clocks go ${cc.back ? 'back' : 'forward'} ${cc.hours} hour · ${cc.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
    : '';

  renderPanchang(now, lat, lon);
}

// Calculated festival dates for the next two months, with the checked list
// (config/festivals.json) taking priority. Worked out once a day.
function allFestivals() {
  const listed = (state.settings && state.settings.festivals) || [];
  const today = dayKey(new Date());
  if (state.festivalsDay !== today) {
    try {
      const calc = festivalsBetween(addDays(new Date(), -2), addDays(new Date(), 100));
      state.festivals = mergeFestivals(calc, listed);
    } catch (e) {
      state.festivals = listed;
    }
    state.festivalsDay = today;
  }
  return state.festivals || listed;
}

function festivalsOn(key) {
  return allFestivals().filter((f) => f.date === key).map((f) => f.name);
}

function renderPanchang(now, lat, lon) {
  const system = (state.settings.panchang && state.settings.panchang.month_system) || 'purnimanta';
  const p = Sky.panchang(now, lat, lon, system);
  const festToday = festivalsOn(dayKey(now));

  $('pan-system').textContent = `${system === 'amanta' ? 'Amanta' : 'Purnimanta'} · ${state.settings.location.name}`;
  $('pan-tithi').textContent = p.tithi;
  const tag = $('pan-tag');
  const tagText = p.ekadashi ? p.ekadashi : (festToday[0] || '');
  tag.textContent = tagText;
  tag.hidden = !tagText;
  $('pan-paksha').textContent = `${p.paksha} Paksha · ${p.month}`;
  $('pill-tithi').textContent = `${p.month} ${p.paksha} ${p.tithi}`;
  const fp = $('pill-festival');
  fp.textContent = festToday.join(' · ');
  fp.hidden = !festToday.length;

  const grid = clear($('pan-grid'));
  const rows = [
    ['Nakshatra', p.nakshatra],
    ['Yoga', p.yoga],
    ['Karana', p.karana],
    ['Moon rashi', p.moonRashi],
    ['Rahu Kaal', p.rahu ? `${hm(p.rahu.start)}–${hm(p.rahu.end)}` : '—', true],
    ['Abhijit', p.abhijit ? `${hm(p.abhijit.start)}–${hm(p.abhijit.end)}` : '—'],
    ['Ritu · Samvat', `${p.ritu} · VS ${p.samvat}`],
  ];
  for (const [k, v, hl] of rows) {
    grid.appendChild(el('dt', null, k));
    grid.appendChild(el('dd', hl ? 'hl' : null, v));
  }

  renderNow(now, lat, lon, system, p);

  const days = clear($('pan-days'));
  for (let i = 1; i <= 2; i++) {
    const day = addDays(now, i);
    const q = Sky.panchang(day, lat, lon, system);
    const row = el('div', 'pan-day');
    row.appendChild(el('div', 'day', shortDay(day)));
    const box = el('div');
    const t = el('div', 't', q.tithi);
    t.appendChild(el('span', 'p', q.paksha));
    box.appendChild(t);
    const extra = [q.ekadashi ? `${q.ekadashi} Ekadashi` : null, ...festivalsOn(dayKey(day))].filter(Boolean);
    if (extra.length) box.appendChild(el('div', 'f', extra.join(' · ')));
    row.appendChild(box);
    days.appendChild(row);
  }

  // Countdown to the next festival (from tomorrow on)
  const todayKey = dayKey(now);
  const upcoming = allFestivals().filter((f) => f.date > todayKey).sort((a, b) => a.date.localeCompare(b.date));
  const nextFest = upcoming[0];
  $('countdown').hidden = !nextFest;
  if (nextFest) {
    const d = new Date(nextFest.date + 'T12:00:00');
    const days = Math.round((d - new Date(todayKey + 'T12:00:00')) / 86400000);
    $('cd-num').textContent = String(days);
    $('cd-unit').textContent = days === 1 ? 'day to go' : 'days to go';
    $('cd-name').textContent = nextFest.name;
    $('cd-date').textContent = longDay(d);
  }

  // The festivals after that one, within 45 days
  const coming = clear($('pan-coming'));
  const until = dayKey(addDays(now, 45));
  const next = upcoming
    .filter((f) => f !== nextFest && f.date <= until && (!nextFest || f.date >= nextFest.date))
    .slice(0, 2);
  if (next.length) {
    coming.append('Coming up: ');
    next.forEach((f, i) => {
      if (i) coming.append(' · ');
      const d = new Date(f.date + 'T12:00:00');
      coming.appendChild(el('b', null, `${f.name} · ${shortDay(d)}`));
    });
  }
}

// "Right now": the tithi in force at this moment (it can differ from the
// sunrise tithi shown on the left), when it changes, and on Ekadashi the
// window to break the fast the next morning.
function renderNow(now, lat, lon, system, todayPanchang) {
  const when = (d) => (dayKey(d) === dayKey(now) ? hm(d) : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(d)}`);
  const t = Sky.tithiNow(now);
  $('dial-num').textContent = String((t.index % 15) + 1);
  $('dial-sub').textContent = t.paksha.toUpperCase();
  $('dial-arc').setAttribute('stroke-dasharray', `${(t.progress * 100).toFixed(1)} 100`);
  $('dial').setAttribute('aria-label', `${t.name}, ${Math.round(t.progress * 100)}% through, until ${when(t.end)}`);
  $('now-name').textContent = t.name;
  const until = clear($('now-until'));
  until.append('until ');
  until.appendChild(el('b', null, when(t.end)));
  until.append(` · then ${t.next}`);
  const n = Sky.nakshatraNow(now);
  const nak = clear($('now-nak'));
  nak.appendChild(el('b', null, n.name));
  nak.append(` till ${when(n.end)}`);

  // Parana: shown on Ekadashi, and on the morning after until the window closes
  let parana = null;
  if (todayPanchang.ekadashi) parana = Sky.paranaWindow(now, lat, lon);
  else {
    const y = Sky.panchang(addDays(now, -1), lat, lon, system);
    if (y.ekadashi) {
      const w = Sky.paranaWindow(addDays(now, -1), lat, lon);
      if (w && w.end && now < w.end) parana = w;
    }
  }
  $('parana').hidden = !(parana && parana.end);
  if (parana && parana.end) {
    const dayLabel = dayKey(parana.start) === dayKey(now) ? 'Today' : parana.start.toLocaleDateString('en-GB', { weekday: 'short' });
    $('parana-t').textContent = `${dayLabel} ${hm(parana.start)}–${hm(parana.end)}`;
  }
}

// ------------------------------------------------------------ weather

function weatherIcon(kind) {
  const cloud = (d) => svgEl('path', { d, stroke: '#C9D3DC' });
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'wx-icon', role: 'img', 'aria-label': kind });
  if (kind === 'sun') {
    svg.append(svgEl('circle', { cx: 12, cy: 12, r: 4, stroke: '#FFB547' }),
      svgEl('path', { d: 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4', stroke: '#FFB547' }));
  } else if (kind === 'moon') {
    svg.append(svgEl('path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', stroke: '#D8CFFF' }));
  } else if (kind === 'partly') {
    svg.append(svgEl('circle', { cx: 8, cy: 8, r: 3, stroke: '#FFB547' }),
      svgEl('path', { d: 'M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7', stroke: '#FFB547' }),
      cloud('M9 19h8a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.4 1.6A2.7 2.7 0 0 0 9 19z'));
  } else if (kind === 'rain' || kind === 'storm' || kind === 'snow') {
    svg.append(cloud('M7 14h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z'));
    if (kind === 'snow') svg.append(svgEl('path', { d: 'M9 18h.01M13 18h.01M17 18h.01M11 21h.01M15 21h.01', stroke: '#F1F4F8', 'stroke-width': 2.4 }));
    else if (kind === 'storm') svg.append(svgEl('path', { d: 'M13 15l-2 3h3l-2 3', stroke: '#FFB547' }));
    else svg.append(svgEl('path', { d: 'M9 17l-1 3M13 17l-1 3M17 17l-1 3', stroke: '#5BB4FF' }));
  } else {
    svg.append(cloud('M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z'));
  }
  return svg;
}

function renderWeather() {
  const wx = state.data && state.data.weather;
  const grid = clear($('wx-grid'));
  const next = clear($('wx-next'));
  if (!wx || !wx.hours || !wx.hours.length) {
    grid.appendChild(el('div', 'empty', 'Loading weather…'));
    return;
  }
  $('wx-high').textContent = wx.today ? `${wx.today.max}°` : '--°';
  $('wx-low').textContent = wx.today ? `${wx.today.min}°` : '--°';

  const hours = wx.hours.slice(0, 13);
  grid.style.gridTemplateColumns = `54px repeat(${hours.length}, minmax(0, 1fr))`;
  const label = (text, color) => { const n = el('div', 'wx-rowlabel', text); n.style.color = color; return n; };

  grid.appendChild(label('Temp', '#FFB547'));
  hours.forEach((h) => grid.appendChild(el('div', 'wx-temp', h.temp == null ? '–' : `${h.temp}°`)));

  // temperature line
  grid.appendChild(el('div'));
  const temps = hours.map((h) => (h.temp == null ? null : h.temp));
  const valid = temps.filter((t) => t != null);
  const lo = Math.min(...valid) - 1;
  const hi = Math.max(...valid) + 1;
  const W = hours.length * 100;
  const pts = temps.map((t, i) => (t == null ? null : [i * 100 + 50, 92 - ((t - lo) / (hi - lo)) * 84]))
    .filter(Boolean);
  const line = el('div', 'wx-line');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 100`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (pts.length > 1) {
    const ptStr = pts.map((p) => `${p[0]},${p[1].toFixed(1)}`).join(' ');
    svg.append(
      svgEl('path', { d: `M${pts[0][0]},100 L${ptStr.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},100 Z`, fill: '#FFB547', 'fill-opacity': '0.14' }),
      svgEl('polyline', { points: ptStr, fill: 'none', stroke: '#FFB547', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }),
    );
  }
  line.appendChild(svg);
  grid.appendChild(line);

  grid.appendChild(label('Rain', '#5BB4FF'));
  hours.forEach((h) => {
    const cell = el('div', 'wx-rain');
    cell.appendChild(el('span', null, `${h.rain}%`));
    const bar = el('i');
    bar.style.height = `${Math.max(2, Math.round(h.rain * 0.6))}px`;
    cell.appendChild(bar);
    cell.title = `${h.rain_mm} mm`;
    grid.appendChild(cell);
  });

  grid.appendChild(label('Wind', '#C9D3DC'));
  hours.forEach((h) => {
    const cell = el('div', 'wx-wind');
    // wind_dir is where the wind comes FROM; the arrow points where it blows TO
    const arrow = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svgEl('path', { d: 'M12 20V4M6 10l6-6 6 6' })]);
    arrow.style.transform = `rotate(${(h.wind_dir + 180) % 360}deg)`;
    cell.append(arrow, String(h.wind));
    grid.appendChild(cell);
  });

  grid.appendChild(el('div'));
  hours.forEach((h) => grid.appendChild(el('div', h.label === 'Now' ? 'wx-hour now' : 'wx-hour', h.label)));

  next.appendChild(el('span', 'label', 'Next 2 days'));
  for (const d of wx.next || []) {
    const item = el('span', 'wx-day');
    const date = new Date(d.date + 'T12:00:00');
    item.append(el('b', null, shortDay(date)), weatherIcon(d.kind), el('span', 'hi', `${d.max}°`),
      el('span', 'lo', `${d.min}°`), el('span', 'rn', `· ${d.rain}% rain`));
    next.appendChild(item);
  }
}

// ------------------------------------------------------------ camera

const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

function camUrl(cam) {
  const qs = new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', rel: '0', playsinline: '1', modestbranding: '1',
    iv_load_policy: '3', disablekb: '1', fs: '0', cc_load_policy: '0',
    enablejsapi: '1', origin: location.origin, // lets the page tell the player to play
  }).toString();
  if (cam.youtube_video_id && YT_VIDEO.test(cam.youtube_video_id)) {
    return `https://www.youtube-nocookie.com/embed/${cam.youtube_video_id}?${qs}`;
  }
  if (cam.youtube_channel_id && YT_CHANNEL.test(cam.youtube_channel_id)) {
    return `https://www.youtube.com/embed/live_stream?channel=${cam.youtube_channel_id}&${qs}`;
  }
  return null;
}

// Keeps the stream playing without showing any YouTube buttons. Talks to the
// player with YouTube's documented postMessage commands (no extra script).
const player = { iframe: null, origin: null, playing: false, tries: 0, timer: null, reveal: null };

function playerSend(func, args = []) {
  const w = player.iframe && player.iframe.contentWindow;
  if (w) w.postMessage(JSON.stringify({ event: 'command', func, args }), player.origin);
}

function nudgePlayer() {
  if (!player.iframe || player.playing) return;
  player.tries += 1;
  playerSend('mute');
  playerSend('playVideo');
  // Still not playing after ~20 s (e.g. the browser blocks autoplay):
  // show the player so someone can press play once.
  if (player.tries >= 5) $('cam-frame').classList.add('needs-click');
}

function onPlayerMessage(e) {
  if (!player.iframe || e.source !== player.iframe.contentWindow || e.origin !== player.origin) return;
  let msg;
  try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
  if (!msg || typeof msg !== 'object') return;
  let st = null;
  if (msg.event === 'onStateChange' && typeof msg.info === 'number') st = msg.info;
  else if (msg.info && typeof msg.info === 'object' && typeof msg.info.playerState === 'number') st = msg.info.playerState;
  if (st === null) return;
  const frame = $('cam-frame');
  if (st === 1) { // playing
    if (!player.playing) {
      player.playing = true;
      player.tries = 0;
      clearTimeout(player.reveal);
      // YouTube shows the title for a few seconds when playback starts
      player.reveal = setTimeout(() => { frame.classList.remove('needs-click'); frame.classList.add('showing'); }, 3500);
    }
  } else if (st !== 3) { // not buffering: paused, ended, cued or unstarted
    player.playing = false;
    setTimeout(nudgePlayer, 1000);
  }
}

function startPlayer(iframe, url) {
  clearInterval(player.timer);
  clearTimeout(player.reveal);
  Object.assign(player, { iframe, origin: new URL(url).origin, playing: false, tries: 0 });
  const frame = $('cam-frame');
  frame.classList.remove('showing', 'needs-click');
  iframe.addEventListener('load', () => {
    // ask the player to report its state, then make sure it plays
    const w = iframe.contentWindow;
    if (w) w.postMessage(JSON.stringify({ event: 'listening', id: 'whatsup-cam', channel: 'widget' }), player.origin);
    nudgePlayer();
  });
  player.timer = setInterval(nudgePlayer, 4000);
}

function renderCamera() {
  const cams = (state.settings && state.settings.cameras) || [];
  const frame = $('cam-frame');
  if (!cams.length) {
    clear(frame);
    $('cam-empty').hidden = false;
    $('cam-empty-text').textContent = isCloud()
      ? 'Add a camera to WHATSUP_CONFIG in Cloudflare'
      : 'Add a camera: scripts/configure.sh add-camera';
    return;
  }
  $('cam-empty').hidden = true;
  state.camIndex = state.camIndex % cams.length;
  const cam = cams[state.camIndex];
  const url = camUrl(cam);
  $('cam').setAttribute('aria-label', `Live camera: ${cam.name}`);
  if (url && state.camRendered !== url) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = `Live camera: ${cam.name}`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    // no allow-popups / allow-top-navigation: the stream can't open other pages
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.tabIndex = -1;
    clear(frame).appendChild(iframe);
    state.camRendered = url;
    startPlayer(iframe, url);
  }
}

// ------------------------------------------------------------ other cities

function renderWorld(now = new Date()) {
  const places = (state.settings && state.settings.world_clocks) || [];
  const box = $('world');
  box.hidden = places.length === 0;
  if (!places.length) return;
  const weather = (state.data && state.data.world_weather) || [];
  const here = now.toLocaleDateString('en-GB', { weekday: 'short' });
  clear(box);
  places.forEach((p, i) => {
    let time;
    let day;
    try {
      time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: p.timezone });
      day = now.toLocaleDateString('en-GB', { weekday: 'short', timeZone: p.timezone });
    } catch (e) {
      return;
    }
    const city = el('div', 'city');
    const name = el('div', 'city-name', p.name);
    if (day !== here) name.append(el('span', 'city-day', day)); // already tomorrow / still yesterday there
    const row = el('div', 'city-row');
    row.append(el('span', 'city-time', time));
    const w = weather[i];
    if (w && typeof w.temp === 'number') row.append(weatherIcon(w.kind), el('span', 'city-temp', `${w.temp}°`));
    city.append(name, row);
    city.title = `${p.name}: ${time}${w ? `, ${w.temp}°C` : ''}`;
    box.append(city);
  });
}

// ------------------------------------------------------------ side column: Sky | News tabs

const TAB_BACK_MS = 5 * 60 * 1000; // News goes back to Sky after 5 minutes
const ROW_CLOSE_MS = 2 * 60 * 1000; // an open row closes itself after 2 minutes
const ISS_REFRESH_MS = 6 * 60 * 60 * 1000;

function selectTab(name) {
  state.tab = name;
  const sky = name === 'sky';
  $('tab-sky').setAttribute('aria-selected', String(sky));
  $('tab-news').setAttribute('aria-selected', String(!sky));
  $('panel-sky').hidden = !sky;
  $('panel-news').hidden = sky;
  clearTimeout(state.tabTimer);
  if (sky) renderTonight();
  else {
    renderNews();
    state.tabTimer = setTimeout(() => selectTab('sky'), TAB_BACK_MS);
  }
}

function setupTabs() {
  $('tab-sky').addEventListener('click', () => selectTab('sky'));
  $('tab-news').addEventListener('click', () => selectTab('news'));
  // someone reading the news: keep it open a little longer
  $('panel-news').addEventListener('pointerdown', () => {
    clearTimeout(state.tabTimer);
    state.tabTimer = setTimeout(() => selectTab('sky'), TAB_BACK_MS);
  });
  // left/right arrows move between tabs
  $('side-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if ($('tab-news').hidden) return;
    const next = state.tab === 'sky' ? 'news' : 'sky';
    selectTab(next);
    $(`tab-${next}`).focus();
  });
}

// ------------------------------------------------------------ tonight's sky

function skyRow(r) {
  const row = el('div', 'srow');
  row.dataset.key = r.key;
  const head = el('button', 'srow-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-label', `${r.name}: best at ${r.chip}, look ${r.compass}, ${Night.heightWords(r.alt)}`);
  const icon = r.kind === 'constellation' ? SkyIcons.patternIcon(r.icon) : SkyIcons.bodyIcon(r.key);
  const chip = el('span', r.morning ? 'srow-chip am' : 'srow-chip', r.chip);
  const dir = el('span', 'srow-dir', r.compass);
  dir.append(SkyIcons.heightDial(r.alt));
  const chev = svgEl('svg', { viewBox: '0 0 24 24', class: 'srow-chev', 'aria-hidden': 'true' }, [svgEl('path', { d: 'M9 6l6 6-6 6' })]);
  head.append(icon, el('span', 'srow-name', r.name), chip, dir, chev);

  const body = el('div', 'srow-body');
  body.hidden = true;
  const grid = el('dl', 'srow-grid');
  for (const [k, v] of r.details) grid.append(el('dt', null, k), el('dd', null, v));
  const fact = el('div', 'srow-fact');
  fact.append(el('b', null, 'Did you know?'), document.createTextNode(` ${r.fact}`));
  body.append(grid, fact);
  row.append(head, body);
  head.addEventListener('click', () => {
    state.skyOpen = state.skyOpen === r.key ? null : r.key;
    clearTimeout(state.skyOpenTimer);
    if (state.skyOpen) state.skyOpenTimer = setTimeout(() => { state.skyOpen = null; renderTonight(); }, ROW_CLOSE_MS);
    renderTonight();
  });
  if (state.skyOpen === r.key) {
    row.classList.add('open');
    body.hidden = false;
    head.setAttribute('aria-expanded', 'true');
  }
  return row;
}

function group(title, right) {
  const g = el('div', 'sgroup');
  g.append(el('span', null, title), el('span', null, right || ''));
  return g;
}

function renderTonight(now = new Date()) {
  const s = state.settings;
  if (!s || $('side').hidden || state.tab !== 'sky') return;
  const { latitude: lat, longitude: lon } = s.location;
  let t;
  try {
    const clouds = state.data && state.data.weather && state.data.weather.clouds;
    t = Night.skyTonight(now, lat, lon, { tle: state.iss, clouds });
  } catch (e) {
    return;
  }
  // space background, drawn once per panel size
  const panel = $('panel-sky');
  const size = `${panel.clientWidth}x${panel.clientHeight}`;
  if (state.spaceSize !== size && panel.clientWidth > 0) {
    state.spaceSize = size;
    clear($('space')).append(SkyIcons.spaceBackground(panel.clientWidth, panel.clientHeight));
  }

  // clouds + highlight
  $('sky-cloud').hidden = !t.cloud;
  if (t.cloud) {
    $('sky-cloud-text').textContent = t.cloud.text;
    $('sky-cloud-sub').textContent = `· ${t.cloud.sub}`;
  }
  const hl = t.highlight;
  clear($('sky-hl-icon'));
  const hlText = clear($('sky-hl-text'));
  if (hl) {
    $('sky-hl-icon').append(SkyIcons.highlightIcon(hl));
    hlText.append(el('b', null, 'Highlight: '), document.createTextNode(hl.text));
  } else if (t.times.look) {
    $('sky-hl-icon').append(SkyIcons.bodyIcon('Moon', 30));
    hlText.append(el('b', null, 'Tonight: '), document.createTextNode(`look up from ${hm(t.times.look)}`));
  }

  // rows (keep keyboard focus on the same row across re-renders)
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.srow');
  const focusKey = focused ? focused.dataset.key : null;
  const list = clear($('sky-list'));
  list.classList.toggle('cloudy', !!(t.cloud && !t.cloud.good));
  const keys = [...t.planets, ...t.constellations].map((r) => r.key);
  if (state.skyOpen && !keys.includes(state.skyOpen)) state.skyOpen = null;
  if (t.planets.length) {
    list.append(group(t.planets.some((r) => r.kind === 'iss') ? 'Planets & Space Station' : 'Planets', 'best time · where'));
    for (const r of t.planets) list.append(skyRow(r));
  }
  const consRows = t.constellations.map(skyRow);
  if (consRows.length) {
    list.append(group('Constellations', '19:00 – 24:00'));
    for (const r of consRows) list.append(r);
  }
  if (!t.planets.length && !consRows.length) list.append(el('div', 'sky-empty', 'Light summer nights: not much to see until later in the year.'));

  // fit: tuck the last constellations away (keep 4) behind "+ N more"
  const openIdx = consRows.findIndex((r) => r.dataset.key === state.skyOpen);
  const hidden = [];
  while (list.scrollHeight > list.clientHeight + 1 && consRows.length - hidden.length > 4) {
    let i = consRows.length - 1 - hidden.length;
    if (i === openIdx) break;
    consRows[i].hidden = true;
    hidden.push(i);
  }
  if (hidden.length) {
    const more = el('button', 'more-btn', `+ ${hidden.length} more constellation${hidden.length > 1 ? 's' : ''}`);
    more.type = 'button';
    more.addEventListener('click', () => { state.skyOpen = null; renderTonight(); });
    list.append(more);
    // the button itself may push one more row out
    while (list.scrollHeight > list.clientHeight + 1 && consRows.length - hidden.length > 4) {
      const i = consRows.length - 1 - hidden.length;
      if (i === openIdx) break;
      consRows[i].hidden = true;
      hidden.push(i);
      more.textContent = `+ ${hidden.length} more constellations`;
    }
  }

  if (focusKey) {
    const again = list.querySelector(`.srow[data-key="${CSS.escape(focusKey)}"] .srow-head`);
    if (again) again.focus();
  }

  // footnotes (only while nothing is open: room is tight then)
  const foot = clear($('sky-foot'));
  if (!state.skyOpen) {
    if (t.planets.some((r) => r.morning)) {
      const line = el('span');
      line.append(el('b', null, 'Amber'), document.createTextNode(' time = tomorrow morning · the dot shows how high to look'));
      foot.append(line);
    } else {
      foot.append(el('span', null, 'The dot shows how high to look'));
    }
    if (t.brightMoon) foot.append(el('span', null, 'Bright Moon tonight: only the brightest stars show'));
  }
}

async function loadIss() {
  if (!isCloud() || $('side').hidden) return;
  if (state.issAt && Date.now() - state.issAt < ISS_REFRESH_MS) return;
  try {
    const r = await getJSON('/api/iss');
    state.iss = Array.isArray(r.tle) && r.tle.length === 2 ? r.tle : null;
    state.issAt = Date.now();
    renderTonight();
  } catch (e) {
    // no passes shown; try again next time
  }
}

// ------------------------------------------------------------ kids' news

function timeAgo(iso, now) {
  if (!iso) return '';
  const min = Math.round((now - new Date(iso)) / 60000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  const days = Math.round(min / 1440);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function newsAvailable() {
  return isCloud() && state.settings.news_enabled !== false;
}

function renderNews() {
  $('tab-news').hidden = !newsAvailable();
  if (!newsAvailable() && state.tab === 'news') { selectTab('sky'); return; }
  if (state.tab !== 'news') return;
  const news = state.news;
  const now = new Date();
  const list = clear($('news-list'));
  const items = (news && news.items) || [];
  for (const item of items) {
    const li = el('li', 'news-item');
    const meta = el('div', 'news-meta');
    meta.append(el('span', item.lang === 'EN' ? 'chip en' : 'chip', item.lang), el('span', '', `${item.source} · ${timeAgo(item.published, now)}`));
    let title;
    if (item.link && /^https:\/\//.test(item.link)) {
      title = el('a', 'news-title', item.title);
      title.href = item.link;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
    } else {
      title = el('div', 'news-title', item.title);
    }
    li.append(title, meta);
    list.append(li);
  }
  if (!items.length) list.append(el('li', 'empty', news ? 'No headlines right now.' : 'Loading headlines…'));
  // drop headlines that would be cut off at the bottom
  const bottom = list.getBoundingClientRect().bottom;
  for (const li of [...list.children].reverse()) {
    if (li.getBoundingClientRect().bottom > bottom + 1 && list.children.length > 1) li.remove();
  }
  $('news-updated').textContent = news && news.updated ? `updated ${hm(new Date(news.updated))}` : '';
  $('news-foot').textContent = news && news.errors && news.errors.length
    ? `Not reachable just now: ${news.errors.map((x) => x.replace(/: unavailable$/, '')).join(', ')}`
    : 'From children’s news services, checked every 30 minutes. Click a headline to read it.';
}

async function loadNews() {
  if (!newsAvailable() || $('side').hidden) { renderNews(); return; }
  try {
    const next = await getJSON('/api/news');
    // keep the last good headlines if every source failed this time
    if (!(next.items && next.items.length === 0 && state.news && state.news.items && state.news.items.length && next.errors && next.errors.length)) {
      state.news = next;
    }
  } catch (e) {
    // keep showing what we have
  }
  renderNews();
}

// ------------------------------------------------------------ data loading

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 401) {
    // signed out (or Google access was revoked): back to the sign-in page
    let reason = '';
    try { reason = (await r.json()).reason || ''; } catch (e) { /* ignore */ }
    location.href = reason === 'expired' ? '/?signin=expired' : '/';
    throw new Error('signed out');
  }
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function setupSignOut() {
  const btn = $('signout');
  if (!isCloud() || MODE === 'screensaver') return;
  btn.hidden = false;
  if (state.settings.signed_in_as) btn.title = `Signed in as ${state.settings.signed_in_as}`;
  btn.addEventListener('click', async () => {
    if (!confirm('Sign out of the family dashboard on this device?')) return;
    try {
      await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      location.href = '/';
    }
  });
}

// If one source failed this time, keep showing its last good data.
function mergeData(prev, next) {
  if (!prev) return next;
  const out = { ...next };
  if (!next.world_weather && prev.world_weather) out.world_weather = prev.world_weather;
  for (const kind of ['calendar', 'weather']) {
    if (!next[kind] && prev[kind]) {
      out[kind] = prev[kind];
      out[`${kind}_updated`] = prev[`${kind}_updated`];
    }
  }
  return out;
}

async function loadData() {
  try {
    state.data = mergeData(state.data, await getJSON('/api/data'));
  } catch (e) {
    // keep showing what we have
  }
  renderStatus();
  renderCalendar();
  renderWeather();
  renderWorld();
  renderTonight(); // clouds come with the weather
}

async function start() {
  if (MODE === 'screensaver') document.body.classList.add('screensaver');
  setupSideToggle();
  setupTabs();
  window.addEventListener('message', onPlayerMessage);
  fitStage();
  window.addEventListener('resize', fitStage);

  for (;;) {
    try {
      state.settings = await getJSON('/api/settings');
      break;
    } catch (e) {
      $('status').textContent = 'Waiting for the dashboard server…';
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  setupSignOut();
  renderClock();
  renderSky();
  renderCamera();
  await loadData();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  setInterval(renderClock, 10 * 1000);
  setInterval(loadData, DATA_REFRESH_MS);
  setInterval(renderSky, SKY_REFRESH_MS);
  loadNews();
  loadIss();
  setInterval(loadNews, NEWS_REFRESH_MS);
  setInterval(loadIss, 30 * 60 * 1000); // fetches only when the data is 6 h old
  setInterval(renderNews, SKY_REFRESH_MS); // keeps "20 min ago" current

  const rotate = Number(state.settings.camera_rotate_minutes || 0);
  if (rotate > 0 && state.settings.cameras.length > 1) {
    setInterval(() => { state.camIndex += 1; renderCamera(); }, rotate * 60 * 1000);
  }
}

start();

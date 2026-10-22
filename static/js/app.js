// Whatsup family dashboard — page logic.
// All text from calendars is inserted with textContent, never as HTML.

import * as Sky from './sky.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const MODE = params.get('mode') === 'screensaver' ? 'screensaver' : 'app';
const DATA_REFRESH_MS = 2 * 60 * 1000;
const SKY_REFRESH_MS = 5 * 60 * 1000;

const state = { settings: null, data: null, camIndex: 0, camRendered: null, dayKey: null };

const $ = (id) => document.getElementById(id);
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

function fitStage() {
  const stage = $('stage');
  const scale = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
  const left = (window.innerWidth - 1440 * scale) / 2;
  const top = (window.innerHeight - 900 * scale) / 2;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
}

// ------------------------------------------------------------ clock & header

function renderClock() {
  const now = new Date();
  $('clock').textContent = hm(now);
  $('date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (state.dayKey !== dayKey(now)) {
    state.dayKey = dayKey(now);
    renderSky();
    renderCalendar();
  }
  renderCamTime();
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
  const today = dayKey(new Date());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const events = cal.today.filter((e) => (e.all_day
    ? e.start <= today && today < e.end
    : new Date(e.end) > startOfToday));

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
  $('moon-lit').setAttribute('d', Sky.moonLitPath(mi.fraction, mi.waxing, 32, 32, 28));
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

function festivalsOn(key) {
  const list = (state.settings && state.settings.festivals) || [];
  return list.filter((f) => f.date === key).map((f) => f.name);
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

  // Next festivals after the 2-day window, within 45 days
  const coming = clear($('pan-coming'));
  const from = dayKey(addDays(now, 3));
  const until = dayKey(addDays(now, 45));
  const next = ((state.settings && state.settings.festivals) || [])
    .filter((f) => f.date >= from && f.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date))
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

// ------------------------------------------------------------ weather

function weatherIcon(kind) {
  const cloud = (d) => svgEl('path', { d, stroke: '#C9D3DC' });
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'wx-icon', role: 'img', 'aria-label': kind });
  if (kind === 'sun') {
    svg.append(svgEl('circle', { cx: 12, cy: 12, r: 4, stroke: '#FFB547' }),
      svgEl('path', { d: 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4', stroke: '#FFB547' }));
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
  const common = 'autoplay=1&mute=1&controls=0&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&disablekb=1';
  if (cam.youtube_video_id && YT_VIDEO.test(cam.youtube_video_id)) {
    return `https://www.youtube-nocookie.com/embed/${cam.youtube_video_id}?${common}`;
  }
  if (cam.youtube_channel_id && YT_CHANNEL.test(cam.youtube_channel_id)) {
    return `https://www.youtube.com/embed/live_stream?channel=${cam.youtube_channel_id}&${common}`;
  }
  return null;
}

function renderCamera() {
  const cams = (state.settings && state.settings.cameras) || [];
  const frame = $('cam-frame');
  const buttons = clear($('cam-buttons'));
  if (!cams.length) {
    clear(frame);
    $('cam-empty').hidden = false;
    $('cam-empty-text').textContent = isCloud()
      ? 'Add a camera to WHATSUP_CONFIG in Cloudflare'
      : 'Add a camera: scripts/configure.sh add-camera';
    $('cam-live').hidden = true;
    $('cam-name').textContent = '';
    return;
  }
  $('cam-empty').hidden = true;
  $('cam-live').hidden = false;
  state.camIndex = state.camIndex % cams.length;
  const cam = cams[state.camIndex];
  const url = camUrl(cam);
  if (url && state.camRendered !== url) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = `Live camera: ${cam.name}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    // no allow-popups / allow-top-navigation: the stream can't open other pages
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    clear(frame).appendChild(iframe);
    state.camRendered = url;
  }
  $('cam-name').textContent = cam.place && cam.place !== cam.name ? `${cam.name}, ${cam.place}` : cam.name;
  renderCamTime();

  if (cams.length > 1) {
    cams.forEach((c, i) => {
      const b = el('button', null, c.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === state.camIndex));
      b.addEventListener('click', () => { state.camIndex = i; renderCamera(); });
      buttons.appendChild(b);
    });
  }
}

function renderCamTime() {
  const cams = (state.settings && state.settings.cameras) || [];
  const cam = cams[state.camIndex % (cams.length || 1)];
  if (!cam) { $('cam-time').textContent = ''; return; }
  try {
    const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: cam.timezone || 'Asia/Kolkata' });
    $('cam-time').textContent = `${t} ${cam.timezone === 'Asia/Kolkata' || !cam.timezone ? 'IST' : ''}`.trim();
  } catch (e) {
    $('cam-time').textContent = '';
  }
}

// ------------------------------------------------------------ data loading

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// If one source failed this time, keep showing its last good data.
function mergeData(prev, next) {
  if (!prev) return next;
  const out = { ...next };
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
}

async function start() {
  if (MODE === 'screensaver') document.body.classList.add('screensaver');
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
  renderClock();
  renderSky();
  renderCamera();
  await loadData();

  setInterval(renderClock, 10 * 1000);
  setInterval(loadData, DATA_REFRESH_MS);
  setInterval(renderSky, SKY_REFRESH_MS);

  const rotate = Number(state.settings.camera_rotate_minutes || 0);
  if (MODE === 'screensaver' && rotate > 0 && state.settings.cameras.length > 1) {
    setInterval(() => { state.camIndex += 1; renderCamera(); }, rotate * 60 * 1000);
  }
}

start();

// "Tonight's sky" for the side column: which planets and constellations a
// family can see, when and where to look, plus tonight's highlight, the
// cloud forecast and Space Station passes. Everything is worked out in the
// browser from the location; times are local Date objects.

import * as Astronomy from '../vendor/astronomy.js';
import * as Sat from '../vendor/satellite.es.js';
import { sunTimes, meteorShower, eclipses } from './sky.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const AU_KM = 149597870.7;
const LIGHT_MIN_PER_AU = 8.3167;

const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_LONG = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const norm = (deg) => ((deg % 360) + 360) % 360;
export const compassShort = (az) => COMPASS_SHORT[Math.round(norm(az) / 45) % 8];
export const compassLong = (az) => COMPASS_LONG[Math.round(norm(az) / 45) % 8];

const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayName = (d) => d.toLocaleDateString('en-GB', { weekday: 'short' });
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function heightWords(alt) {
  if (alt < 20) return 'low down';
  if (alt < 35) return 'a third of the way up';
  if (alt < 55) return 'halfway up';
  if (alt < 72) return 'high up';
  return 'almost overhead';
}

function position(body, date, observer) {
  const eq = Astronomy.Equator(body, date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth, dist: eq.dist };
}

function starPosition(ra, dec, date, observer) {
  const hor = Astronomy.Horizon(date, observer, ra, dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth };
}

function roundUp(date, minutes) {
  const step = minutes * MIN;
  return new Date(Math.ceil(date.getTime() / step) * step);
}
function roundNearest(date, minutes) {
  const step = minutes * MIN;
  return new Date(Math.round(date.getTime() / step) * step);
}
function atHour(day, h, m = 0) {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function farAway(au) {
  const km = au * AU_KM;
  const dist = km >= 1e9 ? `${(km / 1e9).toFixed(2)} billion km` : `${Math.round(km / 1e6)} million km`;
  return `${dist} · its light takes ${Math.round(au * LIGHT_MIN_PER_AU)} min to reach us`;
}

// ---------------------------------------------------------------- the night's timeline

/**
 * The evening we're talking about, the time to look in the evening (21:00,
 * or later if it isn't dark yet, or now if that's later still) and the time
 * to look before sunrise.
 */
export function nightTimes(now, lat, lon) {
  const observer = new Astronomy.Observer(lat, lon, 0);
  const today = sunTimes(now, lat, lon);
  const smallHours = today.rise && now < today.rise && now.getHours() < 12;
  const eveningDay = smallHours ? new Date(now.getTime() - DAY) : now;
  const set = sunTimes(eveningDay, lat, lon).set;
  let dark = null;
  if (set) {
    const r = Astronomy.SearchAltitude('Sun', observer, -1, set, 1, -9);
    dark = r ? r.date : new Date(set.getTime() + 75 * MIN);
  }
  let look = atHour(eveningDay, 21);
  if (dark && dark > look) look = roundUp(dark, 30);
  if (now > look) look = roundUp(now, 30);
  const nextRise = smallHours ? today.rise : sunTimes(new Date(now.getTime() + DAY), lat, lon).rise;
  let dawn = nextRise ? roundNearest(new Date(nextRise.getTime() - 75 * MIN), 10) : null;
  if (dawn && now > dawn) dawn = roundUp(now, 10);
  if (dawn && look > dawn) look = null; // already morning twilight
  return { observer, eveningDay, set, dark, look, dawn, sunrise: nextRise };
}

// ---------------------------------------------------------------- planets

const PLANET_INFO = {
  Mercury: {
    lookFor: (when) => `A small pinkish dot, low down near where the Sun ${when === 'dawn' ? 'will rise' : 'set'}`,
    fact: 'A year on Mercury lasts only 88 Earth days.',
  },
  Venus: {
    lookFor: () => 'The brightest thing in the sky after the Moon, a dazzling white dot',
    fact: 'Venus spins so slowly that a day there is longer than its whole year.',
  },
  Mars: {
    lookFor: () => 'An orange-red dot',
    fact: 'Mars has the biggest volcano we know of: Olympus Mons, about 2.5 times as tall as Mount Everest.',
  },
  Jupiter: {
    lookFor: () => 'Very bright and creamy white, brighter than any star',
    fact: 'More than 1,300 Earths could fit inside Jupiter.',
  },
  Saturn: {
    lookFor: () => 'A steady creamy-yellow dot that doesn’t twinkle',
    fact: 'Saturn is so light for its size that it would float in a giant bathtub.',
  },
};
const PLANETS = Object.keys(PLANET_INFO);

function relativeTo(p, m) {
  const up = p.alt - m.alt;
  const right = ((p.az - m.az + 540) % 360) - 180; // facing it, larger azimuth is to the right
  const v = up > 2 ? 'above' : up < -2 ? 'below' : '';
  const h = right > 2 ? 'right' : right < -2 ? 'left' : '';
  return [v, h].filter(Boolean).join('-') || 'next to';
}

function chipFor(date, now, morning) {
  if (!morning) return hm(date);
  return sameDay(date, now) ? hm(date) : `${dayName(date)} ${hm(date)}`;
}

function planetRow(name, when, at, now, t) {
  const { observer } = t;
  const pos = position(name, at, observer);
  const info = PLANET_INFO[name];
  let whenText;
  if (when === 'dawn') {
    const rise = Astronomy.SearchRiseSet(name, observer, +1, new Date(at.getTime() - DAY), 1);
    whenText = rise && rise.date < at ? `Rises ${hm(rise.date)} · best just before sunrise` : 'Best just before sunrise';
  } else {
    const rise = Astronomy.SearchRiseSet(name, observer, +1, new Date(at.getTime() - DAY), 1);
    const set = Astronomy.SearchRiseSet(name, observer, -1, at, 1);
    const top = Astronomy.SearchHourAngle(name, observer, 0, rise && rise.date < at ? rise.date : new Date(at.getTime() - 12 * HOUR));
    const span = rise && rise.date < at && set ? `Up ${hm(rise.date)} – ${hm(set.date)}` : set ? `Up until ${hm(set.date)}` : 'Up all night';
    const topBefore = (!set || top.time.date < set.date) && (!t.dark || top.time.date > t.dark);
    whenText = topBefore ? `${span} · highest at ${hm(top.time.date)}, ${top.hor.azimuth > 135 && top.hor.azimuth < 225 ? 'due south' : compassLong(top.hor.azimuth)}` : span;
  }
  let lookFor = info.lookFor(when);
  const moon = position('Moon', at, observer);
  if (moon.alt > 0 && Astronomy.AngleBetween(Astronomy.GeoVector(name, at, true), Astronomy.GeoVector('Moon', at, true)) < 12) {
    lookFor += `, just ${relativeTo(pos, moon)} of the Moon`;
  }
  const chipTime = chipFor(at, now, when === 'dawn');
  return {
    key: name,
    kind: 'planet',
    name,
    chip: chipTime,
    morning: when === 'dawn',
    compass: compassShort(pos.az),
    alt: Math.round(pos.alt),
    mag: Astronomy.Illumination(name, at).mag,
    details: [
      ['When', whenText],
      ['Where', `At ${hm(at)}: ${compassLong(pos.az)}, ${heightWords(pos.alt)}`],
      ['Look for', lookFor],
      ['Far away', farAway(pos.dist)],
    ],
    fact: info.fact,
  };
}

function visible(name, at, observer) {
  if (!at) return false;
  if (position('Sun', at, observer).alt > -6) return false;
  const p = position(name, at, observer);
  return p.alt >= 8 && Astronomy.Illumination(name, at).mag <= 1.6;
}

/** Planets to look for this evening, then (if not up in the evening) before sunrise. */
export function planetRows(now, t) {
  const rows = [];
  for (const name of PLANETS) {
    if (visible(name, t.look, t.observer)) rows.push(planetRow(name, 'evening', t.look, now, t));
    else if (visible(name, t.dawn, t.observer)) rows.push(planetRow(name, 'dawn', t.dawn, now, t));
  }
  // evening first, then morning; brightest first within each
  return rows.sort((a, b) => (a.morning - b.morning) || (a.mag - b.mag));
}

// ---------------------------------------------------------------- constellations

// ra in hours, dec in degrees (a point in the middle of the shape).
// icon: points in a 40 x 40 box, lines joining them.
export const CONSTELLATIONS = [
  {
    key: 'Dipper', name: 'Big Dipper', ra: 11.0, dec: 56,
    lookFor: 'Seven stars shaped like a saucepan', far: 'Most of its stars are about 80 light-years away',
    fact: 'Follow the two stars at the end of the pan upwards and they point to Polaris, the North Star.',
    icon: { p: [[5, 15], [12, 13], [18, 15], [23, 19], [24, 27], [33, 28], [33, 19]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  },
  {
    key: 'Orion', name: 'Orion', ra: 5.6, dec: 2,
    lookFor: 'Three stars in a row (Orion’s Belt), with orange Betelgeuse above and blue-white Rigel below',
    far: 'Betelgeuse about 550 light-years · Rigel about 860',
    fact: 'Betelgeuse is so huge that if it took the Sun’s place, it would reach out past Mars.',
    icon: { p: [[12, 6], [28, 8], [17, 20], [20, 19], [23, 18], [11, 33], [29, 32]], l: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
  },
  {
    key: 'Cassiopeia', name: 'Cassiopeia', ra: 0.95, dec: 60.5,
    lookFor: 'Five stars in a big “W” (or “M”, depending on the time)', far: 'Its stars are 50 to 600 light-years away',
    fact: 'From the Netherlands Cassiopeia never sets: you can find it on every clear night of the year.',
    icon: { p: [[6, 15], [13, 26], [20, 17], [27, 25], [34, 13]], l: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  },
  {
    key: 'Triangle', name: 'Summer Triangle', ra: 19.7, dec: 31,
    lookFor: 'Three bright stars making a huge triangle: Vega (brightest), Deneb and Altair',
    far: 'Altair 17 light-years · Vega 25 · Deneb about 2,600',
    fact: 'Altair spins so fast, once every 9 hours, that it’s squashed into an egg shape.',
    icon: { p: [[12, 11], [30, 13], [20, 31]], l: [[0, 1], [1, 2], [2, 0]], big: [0, 1, 2] },
  },
  {
    key: 'Pleiades', name: 'Pleiades', ra: 3.79, dec: 24.1,
    lookFor: 'A tiny, misty cluster of stars, like a mini dipper', far: 'About 440 light-years',
    fact: 'Most people can see 6 or 7 stars, but the cluster has more than 1,000.',
    icon: { p: [[15, 15], [21, 13], [25, 18], [19, 21], [14, 24], [24, 25], [29, 22]], l: [], small: true },
  },
  {
    key: 'Pegasus', name: 'Pegasus', ra: 23.3, dec: 22,
    lookFor: 'The Great Square: four stars making a big, almost empty box', far: 'The Square’s stars are about 100 to 400 light-years away',
    fact: 'One corner of the Great Square, the star Alpheratz, actually belongs to Andromeda.',
    icon: { p: [[12, 12], [28, 12], [28, 28], [12, 28], [6, 34]], l: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]] },
  },
  {
    key: 'Leo', name: 'Leo', ra: 10.5, dec: 15,
    lookFor: 'A backwards question mark (the lion’s head) with a triangle for its tail', far: 'Its brightest star, Regulus, is about 79 light-years away',
    fact: 'The Leonid shooting stars every November seem to come from Leo.',
    icon: { p: [[10, 26], [9, 18], [13, 11], [19, 10], [21, 17], [32, 20], [31, 28]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]] },
  },
  {
    key: 'Gemini', name: 'Gemini', ra: 7.3, dec: 22,
    lookFor: 'Two bright stars side by side, Castor and Pollux: the twins', far: 'Pollux 34 light-years · Castor 51',
    fact: 'Castor looks like one star, but it is really six stars circling each other.',
    icon: { p: [[13, 7], [25, 9], [12, 21], [24, 22], [10, 33], [22, 34]], l: [[0, 2], [2, 4], [1, 3], [3, 5]], big: [0, 1] },
  },
  {
    key: 'Taurus', name: 'Taurus', ra: 4.6, dec: 16.5,
    lookFor: 'A V-shape of stars, with orange Aldebaran as the bull’s eye', far: 'Aldebaran is about 65 light-years away',
    fact: 'The V of the bull’s face is a star cluster, the Hyades: the closest star cluster to us.',
    icon: { p: [[20, 30], [13, 20], [9, 10], [24, 22], [31, 11]], l: [[0, 1], [1, 2], [0, 3], [3, 4]], big: [3] },
  },
  {
    key: 'Auriga', name: 'Auriga', ra: 5.28, dec: 46,
    lookFor: 'A big five-sided shape with bright yellow Capella', far: 'Capella is about 43 light-years away',
    fact: 'Capella looks like one star, but it is really two giant stars circling each other.',
    icon: { p: [[20, 6], [32, 16], [28, 31], [12, 31], [8, 16]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]], big: [0] },
  },
  {
    key: 'Andromeda', name: 'Andromeda', ra: 0.8, dec: 38,
    lookFor: 'A line of stars running from one corner of the Great Square', far: 'The Andromeda Galaxy next to it: 2.5 million light-years',
    fact: 'The Andromeda Galaxy is the farthest thing you can see with just your eyes, on a dark night without the Moon.',
    icon: { p: [[8, 30], [17, 23], [26, 17], [34, 9], [21, 13]], l: [[0, 1], [1, 2], [2, 3], [1, 4]] },
  },
  {
    key: 'Perseus', name: 'Perseus', ra: 3.4, dec: 45,
    lookFor: 'A curved line of stars below Cassiopeia’s “W”', far: 'Its brightest star, Mirfak, is about 500 light-years away',
    fact: 'The Perseid shooting stars every August seem to come from Perseus, which is how they got their name.',
    icon: { p: [[28, 7], [25, 14], [21, 20], [18, 27], [12, 33], [27, 24]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]] },
  },
  {
    key: 'Bootes', name: 'Boötes', ra: 14.7, dec: 27,
    lookFor: 'A kite shape, with bright orange Arcturus at the bottom', far: 'Arcturus is about 37 light-years away',
    fact: 'Follow the curve of the Big Dipper’s handle and you “arc to Arcturus”.',
    icon: { p: [[20, 34], [13, 22], [15, 10], [23, 5], [28, 15], [26, 24]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], big: [0] },
  },
  {
    key: 'Polaris', name: 'North Star', ra: 2.53, dec: 89.26,
    lookFor: 'A medium-bright star on its own, at the end of the Little Dipper’s handle', far: 'About 430 light-years',
    fact: 'Polaris sits almost exactly above the North Pole, so it stays in the same spot all night.',
    icon: { p: [[20, 8], [17, 15], [14, 21], [12, 28], [20, 30], [21, 23], [13, 21]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 2]], big: [0] },
  },
];

/**
 * Constellations well up (at least 25 degrees) in the dark part of
 * 19:00 - 24:00, in a fixed "easiest first" order, at most `limit`.
 */
export function constellationRows(t, limit = 7) {
  const hours = [];
  for (let h = 19; h <= 24; h++) {
    const d = atHour(t.eveningDay, h);
    hours.push({ h, d, sun: position('Sun', d, t.observer).alt });
  }
  let dark = hours.filter((x) => x.sun < -9);
  if (!dark.length) dark = hours.filter((x) => x.sun < -6);
  if (!dark.length) return [];
  const out = [];
  for (const c of CONSTELLATIONS) {
    const pts = dark.map((x) => ({ ...x, ...starPosition(c.ra, c.dec, x.d, t.observer) }));
    const maxAlt = Math.max(...pts.map((p) => p.alt));
    if (maxAlt < (c.key === 'Dipper' ? 18 : 25)) continue; // the Big Dipper is famous enough to show even when low
    // earliest time that's about as good (45 degrees up is plenty)
    const best = pts.find((p) => p.alt >= Math.min(maxAlt - 3, 45));
    const first = pts[0];
    const last = pts[pts.length - 1];
    const top = pts.find((p) => p.alt === maxAlt);
    const label = (p) => (p.h === 24 ? 'midnight' : `${p.h}:00`);
    const range = maxAlt - Math.min(...pts.map((p) => p.alt));
    let when;
    if (range < 10) when = 'Up all evening';
    else if (top === first) when = `Best soon after dark (about ${hm(first.d)}), then sinking toward the ${compassLong(last.az)}`;
    else if (top === last) when = `Rising all evening, highest around ${label(last)}`;
    else when = `Up all evening · highest around ${label(top)}`;
    out.push({
      key: c.key,
      kind: 'constellation',
      name: c.name,
      chip: best.h === 24 ? '00:00' : `${String(best.h).padStart(2, '0')}:00`,
      morning: false,
      compass: compassShort(best.az),
      alt: Math.round(best.alt),
      icon: c.icon,
      details: [
        ['When', when],
        ['Where', `At ${best.h === 24 ? 'midnight' : `${best.h}:00`}: ${compassLong(best.az)}, ${heightWords(best.alt)}`],
        ['Look for', c.lookFor],
        ['Far away', c.far],
      ],
      fact: c.fact,
    });
  }
  // easiest first, but ones you can only see late (23:00 or after) move down a few places
  const late = (r) => (r.chip === '00:00' || r.chip >= '23:00' ? 5 : 0);
  return out.map((r, i) => ({ r, k: CONSTELLATIONS.findIndex((c) => c.key === r.key) + late(r), i }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i)).map((x) => x.r).slice(0, limit)
    // then show them in time order (midnight last)
    .map((r, i) => ({ r, i })).sort((a, b) => a.r.chip.replace(/^00/, '24').localeCompare(b.r.chip.replace(/^00/, '24')) || (a.i - b.i))
    .map((x) => x.r);
}

// ---------------------------------------------------------------- highlight

/**
 * The one thing most worth seeing tonight, or null:
 * an eclipse, a meteor shower peak, the Moon beside a planet, two planets
 * close together, a full or new moon.
 */
export function highlight(now, t, planets) {
  const { observer } = t;
  const end = t.sunrise || new Date(now.getTime() + DAY);
  for (const e of eclipses(new Date(now.getTime() - 6 * HOUR), observer, 1)) {
    if (e.date >= new Date(now.getTime() - 3 * HOUR) && e.date <= end) {
      return e.kind === 'solar'
        ? { kind: 'eclipse', text: `Partial solar eclipse at ${hm(e.date)}, ${e.covered}% of the Sun covered. Never look without eclipse glasses!` }
        : { kind: 'eclipse', text: `${e.type === 'total' ? 'Total' : 'Partial'} eclipse of the Moon, best at ${hm(e.date)}` };
    }
  }
  const shower = meteorShower(now);
  if (shower && shower.days >= -1 && shower.days <= 1) {
    const name = shower.name.replace(/s$/, '');
    const when = shower.days === 0 ? 'peak tonight' : shower.days < 0 ? 'are still busy tonight' : 'peak tomorrow night';
    return { kind: 'meteor', text: `${name} shooting stars ${when}: up to ${shower.perHour} an hour after midnight` };
  }
  if (t.look) {
    const moon = position('Moon', t.look, observer);
    if (moon.alt > 5) {
      for (const p of planets.filter((x) => !x.morning)) {
        const sep = Astronomy.AngleBetween(Astronomy.GeoVector(p.key, t.look, true), Astronomy.GeoVector('Moon', t.look, true));
        if (sep < 12) {
          return { kind: 'moon-planet', planet: p.key, text: `the Moon and ${p.name} side by side, ${p.compass} at ${hm(t.look)}` };
        }
      }
    }
  }
  for (const group of [planets.filter((x) => !x.morning), planets.filter((x) => x.morning)]) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const at = group[i].morning ? t.dawn : t.look;
        const sep = Astronomy.AngleBetween(Astronomy.GeoVector(group[i].key, at, true), Astronomy.GeoVector(group[j].key, at, true));
        if (sep < 6) return { kind: 'pair', text: `${group[i].name} and ${group[j].name} close together, ${group[i].compass} at ${group[i].chip}` };
      }
    }
  }
  const ill = Astronomy.Illumination('Moon', now);
  const rise = Astronomy.SearchRiseSet('Moon', observer, +1, atHour(t.eveningDay, 12), 1);
  if (ill.phase_fraction > 0.97 && rise) return { kind: 'moon', text: `Full Moon tonight, rising at ${hm(rise.date)} in the ${compassLong(position('Moon', rise.date, observer).az)}` };
  if (ill.phase_fraction < 0.03) return { kind: 'moon', text: 'No Moon tonight: the darkest night of the month for spotting stars' };
  return null;
}

/** True when a bright Moon (more than half lit) is up in the evening. */
export function brightMoon(t) {
  if (!t.look) return false;
  const frac = Astronomy.Illumination('Moon', t.look).phase_fraction;
  return frac > 0.5 && position('Moon', t.look, t.observer).alt > 0;
}

// ---------------------------------------------------------------- clouds

/**
 * One line about tonight's clouds from Open-Meteo hourly cloud cover
 * ([{ time: 'YYYY-MM-DDTHH:00' (local), cloud: % }]). Returns
 * { text, good } or null when there's no forecast.
 */
export function cloudLine(clouds, t) {
  if (!Array.isArray(clouds) || !clouds.length) return null;
  const byKey = new Map(clouds.map((c) => [c.time, c.cloud]));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
  const night = (day) => {
    const out = [];
    for (let h = 20; h <= 24; h++) {
      const d = atHour(day, h);
      const v = byKey.get(key(d));
      if (typeof v === 'number') out.push({ d, v });
    }
    return out;
  };
  const tonight = night(t.eveningDay);
  if (tonight.length < 3) return null;
  const clear = (x) => x.v <= 35;
  const cloudy = (x) => x.v >= 70;
  const avg = tonight.reduce((s, x) => s + x.v, 0) / tonight.length;
  if (tonight.every(clear)) return { text: 'Clear tonight', sub: 'good night to look up', good: true };
  if (tonight.every(cloudy) || avg >= 75) {
    for (let i = 1; i <= 3; i++) {
      const n = night(new Date(t.eveningDay.getTime() + i * DAY));
      if (n.length >= 3 && n.reduce((s, x) => s + x.v, 0) / n.length <= 40) {
        return { text: 'Cloudy tonight', sub: `clearer on ${atHour(new Date(t.eveningDay.getTime() + i * DAY), 12).toLocaleDateString('en-GB', { weekday: 'long' })}`, good: false };
      }
    }
    return { text: 'Cloudy tonight', sub: 'stars hidden', good: false };
  }
  const firstClear = tonight.findIndex(clear);
  if (firstClear > 0 && tonight.slice(firstClear).every((x) => x.v <= 50)) {
    return { text: `Clear after ${hm(tonight[firstClear].d)}`, sub: 'good night to look up', good: true };
  }
  const firstCloudy = tonight.findIndex(cloudy);
  if (firstCloudy > 0 && tonight.slice(0, firstCloudy).every(clear)) {
    return { text: `Clear until ${hm(tonight[firstCloudy].d)}`, sub: 'then cloudy', good: true };
  }
  return { text: 'Partly cloudy tonight', sub: 'look between the clouds', good: avg < 55 };
}

// ---------------------------------------------------------------- Space Station

const ISS_INFO = {
  lookFor: 'A bright “star” moving fast and steadily. Planes blink; the Station doesn’t',
  fact: 'It goes round the Earth every 90 minutes, so the astronauts see about 16 sunrises a day.',
};
const EARTH_KM = 6371;

function lookAt(satrec, date, observerGd) {
  const pv = Sat.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const gmst = Sat.gstime(date);
  const ecf = Sat.eciToEcf(pv.position, gmst);
  const look = Sat.ecfToLookAngles(observerGd, ecf);
  return { el: look.elevation * 180 / Math.PI, az: look.azimuth * 180 / Math.PI, eci: pv.position, gmst };
}

function sunlit(eci, date) {
  // Cylindrical Earth-shadow test with the Sun's direction from Astronomy Engine.
  const s = Astronomy.GeoVector('Sun', date, true);
  const len = Math.hypot(s.x, s.y, s.z);
  const u = { x: s.x / len, y: s.y / len, z: s.z / len };
  const dot = eci.x * u.x + eci.y * u.y + eci.z * u.z;
  if (dot > 0) return true;
  const perp = Math.hypot(eci.x - dot * u.x, eci.y - dot * u.y, eci.z - dot * u.z);
  return perp > EARTH_KM;
}

/**
 * Visible Space Station passes between `from` and `to`: it must climb above
 * 20 degrees, be lit by the Sun while the sky here is dark (Sun below -6).
 * tle = [line1, line2].
 */
export function issPasses(tle, from, to, lat, lon) {
  let satrec;
  try {
    satrec = Sat.twoline2satrec(tle[0], tle[1]);
  } catch (e) {
    return [];
  }
  const gd = { latitude: lat * Math.PI / 180, longitude: lon * Math.PI / 180, height: 0 };
  const observer = new Astronomy.Observer(lat, lon, 0);
  const passes = [];
  let cur = null;
  for (let ms = from.getTime(); ms <= to.getTime(); ms += 20000) {
    const d = new Date(ms);
    const l = lookAt(satrec, d, gd);
    if (!l) return passes;
    if (l.el >= 10) {
      if (!cur) cur = { start: d, startAz: l.az, max: l, maxAt: d };
      if (l.el > cur.max.el) { cur.max = l; cur.maxAt = d; }
      cur.end = d;
      cur.endAz = l.az;
    } else if (cur) {
      passes.push(cur);
      cur = null;
    }
  }
  if (cur) passes.push(cur);
  return passes.filter((p) => {
    if (p.max.el < 20) return false;
    if (position('Sun', p.maxAt, observer).alt > -6) return false;
    return sunlit(p.max.eci, p.maxAt);
  }).map((p) => {
    const geo = Sat.eciToGeodetic(p.max.eci, p.max.gmst);
    return {
      start: p.start, end: p.end, maxAt: p.maxAt, maxEl: Math.round(p.max.el),
      startAz: p.startAz, endAz: p.endAz, maxAz: p.max.az, heightKm: Math.round(geo.height / 10) * 10,
    };
  });
}

export function issRow(pass, now) {
  const mins = Math.max(1, Math.round((pass.end - pass.start) / MIN));
  const morning = !sameDay(pass.start, now) || pass.start.getHours() < 12;
  return {
    key: 'Iss',
    kind: 'iss',
    name: 'Space Station',
    chip: chipFor(pass.start, now, morning),
    morning,
    compass: `${compassShort(pass.startAz)}→${compassShort(pass.endAz)}`,
    alt: pass.maxEl,
    details: [
      ['When', `${hm(pass.start)} – ${hm(pass.end)} · about ${mins} min`],
      ['Where', `Appears in the ${compassLong(pass.startAz)}, ${heightWords(pass.maxEl)} in the ${compassLong(pass.maxAz)}, then fades in the ${compassLong(pass.endAz)}`],
      ['Look for', ISS_INFO.lookFor],
      ['Far away', `About ${pass.heightKm} km up, flying at 28,000 km/h`],
    ],
    fact: ISS_INFO.fact,
  };
}

// ---------------------------------------------------------------- everything

let passCache = { key: null, passes: [] };

/**
 * The whole "Sky" tab: { times, cloud, highlight, rows: planets (+ISS),
 * constellations, brightMoon }. tle and clouds are optional.
 */
export function skyTonight(now, lat, lon, { tle = null, clouds = null } = {}) {
  const t = nightTimes(now, lat, lon);
  const planets = planetRows(now, t);
  const rows = [...planets];
  if (tle && t.sunrise) {
    // work the night's passes out once (noon to sunrise), then just pick the next one
    const from = atHour(t.eveningDay, 12);
    const key = `${tle[0]}|${tle[1]}|${from.getTime()}|${t.sunrise.getTime()}|${lat}|${lon}`;
    if (passCache.key !== key) passCache = { key, passes: issPasses(tle, from, t.sunrise, lat, lon) };
    const pass = passCache.passes.find((p) => p.end > now);
    if (pass) {
      const row = issRow(pass, now);
      const idx = rows.findIndex((r) => r.morning);
      rows.splice(row.morning ? rows.length : (idx < 0 ? rows.length : idx), 0, row);
    }
  }
  return {
    times: t,
    cloud: cloudLine(clouds, t),
    highlight: highlight(now, t, planets),
    planets: rows,
    constellations: constellationRows(t),
    brightMoon: brightMoon(t),
  };
}

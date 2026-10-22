// Works out the dates of the main Hindu festivals, the way North Indian
// panchangs do: from the lunar month, paksha and tithi in force at the
// moment of day each festival is tied to (sunrise, midday, afternoon,
// evening, moonrise or midnight), calculated for New Delhi.
//
// Dates can occasionally differ by a day from a particular temple's or
// family's calendar (some observances have extra local rules). Dates listed
// in config/festivals.json always win over calculated ones.

import * as SunCalc from '../vendor/suncalc.js';
import * as Astronomy from '../vendor/astronomy.js';
import { ayanamsa } from './sky.js';

const DELHI = { lat: 28.6139, lon: 77.209, offsetMin: 330 };
const DAY = 86400000;
const norm = (d) => ((d % 360) + 360) % 360;

// amanta month index: 0 Chaitra … 11 Phalguna. Tithi index 0–29
// (0–14 Shukla Pratipada…Purnima, 15–29 Krishna Pratipada…Amavasya).
// `at`: which moment of the day decides it.
export const RULES = [
  { name: 'Vasant Panchami', month: 10, tithi: 4, at: 'purvahna' },
  { name: 'Maha Shivaratri', month: 10, tithi: 28, at: 'nishita' },
  { name: 'Holika Dahan', month: 11, tithi: 14, at: 'pradosh', bhadra: true },
  // Holika Dahan waits for Bhadra (Vishti karana) to end; Holi is the next day
  { name: 'Holi', month: 11, tithi: 14, at: 'pradosh', bhadra: true, shift: 1 },
  { name: 'Chaitra Navratri begins', month: 0, tithi: 0, at: 'sunrise' },
  { name: 'Ram Navami', month: 0, tithi: 8, at: 'madhyahna' },
  { name: 'Hanuman Jayanti', month: 0, tithi: 14, at: 'sunrise' },
  { name: 'Akshaya Tritiya', month: 1, tithi: 2, at: 'purvahna' },
  { name: 'Guru Purnima', month: 3, tithi: 14, at: 'sunrise' },
  // if Purnima still holds well into the next morning, it's kept that day
  { name: 'Raksha Bandhan', month: 4, tithi: 14, at: 'aparahna', nextMorning: true },
  { name: 'Janmashtami', month: 4, tithi: 22, at: 'nishita' },
  { name: 'Ganesh Chaturthi', month: 5, tithi: 3, at: 'madhyahna' },
  { name: 'Navratri begins', month: 6, tithi: 0, at: 'sunrise' },
  { name: 'Dussehra', month: 6, tithi: 9, at: 'aparahna' },
  { name: 'Sharad Purnima', month: 6, tithi: 14, at: 'moonrise' },
  { name: 'Karva Chauth', month: 6, tithi: 18, at: 'moonrise' },
  { name: 'Ahoi Ashtami', month: 6, tithi: 22, at: 'pradosh' },
  { name: 'Dhanteras', month: 6, tithi: 27, at: 'pradosh' },
  { name: 'Diwali', month: 6, tithi: 29, at: 'pradosh' },
  { name: 'Govardhan Puja', month: 7, tithi: 0, at: 'sunrise' },
  { name: 'Bhai Dooj', month: 7, tithi: 1, at: 'aparahna' },
  { name: 'Chhath Puja', month: 7, tithi: 5, at: 'sunrise' },
  { name: 'Tulsi Vivah', month: 7, tithi: 11, at: 'sunrise' },
  { name: 'Vivah Panchami', month: 8, tithi: 4, at: 'sunrise' },
  { name: 'Gita Jayanti', month: 8, tithi: 10, at: 'sunrise' },
];

function siderealSun(date) {
  return norm(Astronomy.SunPosition(date).elon - ayanamsa(date));
}

const pad = (n) => String(n).padStart(2, '0');
// India calendar date of an instant
function istKey(date) {
  const t = new Date(date.getTime() + DELHI.offsetMin * 60000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function istNoon(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) - DELHI.offsetMin * 60000);
}
function addKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** New moons covering [from, to], with each lunar month's name. */
function lunarMonths(from, to) {
  const moons = [];
  let t = Astronomy.SearchMoonPhase(0, new Date(from.getTime() - 32 * DAY), 40).date;
  while (t < new Date(to.getTime() + 35 * DAY)) {
    moons.push(t);
    t = Astronomy.SearchMoonPhase(0, new Date(t.getTime() + DAY), 40).date;
  }
  const months = [];
  for (let i = 0; i + 1 < moons.length; i++) {
    const sign = Math.floor(siderealSun(moons[i]) / 30);
    const nextSign = Math.floor(siderealSun(moons[i + 1]) / 30);
    months.push({ start: moons[i], end: moons[i + 1], index: (sign + 1) % 12, adhika: sign === nextSign });
  }
  return months;
}

/** Tithi (0–29) and amanta month at an instant. */
function stateAt(date, months) {
  const m = months.find((x) => x.start <= date && date < x.end);
  return {
    tithi: Math.floor(Astronomy.MoonPhase(date) / 12),
    month: m ? m.index : -1,
    adhika: m ? m.adhika : false,
  };
}

function momentsFor(key) {
  const noon = istNoon(key);
  const t = SunCalc.getTimes(noon, DELHI.lat, DELHI.lon, 0, DELHI.offsetMin);
  const next = SunCalc.getTimes(new Date(noon.getTime() + DAY), DELHI.lat, DELHI.lon, 0, DELHI.offsetMin);
  const rise = t.sunrise.getTime();
  const set = t.sunset.getTime();
  const span = set - rise;
  const m = SunCalc.getMoonTimes(noon, DELHI.lat, DELHI.lon, DELHI.offsetMin);
  return {
    sunrise: new Date(rise + 60000),
    morning: new Date(rise + 144 * 60000), // three muhurtas after sunrise
    purvahna: new Date(rise + span * 0.3),
    madhyahna: new Date(rise + span * 0.5),
    aparahna: new Date(rise + span * 0.7),
    pradosh: new Date(set + 60 * 60000),
    moonrise: m.rise ? new Date(m.rise.getTime() + 60000) : new Date(set + 3 * 3600000),
    nishita: new Date((set + next.sunrise.getTime()) / 2),
  };
}

/** Makar Sankranti: the sun enters sidereal Capricorn (270°). */
function makarSankranti(year) {
  let lo = new Date(Date.UTC(year, 0, 10)).getTime();
  let hi = new Date(Date.UTC(year, 0, 18)).getTime();
  const past = (ms) => norm(siderealSun(new Date(ms)) - 270) < 180;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (past(mid)) hi = mid; else lo = mid;
  }
  const ingress = new Date(hi);
  let key = istKey(ingress);
  const set = SunCalc.getTimes(istNoon(key), DELHI.lat, DELHI.lon, 0, DELHI.offsetMin).sunset;
  if (ingress > set) key = addKey(key, 1); // after sunset: observed the next day
  return key;
}

// Bhadra = the Vishti karana. If it covers the evening and doesn't end
// before midnight, Holika Dahan moves to the next evening.
function isVishti(date) {
  const k = Math.floor(Astronomy.MoonPhase(date) / 6);
  return k >= 1 && k <= 56 && (k - 1) % 7 === 6;
}
function bhadraPastMidnight(key) {
  const mom = momentsFor(key);
  if (!isVishti(mom.pradosh)) return false;
  return isVishti(mom.nishita);
}

/**
 * Festivals between two dates (inclusive), as [{ date: 'YYYY-MM-DD', name }].
 */
export function festivalsBetween(fromDate, toDate) {
  const fromKey = istKey(fromDate);
  const toKey = istKey(toDate);
  const months = lunarMonths(istNoon(addKey(fromKey, -3)), istNoon(addKey(toKey, 3)));
  const cache = new Map();
  const dayState = (key) => {
    if (!cache.has(key)) {
      const mom = momentsFor(key);
      const s = {};
      for (const [k, v] of Object.entries(mom)) s[k] = stateAt(v, months);
      cache.set(key, s);
    }
    return cache.get(key);
  };

  const out = [];
  const keysIn = (m) => {
    const keys = [];
    for (let k = addKey(istKey(m.start), -1); k <= addKey(istKey(m.end), 1); k = addKey(k, 1)) keys.push(k);
    return keys;
  };
  const holds = (st, rule) => st.tithi === rule.tithi && st.month === rule.month && !st.adhika;

  for (const rule of RULES) {
    for (const m of months) {
      if (m.index !== rule.month || m.adhika) continue;
      const keys = keysIn(m);
      // 1) the day the tithi is in force at the festival's own moment
      let day = keys.find((k) => holds(dayState(k)[rule.at], rule));
      // 2) otherwise the day it's in force at sunrise
      if (!day) day = keys.find((k) => holds(dayState(k).sunrise, rule));
      // 3) otherwise (a very short tithi) the day it begins
      if (!day) {
        day = keys.find((k) => {
          const a = dayState(k).sunrise;
          const b = dayState(addKey(k, 1)).sunrise;
          return (a.tithi + 1) % 30 === rule.tithi && b.tithi === (rule.tithi + 1) % 30;
        });
      }
      if (!day) continue;
      if (rule.nextMorning && holds(dayState(addKey(day, 1)).morning, rule)) day = addKey(day, 1);
      if (rule.bhadra && bhadraPastMidnight(day)) day = addKey(day, 1);
      const date = rule.shift ? addKey(day, rule.shift) : day;
      if (date < fromKey || date > toKey) continue;
      if (out.some((f) => f.name === rule.name && f.date === date)) continue;
      out.push({ date, name: rule.name });
    }
  }
  for (let y = Number(fromKey.slice(0, 4)); y <= Number(toKey.slice(0, 4)); y++) {
    const ms = makarSankranti(y);
    const lohri = addKey(ms, -1);
    if (ms >= fromKey && ms <= toKey) out.push({ date: ms, name: 'Makar Sankranti' });
    if (lohri >= fromKey && lohri <= toKey) out.push({ date: lohri, name: 'Lohri' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculated festivals, with the hand-checked list taking priority: a listed
 * festival replaces a calculated one of the same name within 10 days.
 */
export function mergeFestivals(calculated, listed) {
  const near = (a, b) => Math.abs(istNoon(a) - istNoon(b)) <= 10 * DAY;
  const kept = calculated.filter((c) => !listed.some((l) => l.name === c.name && near(l.date, c.date)));
  return [...kept, ...listed].sort((a, b) => a.date.localeCompare(b.date));
}

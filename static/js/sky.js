// Sun, moon and panchang calculations. Everything here runs locally in the
// browser; no network needed. Times are JavaScript Date objects.
//
// Panchang notes
//  * Tithi, nakshatra, yoga and karana are taken at local sunrise.
//  * Sidereal positions use the Lahiri ayanamsa (linear approximation, good
//    to well under a minute of arc for this century).
//  * Lunar months: amanta month is named from the sun's sidereal sign at the
//    new moon that starts it; purnimanta shifts Krishna paksha to the next
//    month name. A month whose new moon and the next fall in the same sign is
//    Adhika (extra).

import * as SunCalc from '../vendor/suncalc.js';
import * as Astronomy from '../vendor/astronomy.js';

const DAY_MS = 86400000;

export const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami',
  'Ashtami', 'Navami', 'Dashami', 'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi',
];
export const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya',
  'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati',
  'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana',
  'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];
export const YOGAS = [
  'Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti',
  'Shula', 'Ganda', 'Vriddhi', 'Dhruva', 'Vyaghata', 'Harshana', 'Vajra', 'Siddhi', 'Vyatipata',
  'Variyana', 'Parigha', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra', 'Vaidhriti',
];
export const RASHIS = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
];
// Index 0 = Chaitra
export const MONTHS = [
  'Chaitra', 'Vaishakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada',
  'Ashvin', 'Kartika', 'Margashirsha', 'Pausha', 'Magha', 'Phalguna',
];
const RITUS = ['Vasanta', 'Grishma', 'Varsha', 'Sharad', 'Hemanta', 'Shishira'];
const MOVABLE_KARANAS = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija', 'Vishti (Bhadra)'];
// Ekadashi names by amanta month: [Shukla, Krishna]
const EKADASHI = [
  ['Kamada', 'Varuthini'], ['Mohini', 'Apara'], ['Nirjala', 'Yogini'], ['Devshayani', 'Kamika'],
  ['Shravana Putrada', 'Aja'], ['Parsva', 'Indira'], ['Papankusha', 'Rama'], ['Prabodhini', 'Utpanna'],
  ['Mokshada', 'Saphala'], ['Pausha Putrada', 'Shattila'], ['Jaya', 'Vijaya'], ['Amalaki', 'Papmochani'],
];
const ADHIKA_EKADASHI = ['Padmini', 'Parama'];
// Rahu Kaal: which eighth of the daytime (1-8), by weekday (0 = Sunday)
const RAHU_SEGMENT = [8, 2, 7, 5, 6, 4, 3];

const norm = (deg) => ((deg % 360) + 360) % 360;
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const utcOffsetOf = (d) => -d.getTimezoneOffset();

export function localNoon(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

export function ayanamsa(date) {
  const years = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / (365.25 * DAY_MS);
  return 23.857 + 0.013969 * years; // Lahiri
}

function siderealSun(date) {
  return norm(Astronomy.SunPosition(date).elon - ayanamsa(date));
}
function siderealMoon(date) {
  return norm(Astronomy.EclipticGeoMoon(date).lon - ayanamsa(date));
}

// ---------------------------------------------------------------- sun & moon

export function sunTimes(day, lat, lon) {
  const noon = localNoon(day);
  const t = SunCalc.getTimes(noon, lat, lon, 0, utcOffsetOf(noon));
  const daylight = t.sunrise && t.sunset ? Math.round((t.sunset - t.sunrise) / 60000) : null;
  return {
    rise: t.sunrise, set: t.sunset, dawn: t.dawn, dusk: t.dusk,
    noon: t.solarNoon, goldenHour: t.goldenHour, daylightMin: daylight,
  };
}

export function moonTimes(day, lat, lon) {
  const noon = localNoon(day);
  const m = SunCalc.getMoonTimes(noon, lat, lon, utcOffsetOf(noon));
  return { rise: m.rise || null, set: m.set || null, alwaysUp: !!m.alwaysUp, alwaysDown: !!m.alwaysDown };
}

export function moonPhaseName(fraction, waxing) {
  if (fraction < 0.03) return 'new moon';
  if (fraction > 0.97) return 'full moon';
  if (fraction > 0.45 && fraction < 0.55) return waxing ? 'first quarter' : 'last quarter';
  if (fraction < 0.5) return waxing ? 'waxing crescent' : 'waning crescent';
  return waxing ? 'waxing gibbous' : 'waning gibbous';
}

export function moonInfo(now, lat, lon) {
  const ill = SunCalc.getMoonIllumination(now);
  const waxing = ill.phase < 0.5;
  const evening = new Date(now);
  evening.setHours(21, 0, 0, 0);
  const upEvening = SunCalc.getMoonPosition(evening, lat, lon).altitude > 0;
  return {
    fraction: ill.fraction,
    waxing,
    phaseName: moonPhaseName(ill.fraction, waxing),
    rashi: RASHIS[Math.floor(siderealMoon(now) / 30)],
    upEvening,
    nextFull: Astronomy.SearchMoonPhase(180, now, 40).date,
    nextNew: Astronomy.SearchMoonPhase(0, now, 40).date,
  };
}

// SVG path of the lit part of the moon (northern hemisphere view).
export function moonLitPath(fraction, waxing, cx, cy, r) {
  const f = Math.min(1, Math.max(0, fraction));
  const k = Math.abs(2 * f - 1) * r;
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  if (f >= 0.995) return `M ${top} A ${r} ${r} 0 1 1 ${bottom} A ${r} ${r} 0 1 1 ${top} Z`;
  if (f <= 0.005) return '';
  if (waxing) {
    const sweep = f >= 0.5 ? 1 : 0;
    return `M ${top} A ${r} ${r} 0 0 1 ${bottom} A ${k.toFixed(2)} ${r} 0 0 ${sweep} ${top} Z`;
  }
  const sweep = f >= 0.5 ? 0 : 1;
  return `M ${top} A ${r} ${r} 0 0 0 ${bottom} A ${k.toFixed(2)} ${r} 0 0 ${sweep} ${top} Z`;
}

// ---------------------------------------------------------------- panchang

function lunarMonthAt(date) {
  // most recent new moon at or before `date`
  let nm = Astronomy.SearchMoonPhase(0, addDays(date, -31), 32).date;
  for (;;) {
    const next = Astronomy.SearchMoonPhase(0, addDays(nm, 1), 32).date;
    if (next > date) {
      const sign = Math.floor(siderealSun(nm) / 30);
      const nextSign = Math.floor(siderealSun(next) / 30);
      return { index: (sign + 1) % 12, adhika: sign === nextSign, start: nm };
    }
    nm = next;
  }
}

export function panchang(day, lat, lon, monthSystem = 'purnimanta') {
  const sun = sunTimes(day, lat, lon);
  let at = sun.rise;
  if (!at) {
    at = new Date(day);
    at.setHours(6, 0, 0, 0);
  }
  const elong = Astronomy.MoonPhase(at); // 0..360, moon minus sun
  const tithiIdx = Math.floor(elong / 12); // 0..29
  const shukla = tithiIdx < 15;
  let tithi;
  if (tithiIdx === 14) tithi = 'Purnima';
  else if (tithiIdx === 29) tithi = 'Amavasya';
  else tithi = TITHI_NAMES[tithiIdx % 15];

  const sunSid = siderealSun(at);
  const moonSid = siderealMoon(at);
  const nakshatra = NAKSHATRAS[Math.floor(moonSid / (360 / 27))];
  const yoga = YOGAS[Math.floor(norm(sunSid + moonSid) / (360 / 27))];
  const k = Math.floor(elong / 6); // 0..59
  let karana;
  if (k === 0) karana = 'Kimstughna';
  else if (k >= 57) karana = ['Shakuni', 'Chatushpada', 'Naga'][k - 57];
  else karana = MOVABLE_KARANAS[(k - 1) % 7];

  const lm = lunarMonthAt(at);
  let monthIdx = lm.index;
  let adhika = lm.adhika;
  if (monthSystem === 'purnimanta' && !shukla) {
    monthIdx = (monthIdx + 1) % 12;
    adhika = false;
  }
  const month = (adhika ? 'Adhika ' : '') + MONTHS[monthIdx];

  let ekadashi = null;
  if (tithiIdx === 10 || tithiIdx === 25) {
    const side = tithiIdx === 10 ? 0 : 1;
    ekadashi = lm.adhika ? ADHIKA_EKADASHI[side] : EKADASHI[lm.index][side];
  }

  const greg = day.getFullYear();
  const samvat = greg + ((day.getMonth() <= 3 && lm.index >= 8) ? 56 : 57);

  let rahu = null;
  let abhijit = null;
  if (sun.rise && sun.set) {
    const span = sun.set - sun.rise;
    const seg = RAHU_SEGMENT[day.getDay()] - 1;
    rahu = { start: new Date(sun.rise.getTime() + (seg * span) / 8), end: new Date(sun.rise.getTime() + ((seg + 1) * span) / 8) };
    abhijit = { start: new Date(sun.rise.getTime() + (7 * span) / 15), end: new Date(sun.rise.getTime() + (8 * span) / 15) };
  }

  return {
    at, tithi, tithiIndex: tithiIdx, paksha: shukla ? 'Shukla' : 'Krishna',
    month, monthIndex: monthIdx, amantaMonth: MONTHS[lm.index], adhika: lm.adhika,
    nakshatra, yoga, karana, moonRashi: RASHIS[Math.floor(moonSid / 30)],
    ekadashi, ritu: RITUS[Math.floor(lm.index / 2)], samvat, rahu, abhijit,
  };
}

// Returns a message like "Clocks go back 1 hour" if the local UTC offset
// changes within the next `days` days.
export function upcomingClockChange(now, days = 3) {
  for (let i = 0; i < days; i++) {
    const a = localNoon(addDays(now, i));
    const b = localNoon(addDays(now, i + 1));
    const diff = b.getTimezoneOffset() - a.getTimezoneOffset();
    if (diff !== 0) {
      return { date: b, back: diff > 0, hours: Math.abs(diff) / 60 };
    }
  }
  return null;
}

// Checks the sun/moon/panchang maths against known values for Groningen.
// Run with:  TZ=Europe/Amsterdam node tests/test_sky.mjs
import assert from 'node:assert/strict';
import * as Sky from '../static/js/sky.js';

const LAT = 53.2194;
const LON = 6.5665;
const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Europe/Amsterdam', 'run with TZ=Europe/Amsterdam');

// Thursday 22 October 2026
const day = new Date(2026, 9, 22, 7, 42);
const sun = Sky.sunTimes(day, LAT, LON);
assert.equal(hm(sun.rise), '08:13');
assert.equal(hm(sun.set), '18:22');
assert.equal(sun.daylightMin, 609);

const moon = Sky.moonTimes(day, LAT, LON);
assert.equal(hm(moon.rise), '16:56');
assert.equal(hm(moon.set), '03:18');

const mi = Sky.moonInfo(day, LAT, LON);
assert.ok(mi.waxing);
assert.equal(mi.phaseName, 'waxing gibbous');
const pct = Math.round(mi.fraction * 100);
assert.ok(pct >= 80 && pct <= 86, `moon ${pct}%`);
assert.equal(mi.nextFull.toISOString().slice(0, 16), '2026-10-26T04:12');

const p = Sky.panchang(day, LAT, LON, 'purnimanta');
assert.equal(p.tithi, 'Ekadashi');
assert.equal(p.paksha, 'Shukla');
assert.equal(p.month, 'Ashvin');
assert.equal(p.ekadashi, 'Papankusha');
assert.equal(p.nakshatra, 'Shatabhisha');
assert.equal(p.yoga, 'Vriddhi');
assert.equal(p.karana, 'Vishti (Bhadra)');
assert.equal(p.moonRashi, 'Kumbha');
assert.equal(p.ritu, 'Sharad');
assert.equal(p.samvat, 2083);
assert.equal(`${hm(p.rahu.start)}–${hm(p.rahu.end)}`, '14:33–15:50');
assert.equal(`${hm(p.abhijit.start)}–${hm(p.abhijit.end)}`, '12:57–13:38');

// After the full moon: Krishna paksha. Purnimanta calls it Kartika, amanta Ashvin.
const mon = new Date(2026, 9, 26, 12, 0);
assert.equal(Sky.panchang(mon, LAT, LON, 'purnimanta').month, 'Kartika');
assert.equal(Sky.panchang(mon, LAT, LON, 'amanta').month, 'Ashvin');
assert.equal(Sky.panchang(mon, LAT, LON).tithi, 'Pratipada');

// Diwali 2026 (8 Nov) is in Ashvin amanta / Kartika purnimanta, Krishna paksha.
const diwali = Sky.panchang(new Date(2026, 10, 8, 12), LAT, LON, 'amanta');
assert.equal(diwali.month, 'Ashvin');
assert.equal(diwali.paksha, 'Krishna');

// Prabodhini (Dev Uthani) Ekadashi falls around 20-21 Nov 2026.
const pr = [20, 21].map((d) => Sky.panchang(new Date(2026, 10, d, 12), LAT, LON)).find((x) => x.ekadashi);
assert.equal(pr && pr.ekadashi, 'Prabodhini');

// Holi 2027 (22 March) — Samvat must still be 2083 before Chaitra begins
const holi = Sky.panchang(new Date(2027, 2, 21, 12), LAT, LON, 'amanta');
assert.equal(holi.month, 'Phalguna');
assert.equal(holi.samvat, 2083);
// Ram Navami 2027 (15 April): Chaitra Shukla, new Samvat 2084
const rn = Sky.panchang(new Date(2027, 3, 15, 12), LAT, LON);
assert.equal(rn.month, 'Chaitra');
assert.equal(rn.paksha, 'Shukla');
assert.equal(rn.samvat, 2084);

// Clock change: back one hour on Sunday 25 October 2026
const cc = Sky.upcomingClockChange(day, 3);
assert.ok(cc && cc.back && cc.hours === 1);
assert.equal(cc.date.getDate(), 25);
assert.equal(Sky.upcomingClockChange(new Date(2026, 10, 2), 3), null);

// Moon drawing path exists for normal phases and is empty at new moon
assert.ok(Sky.moonLitPath(0.84, true, 32, 32, 28).startsWith('M 32 4'));
assert.equal(Sky.moonLitPath(0.001, true, 32, 32, 28), '');

console.log('sky tests passed');

// "Right now" tithi, nakshatra change and Ekadashi parana window (22–23 Oct 2026)
const tn = Sky.tithiNow(new Date('2026-10-22T09:30:00+02:00'));
assert.equal(tn.name, 'Ekadashi');
assert.equal(tn.next, 'Dwadashi');
assert.equal(hm(tn.end), '11:19');
assert.ok(tn.progress > 0.9 && tn.progress < 1);
const nk = Sky.nakshatraNow(new Date('2026-10-22T09:30:00+02:00'));
assert.equal(nk.name, 'Shatabhisha');
assert.equal(nk.next, 'Purva Bhadrapada');
const pw = Sky.paranaWindow(new Date(2026, 9, 22, 12), LAT, LON);
assert.equal(`${hm(pw.start)}–${hm(pw.end)}`, '08:14–10:16');
assert.equal(pw.start.getDate(), 23);
console.log('right-now tests passed');

// Meteor showers and eclipses (used for tonight's highlight)
assert.equal(Sky.meteorShower(new Date(2026, 11, 10, 20)).name, 'Geminids');
assert.equal(Sky.meteorShower(new Date(2026, 5, 1)), null);
console.log('meteor shower tests passed');

// Tonight's sky for the side column, checked for Groningen.
// Run with:  TZ=Europe/Amsterdam node tests/test_night.mjs
import assert from 'node:assert/strict';
import * as N from '../static/js/night.js';

const LAT = 53.2194;
const LON = 6.5665;
assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Europe/Amsterdam', 'run with TZ=Europe/Amsterdam');
const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// Friday 23 October 2026, afternoon
const fri = N.skyTonight(new Date('2026-10-23T16:30:00+02:00'), LAT, LON);
assert.equal(hm(fri.times.look), '21:00', 'evening look time');
assert.equal(hm(fri.times.dawn), '07:00', 'about 75 min before the 08:15 sunrise');
assert.deepEqual(fri.planets.map((p) => `${p.name} ${p.chip} ${p.compass}${p.morning ? ' AM' : ''}`),
  ['Saturn 21:00 SE', 'Jupiter Sat 07:00 SE AM', 'Mars Sat 07:00 SE AM']);
const saturn = Object.fromEntries(fri.planets[0].details);
assert.equal(saturn.When, 'Up 17:54 – 06:14 · highest at 00:04, due south');
assert.equal(saturn.Where, 'At 21:00: south-east, a third of the way up');
assert.match(saturn['Look for'], /just below-left of the Moon$/);
assert.equal(saturn['Far away'], '1.27 billion km · its light takes 71 min to reach us');
assert.match(fri.planets[0].fact, /bathtub/);
assert.equal(fri.highlight.kind, 'moon-planet');
assert.equal(fri.highlight.text, 'the Moon and Saturn side by side, SE at 21:00');
assert.equal(fri.brightMoon, true);
const cons = fri.constellations.map((c) => `${c.name} ${c.chip} ${c.compass}`);
assert.deepEqual(cons.slice(0, 4), ['Big Dipper 20:00 N', 'Cassiopeia 20:00 NE', 'Summer Triangle 20:00 SW', 'Pegasus 20:00 SE']);
assert.ok(cons.length === 7 && cons.includes('Pleiades 00:00 E'), cons.join(', '));
const tri = Object.fromEntries(fri.constellations.find((c) => c.key === 'Triangle').details);
assert.match(tri.When, /^Best soon after dark .* sinking toward the west$/);
assert.equal(fri.cloud, null, 'no forecast passed');

// After midnight: the evening is "now", the morning chip has no day name
const late = N.skyTonight(new Date('2026-10-24T01:30:00+02:00'), LAT, LON);
assert.equal(hm(late.times.look), '01:30');
assert.equal(late.planets.find((p) => p.name === 'Jupiter').chip, '07:00');

// Winter: Orion is up; a partial solar eclipse (12 Aug 2026, near sunset) becomes the highlight
const jan = N.skyTonight(new Date('2027-01-15T18:00:00+01:00'), LAT, LON);
assert.ok(jan.constellations.some((c) => c.key === 'Orion'));
assert.ok(!jan.constellations.some((c) => c.key === 'Triangle'), 'Summer Triangle too low in January evenings');
const aug = N.skyTonight(new Date('2026-08-12T15:00:00+02:00'), LAT, LON);
assert.equal(aug.highlight.kind, 'eclipse');
assert.match(aug.highlight.text, /^Partial solar eclipse at 20:09, 8\d% of the Sun covered/);
// Geminid peak (13/14 Dec 2026)
const dec = N.skyTonight(new Date('2026-12-14T17:00:00+01:00'), LAT, LON);
assert.equal(dec.highlight.text, 'Geminid shooting stars peak tonight: up to 120 an hour after midnight');
// Short summer nights still give a list, from midnight
const jun = N.skyTonight(new Date('2026-06-21T22:00:00+02:00'), LAT, LON);
assert.equal(hm(jun.times.look), '00:00');
assert.ok(jun.constellations.length >= 3);

// Clouds (Open-Meteo hourly, local time keys)
const t = N.nightTimes(new Date('2026-10-23T16:30:00+02:00'), LAT, LON);
const hours = (vals, day = '2026-10-23') => vals.map((v, i) => ({ time: `${day}T${String(20 + i).padStart(2, '0')}:00`, cloud: v }));
const withMidnight = (vals, next = []) => [...hours(vals.slice(0, 4)), { time: '2026-10-24T00:00', cloud: vals[4] }, ...next];
assert.deepEqual(N.cloudLine(withMidnight([10, 5, 20, 0, 15]), t), { text: 'Clear tonight', sub: 'good night to look up', good: true });
assert.equal(N.cloudLine(withMidnight([90, 80, 20, 10, 5]), t).text, 'Clear after 22:00');
assert.deepEqual(N.cloudLine(withMidnight([10, 20, 90, 95, 100]), t), { text: 'Clear until 22:00', sub: 'then cloudy', good: true });
const sunday = [...hours([20, 10, 30, 20], '2026-10-25'), { time: '2026-10-26T00:00', cloud: 10 }];
const sat = [...hours([95, 95, 95, 95], '2026-10-24'), { time: '2026-10-25T00:00', cloud: 95 }];
assert.deepEqual(N.cloudLine(withMidnight([100, 95, 90, 100, 98], [...sat, ...sunday]), t), { text: 'Cloudy tonight', sub: 'clearer on Sunday', good: false });
assert.equal(N.cloudLine([], t), null);

// Space Station: a 5 June 2019 element set; over Groningen on the evening of 26 May 2019
// there were two visible passes (and none at night in early June: the passes were all in daylight)
const TLE = [
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
];
const passes = N.issPasses(TLE, new Date('2019-05-26T19:00:00Z'), new Date('2019-05-27T04:00:00Z'), LAT, LON);
assert.equal(passes.length, 2, `found ${passes.length} visible passes`);
assert.deepEqual(passes.map((p) => p.start.toISOString().slice(11, 16)), ['20:36', '22:13']);
assert.equal(N.issPasses(TLE, new Date('2019-06-05T19:00:00Z'), new Date('2019-06-06T04:00:00Z'), LAT, LON).length, 0);
for (const p of passes) {
  assert.ok(p.maxEl >= 20 && p.end > p.start && p.end - p.start < 12 * 60000);
  assert.ok(p.heightKm > 380 && p.heightKm < 440, `height ${p.heightKm}`);
}
const row = N.issRow(passes[0], new Date('2019-05-26T18:00:00Z'));
assert.equal(row.chip, '22:36');
assert.equal(row.morning, false);
assert.match(row.compass, /^[NESW]{1,2}→[NESW]{1,2}$/);
assert.equal(row.details.length, 4);
assert.deepEqual(N.issPasses(['bad', 'tle'], new Date(), new Date(Date.now() + 3600e3), LAT, LON), []);
console.log('night tests passed');

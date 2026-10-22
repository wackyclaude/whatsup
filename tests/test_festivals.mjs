// Checks calculated festival dates against published North Indian dates.
// Run with:  TZ=Europe/Amsterdam node tests/test_festivals.mjs
import assert from 'node:assert/strict';
import { festivalsBetween, mergeFestivals } from '../static/js/festivals.js';

const KNOWN = {
  'Raksha Bandhan': ['2022-08-11', '2023-08-30', '2024-08-19', '2025-08-09', '2026-08-28', '2027-08-17'],
  'Navratri begins': ['2022-09-26', '2023-10-15', '2024-10-03', '2025-09-22', '2026-10-11', '2027-09-30'],
  Diwali: ['2022-10-24', '2023-11-12', '2024-10-31', '2025-10-20', '2026-11-08', '2027-10-29'],
  Holi: ['2023-03-08', '2024-03-25', '2025-03-14', '2026-03-04'],
  'Karva Chauth': ['2023-11-01', '2024-10-20', '2025-10-10', '2026-10-29', '2027-10-18'],
  Dussehra: ['2023-10-24', '2024-10-12', '2025-10-02', '2027-10-09'],
  'Ganesh Chaturthi': ['2023-09-19', '2024-09-07', '2025-08-27', '2027-09-04'],
  'Maha Shivaratri': ['2024-03-08', '2025-02-26', '2026-02-15', '2027-03-06'],
  'Ram Navami': ['2024-04-17', '2025-04-06', '2026-03-26', '2027-04-15'],
  'Bhai Dooj': ['2023-11-15', '2024-11-03', '2025-10-23', '2027-10-31'],
  Dhanteras: ['2026-11-06', '2027-10-27'],
  'Sharad Purnima': ['2026-10-25', '2027-10-15'],
  'Chhath Puja': ['2026-11-15', '2027-11-04'],
  'Makar Sankranti': ['2027-01-15'],
  'Vasant Panchami': ['2027-02-11'],
  'Akshaya Tritiya': ['2027-05-09'],
  'Guru Purnima': ['2027-07-18'],
  'Chaitra Navratri begins': ['2027-04-07'],
  'Hanuman Jayanti': ['2027-04-20'],
};

const all = festivalsBetween(new Date('2022-01-01T00:00:00Z'), new Date('2027-12-31T00:00:00Z'));
const misses = [];
let total = 0;
for (const [name, dates] of Object.entries(KNOWN)) {
  const got = new Set(all.filter((f) => f.name === name).map((f) => f.date));
  for (const d of dates) {
    total++;
    if (!got.has(d)) misses.push(`${name} ${d}`);
  }
}
assert.deepEqual(misses, [], `calculated dates differ: ${misses.join('; ')}`);

// Each festival appears about once a year
const diwalis = all.filter((f) => f.name === 'Diwali');
assert.equal(diwalis.length, 6);

// The checked list wins over a calculated date of the same festival
const merged = mergeFestivals(
  [{ date: '2027-08-24', name: 'Janmashtami' }, { date: '2027-10-29', name: 'Diwali' }],
  [{ date: '2027-08-25', name: 'Janmashtami' }],
);
assert.deepEqual(merged.map((f) => `${f.date} ${f.name}`), ['2027-08-25 Janmashtami', '2027-10-29 Diwali']);

console.log(`festival tests passed (${total} known dates)`);

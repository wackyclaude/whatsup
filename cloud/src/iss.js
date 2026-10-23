// Orbit data (a "two-line element set") for the International Space Station,
// from CelesTrak. The page works out the visible passes itself.

const URL_ISS = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';

/** TLE line checksum: digits add their value, '-' adds 1, modulo 10. */
export function tleChecksumOk(line) {
  if (!/^[12] [0-9 A-Z.+-]{66}[0-9]$/.test(line)) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/** Picks the ISS's two lines out of CelesTrak's text, or null. */
export function parseTle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd());
  const i = lines.findIndex((l) => l.startsWith('1 25544'));
  if (i < 0) return null;
  const l1 = lines[i];
  const l2 = lines[i + 1] || '';
  if (!l2.startsWith('2 25544') || !tleChecksumOk(l1) || !tleChecksumOk(l2)) return null;
  return [l1, l2];
}

export async function fetchIssTle(fetchImpl = fetch) {
  const res = await fetchImpl(URL_ISS, {
    headers: { 'User-Agent': 'whatsup-family-dashboard' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 10000) throw new Error('unexpected reply');
  const tle = parseTle(text);
  if (!tle) throw new Error('no ISS orbit data in reply');
  return tle;
}

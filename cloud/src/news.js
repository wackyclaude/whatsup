// Kids' news headlines for the dashboard.
//
// Only children's news services are used, from a fixed list (nobody can
// point the app at another feed). Only headlines are shown: no photos, no
// links to click. On top of that, headlines with words about violence,
// death, crime and similar are left out.

export const SOURCES = {
  'nos-jeugdjournaal': { name: 'NOS Jeugdjournaal', lang: 'NL', url: 'https://feeds.nos.nl/jeugdjournaal' },
  'bbc-newsround': { name: 'BBC Newsround', lang: 'EN', url: 'https://feeds.bbci.co.uk/newsround/rss.xml' },
};
export const DEFAULT_SOURCES = ['nos-jeugdjournaal', 'bbc-newsround'];

// Matched as whole words (English) or word parts (Dutch compounds).
const BLOCK_EN = [
  'kill', 'killed', 'killing', 'killer', 'dead', 'death', 'deaths', 'die', 'dies', 'died', 'dying', 'murder', 'murdered',
  'shooting', 'shot', 'gun', 'guns', 'gunman', 'stab', 'stabbed', 'stabbing', 'knife', 'bomb', 'bombing', 'attack',
  'attacked', 'terror', 'terrorist', 'war', 'wars', 'warfare', 'missile', 'airstrike', 'invasion', 'hostage', 'kidnap',
  'kidnapped', 'abuse', 'abused', 'assault', 'rape', 'suicide', 'overdose', 'drug', 'drugs', 'crash', 'crashed',
  'massacre', 'genocide', 'violence', 'violent', 'injured', 'victim', 'victims', 'body', 'bodies', 'funeral', 'arrested',
  'prison', 'jail', 'sex', 'sexual', 'porn', 'gambling', 'alcohol', 'disaster', 'earthquake', 'tsunami', 'riot',
];
// Dutch: whole words, and word parts that also catch compounds (e.g. "bomaanslag")
const BLOCK_NL_WORDS = [
  'dood', 'doden', 'gedood', 'sterft', 'stierf', 'mes', 'messen', 'bom', 'bommen', 'drugs', 'crash', 'seks', 'gokken',
  'alcohol', 'ramp', 'rampen', 'cel', 'lichaam', 'lichamen', 'wapen', 'wapens',
];
const BLOCK_NL_PARTS = [
  'moord', 'schietpartij', 'neergeschoten', 'beschoten', 'gestoken', 'steekpartij', 'aanslag', 'terreur', 'terroris',
  'oorlog', 'raketaanval', 'gijzel', 'ontvoer', 'misbruik', 'mishandel', 'verkracht', 'zelfdoding', 'overled',
  'ongeluk', 'slachtoffer', 'begrafenis', 'gearresteerd', 'opgepakt', 'gevangenis', 'geweld', 'gewond', 'porno',
  'aardbeving', 'explosie', 'brandstichting',
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function textOf(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  v = cdata ? cdata[1] : decode(v);
  return v.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parses RSS 2.0 items: [{ title, published }] (plain text only). */
export function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 60) {
    const title = textOf(m[0], 'title');
    const date = new Date(textOf(m[0], 'pubDate'));
    if (title) items.push({ title: title.slice(0, 140), published: Number.isNaN(date.getTime()) ? null : date.toISOString() });
  }
  return items;
}

export function isKidSafe(title, extraWords = []) {
  const t = ` ${title.toLowerCase()} `;
  const words = t.replace(/[^\p{L}\p{N}' ]+/gu, ' ');
  const list = words.split(/\s+/).filter(Boolean);
  const set = new Set(list.map((w) => w.replace(/'s$/, '')));
  for (const w of BLOCK_EN) if (set.has(w)) return false;
  for (const w of BLOCK_NL_WORDS) if (set.has(w)) return false;
  for (const w of BLOCK_NL_PARTS) if (list.some((x) => x.includes(w))) return false;
  for (const w of extraWords) if (w && t.includes(String(w).toLowerCase())) return false;
  return true;
}

async function fetchFeed(source, fetchImpl) {
  const res = await fetchImpl(source.url, {
    headers: { 'User-Agent': 'whatsup-family-dashboard', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 3_000_000) throw new Error('feed too large');
  return parseRss(text);
}

/**
 * Up to `limit` newest kid-safe headlines across the chosen sources,
 * making sure each working source gets a few.
 */
export async function fetchNews(newsConfig, fetchImpl = fetch, limit = 9) {
  const ids = newsConfig.sources.filter((id) => SOURCES[id]);
  const errors = [];
  const perSource = await Promise.all(ids.map(async (id) => {
    const src = SOURCES[id];
    try {
      const items = (await fetchFeed(src, fetchImpl))
        .filter((i) => isKidSafe(i.title, newsConfig.block_words))
        .map((i) => ({ ...i, source: src.name, lang: src.lang }));
      return items;
    } catch (e) {
      errors.push(`${src.name}: unavailable`);
      return [];
    }
  }));
  const byDate = (a, b) => (b.published || '').localeCompare(a.published || '');
  perSource.forEach((list) => list.sort(byDate));
  // take turns between sources, newest first, so one feed can't crowd out the other
  const out = [];
  for (let i = 0; out.length < limit && perSource.some((l) => l[i]); i++) {
    for (const list of perSource) if (list[i] && out.length < limit) out.push(list[i]);
  }
  return { items: out.sort(byDate), errors };
}

// Kids' news headlines for the dashboard.
//
// Only children's news services are used, from a fixed list (nobody can
// point the app at another feed). Only headlines are shown (no photos);
// each links to the article on that service's own website. Headlines with
// words about violence, death, crime and similar are left out.

export const SOURCES = {
  'nos-jeugdjournaal': {
    name: 'NOS Jeugdjournaal', lang: 'NL', url: 'https://feeds.nos.nl/jeugdjournaal', sites: ['jeugdjournaal.nl', 'nos.nl'],
  },
  'bbc-newsround': {
    name: 'BBC Newsround', lang: 'EN', url: 'https://feeds.bbci.co.uk/newsround/rss.xml', sites: ['bbc.co.uk', 'bbc.com'],
  },
};

/**
 * The article address, only if it is https on the source's own website
 * (so a feed can't send the family somewhere else). Otherwise null.
 */
export function safeLink(raw, sites) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!sites.some((site) => host === site || host.endsWith(`.${site}`))) return null;
  u.hash = '';
  return u.href.length <= 300 ? u.href : null;
}
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
  // indexOf scanning (no backtracking regex), so odd input can't slow it down
  const lower = block.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  let at = lower.indexOf(open);
  while (at >= 0 && !/[\s>]/.test(lower[at + open.length] || '')) at = lower.indexOf(open, at + 1);
  if (at < 0) return '';
  const gt = lower.indexOf('>', at);
  const close = lower.indexOf(`</${tag.toLowerCase()}>`, gt);
  if (gt < 0 || close < 0) return '';
  let v = block.slice(gt + 1, close).trim();
  if (v.startsWith('<![CDATA[') && v.endsWith(']]>')) v = v.slice(9, -3);
  else v = decode(v);
  return v
    .replace(/<[^<>]*>/g, ' ') // tags
    .replace(/[<>]/g, ' ') // stray brackets
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses RSS 2.0 items: [{ title, published }] (plain text only).
 * Scans with indexOf rather than one big regex, so the work stays linear
 * however odd the feed is; very long items are skipped.
 */
export function parseRss(xml) {
  const items = [];
  const lower = String(xml).toLowerCase();
  let pos = 0;
  while (items.length < 60) {
    const start = lower.indexOf('<item', pos);
    if (start < 0) break;
    const end = lower.indexOf('</item>', start);
    if (end < 0) break;
    pos = end + 7;
    if (end - start > 20000) continue;
    const block = xml.slice(start, end + 7);
    const title = textOf(block, 'title');
    const date = new Date(textOf(block, 'pubDate'));
    const link = textOf(block, 'link') || textOf(block, 'guid');
    if (title) items.push({ title: title.slice(0, 140), link, published: Number.isNaN(date.getTime()) ? null : date.toISOString() });
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
export async function fetchNews(newsConfig, fetchImpl = fetch, limit = 12) {
  const ids = newsConfig.sources.filter((id) => SOURCES[id]);
  const errors = [];
  const perSource = await Promise.all(ids.map(async (id) => {
    const src = SOURCES[id];
    try {
      const items = (await fetchFeed(src, fetchImpl))
        .filter((i) => isKidSafe(i.title, newsConfig.block_words))
        .map((i) => ({ ...i, link: safeLink(i.link, src.sites), source: src.name, lang: src.lang }));
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

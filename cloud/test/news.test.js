import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, isKidSafe, fetchNews, SOURCES } from '../src/news.js';
import { loadConfig } from '../src/config.js';
import { getNews, _resetNewsCache } from '../src/data.js';
import worker from '../src/index.js';

const NOS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Jeugdjournaal</title>
<item><title><![CDATA[Kinderen helpen mee met het ontwerpen van een speeltuin]]></title>
<link>https://jeugdjournaal.nl/artikel/1</link>
<description><![CDATA[<p>Een <strong>mooie</strong> speeltuin</p>]]></description>
<enclosure url="https://images.cdn.nos.nl/x.webp" type="image/webp"/>
<pubDate>Thu, 22 Oct 2026 18:59:40 +0200</pubDate></item>
<item><title><![CDATA[Bomaanslag in de stad]]></title><pubDate>Thu, 22 Oct 2026 17:00:00 +0200</pubDate></item>
<item><title>Vaders oefenen haren vlechten: &#39;Wel lastig&#39; &amp; leuk</title><pubDate>Thu, 22 Oct 2026 16:36:42 +0200</pubDate></item>
<item><title><![CDATA[Zo groeien bomen in de herfst <script>alert(1)</script>]]></title><pubDate>Thu, 22 Oct 2026 15:00:00 +0200</pubDate></item>
</channel></rss>`;

const BBC = `<rss><channel>
<item><title>Why do leaves change colour in autumn?</title><pubDate>Thu, 22 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Two people killed in storm</title><pubDate>Thu, 22 Oct 2026 11:00:00 GMT</pubDate></item>
<item><title>Lioness gives birth to three cubs at zoo</title><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

test('RSS parsing: plain text only, entities decoded, tags stripped', () => {
  const items = parseRss(NOS);
  assert.equal(items.length, 4);
  assert.equal(items[0].title, 'Kinderen helpen mee met het ontwerpen van een speeltuin');
  assert.equal(items[0].published, '2026-10-22T16:59:40.000Z');
  assert.equal(items[2].title, "Vaders oefenen haren vlechten: 'Wel lastig' & leuk");
  assert.ok(!items[3].title.includes('<'), 'no markup survives');
  assert.deepEqual(parseRss('not xml at all'), []);
});

test('word filter: blocks violence/death/crime, keeps everyday words', () => {
  for (const bad of ['Bomaanslag in de stad', 'Two people killed in storm', 'Man neergeschoten bij winkel', 'Oorlog duurt voort',
    'School shooting shocks town', 'Brand: twee doden', 'Police: drugs found']) {
    assert.equal(isKidSafe(bad), false, bad);
  }
  for (const ok of ['Zo groeien bomen in de herfst', 'Trampoline-park opent in Groningen', 'Aanvaller scoort twee keer',
    'Why do leaves change colour in autumn?', 'Doodgewoon een leuke dag', 'Raket gelanceerd naar de maan', 'Messi wins award']) {
    assert.equal(isKidSafe(ok), true, ok);
  }
  assert.equal(isKidSafe('Nieuwe spelshow', ['spelshow']), false, 'extra family words');
});

test('fetchNews: only known feeds, filtered, takes turns between sources, survives a dead feed', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === SOURCES['nos-jeugdjournaal'].url) return new Response(NOS);
    if (url === SOURCES['bbc-newsround'].url) return new Response(BBC);
    throw new Error('unexpected');
  };
  const cfg = loadConfig(JSON.stringify({ allowed_emails: ['a@b.co'] })).config;
  const res = await fetchNews(cfg.news, fetchImpl, 9);
  const titles = res.items.map((i) => i.title);
  assert.ok(!titles.some((t) => /Bomaanslag|killed/.test(t)));
  assert.equal(res.items.filter((i) => i.lang === 'EN').length, 2);
  assert.equal(res.items.filter((i) => i.lang === 'NL').length, 3);
  assert.ok(res.items.every((i) => !('link' in i)), 'no links passed to the page');

  const dead = await fetchNews(cfg.news, async (url) => (url.includes('bbc') ? new Response('', { status: 503 }) : new Response(NOS)));
  assert.deepEqual(dead.errors, ['BBC Newsround: unavailable']);
  assert.equal(dead.items.length, 3);
});

test('config: unknown news sources are refused; news can be turned off', () => {
  const r = loadConfig(JSON.stringify({ allowed_emails: ['a@b.co'], news: { sources: ['nos-jeugdjournaal', 'https://evil.example/feed'] } }));
  assert.deepEqual(r.config.news.sources, ['nos-jeugdjournaal']);
  assert.ok(r.problems.some((p) => p.includes('news.sources')));
  assert.equal(loadConfig(JSON.stringify({ allowed_emails: ['a@b.co'], news: false })).config.news.enabled, false);
});

test('getNews caches for 30 minutes; /api/news needs sign-in', async () => {
  _resetNewsCache();
  let n = 0;
  const fetchImpl = async () => { n++; return new Response(BBC); };
  const env = { WHATSUP_CONFIG: JSON.stringify({ allowed_emails: ['a@b.co'], news: { sources: ['bbc-newsround'] } }) };
  const t0 = new Date('2026-10-22T20:00:00Z');
  await getNews(env, t0, fetchImpl);
  await getNews(env, new Date(t0.getTime() + 20 * 60000), fetchImpl);
  assert.equal(n, 1);
  await getNews(env, new Date(t0.getTime() + 31 * 60000), fetchImpl);
  assert.equal(n, 2);
  const res = await worker.fetch(new Request('https://x.workers.dev/api/news'), {
    GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(40), ...env,
  });
  assert.equal(res.status, 401);
});

test('odd feeds stay fast and safe', () => {
  const t0 = Date.now();
  parseRss('<item '.repeat(200000));
  parseRss(`<item><title>${'<'.repeat(15000)}</title></item>`.repeat(50));
  assert.ok(Date.now() - t0 < 1000, 'linear time');
  assert.deepEqual(parseRss('<ITEM><TITLE>Hoofdletters</TITLE></ITEM>').map((i) => i.title), ['Hoofdletters']);
});

test('email check: fast on long input, normal addresses accepted', () => {
  const t0 = Date.now();
  const r = loadConfig(JSON.stringify({ allowed_emails: [`a@${'.'.repeat(50000)}`, `a@b${'.c'.repeat(30000)}!`, 'Mum.Dad+home@gmail.com', 'x@school.example.nl'] }));
  assert.ok(Date.now() - t0 < 500, 'no slow regex');
  assert.deepEqual(r.config.allowed_emails, ['mum.dad+home@gmail.com', 'x@school.example.nl']);
});

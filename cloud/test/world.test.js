import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('world clocks: validated config, one weather request, night icon', async () => {
  const { config, problems } = loadConfig(JSON.stringify({
    allowed_emails: ['a@b.co'],
    world_clocks: [
      { name: 'New Delhi', latitude: 28.61, longitude: 77.21, timezone: 'Asia/Kolkata' },
      { name: 'Nowhere', latitude: 'x', longitude: 1, timezone: 'UTC' },
      { name: 'Bad zone', latitude: 1, longitude: 1, timezone: 'Mars/Base' },
      { name: 'Boston', latitude: 42.36, longitude: -71.06, timezone: 'America/New_York' },
    ],
  }));
  assert.deepEqual(config.world_clocks.map((c) => c.name), ['New Delhi', 'Boston']);
  assert.equal(problems.filter((p) => p.startsWith('world_clocks')).length, 2);
  const { fetchWorldWeather } = await import('../src/weather.js');
  let asked;
  const res = await fetchWorldWeather(config.world_clocks, async (url) => {
    asked = new URL(url);
    return new Response(JSON.stringify([
      { current: { temperature_2m: 30.6, weather_code: 0, is_day: 1 } },
      { current: { temperature_2m: 6.4, weather_code: 1, is_day: 0 } },
    ]));
  });
  assert.equal(asked.searchParams.get('latitude'), '28.61,42.36');
  assert.deepEqual(res, [{ temp: 31, kind: 'sun' }, { temp: 6, kind: 'moon' }]);
  const one = await fetchWorldWeather(config.world_clocks.slice(0, 1), async () => new Response(JSON.stringify({ current: { temperature_2m: 20, weather_code: 63, is_day: 1 } })));
  assert.deepEqual(one, [{ temp: 20, kind: 'rain' }]);
});

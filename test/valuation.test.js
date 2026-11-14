'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, idsToRefresh, releaseIdOf } = require('../lib/valuation');
const { createLookup } = require('../lib/lookup');

const items = [
  { id: '1', source: 'Discogs', sourceId: '100' },
  { id: '2', source: 'Discogs', sourceId: '200' },
  { id: '3', source: 'MusicBrainz', sourceId: 'abc-uuid' },
  { id: '4', source: null, sourceId: null },
  { id: '5', source: 'Discogs', sourceId: '300', wishlist: true },
  { id: '6', source: 'Discogs', sourceId: '100' } // to samo wydanie co 1 (drugi egzemplarz)
];

test('releaseIdOf: tylko liczbowe id z Discogs', () => {
  assert.equal(releaseIdOf(items[0]), '100');
  assert.equal(releaseIdOf(items[2]), null);
  assert.equal(releaseIdOf({ source: 'Discogs', sourceId: 'x1' }), null);
});

test('summarize: suma po walucie, bez listy życzeń, drugi egzemplarz liczy się osobno', () => {
  const cache = {
    100: { value: 10.5, currency: 'EUR', at: 1 },
    200: { value: 20, currency: 'USD', at: 1 }, // inna waluta - nie wliczamy
    300: { value: 99, currency: 'EUR', at: 1 }
  };
  const s = summarize(items, cache, 'EUR');
  assert.deepEqual(s, { total: 21, counted: 2, owned: 5, currency: 'EUR' });
});

test('idsToRefresh: brak wyceny, inna waluta lub starsza niż tydzień; bez duplikatów i listy życzeń', () => {
  const now = 10 * 24 * 3600 * 1000;
  const cache = { 100: { value: 1, currency: 'EUR', at: now - 1000 }, 200: { value: 1, currency: 'EUR', at: now - 8 * 24 * 3600 * 1000 } };
  assert.deepEqual(idsToRefresh(items, cache, 'EUR', now), ['200']);
  assert.deepEqual(idsToRefresh(items, {}, 'EUR', now).sort(), ['100', '200']);
});

test('fetchMarketStats: najniższa cena, brak ofert i błędy; token w nagłówku', async () => {
  const seen = [];
  const body = { lowest_price: { currency: 'EUR', value: 12.34 }, num_for_sale: 7 };
  const mk = (status, b) => async (url, opts) => {
    seen.push({ url: String(url), auth: opts.headers.Authorization });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => b };
  };
  const lk = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: mk(200, body) });
  assert.deepEqual(await lk.fetchMarketStats('100', 'EUR'), { value: 12.34, currency: 'EUR', forSale: 7 });
  assert.match(seen[0].url, /marketplace\/stats\/100\?curr_abbr=EUR$/);
  assert.equal(seen[0].auth, 'Discogs token=TOK');

  const none = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: mk(200, { lowest_price: null, num_for_sale: 0 }) });
  assert.equal(await none.fetchMarketStats('100', 'EUR'), null);
  const nf = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: mk(404, {}) });
  assert.equal(await nf.fetchMarketStats('100', 'EUR'), null);
  const bad = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: mk(500, {}) });
  await assert.rejects(bad.fetchMarketStats('100', 'EUR'), /HTTP 500/);
  const rate = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: mk(429, {}) });
  await assert.rejects(rate.fetchMarketStats('100', 'EUR'), /limit/);
  await assert.rejects(createLookup({ getToken: () => '', userAgent: 't', fetchImpl: mk(200, body) }).fetchMarketStats('1', 'EUR'), /token/i);
});

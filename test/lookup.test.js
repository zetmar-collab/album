'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLookup, barcodeVariants, interleave } = require('../lib/lookup');
const { fetchRetry } = require('../lib/net');

const headers = (o = {}) => ({ get: (k) => o[String(k).toLowerCase()] ?? null });
const json = (body, status = 200, h) => ({ ok: status >= 200 && status < 300, status, headers: headers(h), json: async () => body });

const MB_BODY = {
  releases: [
    {
      id: 'mb-1',
      title: 'Homework',
      date: '1997-01-20',
      country: 'GB',
      barcode: '0724384260958',
      'artist-credit': [{ name: 'Daft Punk', joinphrase: '' }],
      'label-info': [{ label: { name: 'Virgin' }, 'catalog-number': 'V2821' }],
      media: [{ format: 'CD' }]
    }
  ]
};
const DC_BODY = { results: [{ id: 99, title: 'Daft Punk - Homework', year: 1997, label: ['Virgin'], format: ['CD', 'Album'], barcode: ['7 24384 26095 8'] }] };

test('barcodeVariants obsługuje UPC-A i EAN-13 z zerem', () => {
  assert.deepEqual(barcodeVariants('724384260958'), ['724384260958', '0724384260958']);
  assert.deepEqual(barcodeVariants('0724384260958'), ['0724384260958', '724384260958']);
  assert.deepEqual(barcodeVariants('abc'), []);
});

test('interleave stawia Discogs pierwszy i przeplata wyniki', () => {
  assert.deepEqual(interleave(['d1', 'd2'], ['m1']), ['d1', 'm1', 'd2']);
  assert.deepEqual(interleave([], ['m1']), ['m1']);
});

test('token Discogs idzie w nagłówku Authorization, a NIE w adresie URL (S2)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: opts.headers });
    return String(url).includes('musicbrainz') ? json(MB_BODY) : json(DC_BODY);
  };
  const lk = createLookup({ getToken: () => 'SEKRET-123', userAgent: 'test', fetchImpl });
  const out = await lk.searchRemote({ query: 'daft punk homework' });
  const discogs = calls.filter((c) => c.url.includes('api.discogs.com'));
  assert.ok(discogs.length >= 1);
  for (const c of discogs) {
    assert.ok(!c.url.includes('SEKRET-123'), 'token nie może być w URL');
    assert.equal(c.headers.Authorization, 'Discogs token=SEKRET-123');
  }
  assert.equal(out.counts.discogs, 1);
  assert.equal(out.counts.musicbrainz, 1);
  assert.equal(out.results[0].source, 'Discogs');
  assert.equal(out.results[1].source, 'MusicBrainz');
  assert.equal(out.results[1].catalogNumber, 'V2821');
});

test('brak tokenu: MusicBrainz działa, a błąd Discogs jest zgłoszony', async () => {
  const fetchImpl = async () => json(MB_BODY);
  const lk = createLookup({ getToken: () => '', userAgent: 't', fetchImpl });
  const out = await lk.searchRemote({ query: 'x' });
  assert.equal(out.counts.musicbrainz, 1);
  assert.equal(out.counts.discogs, 0);
  assert.match(out.errors.join(' '), /Brak tokenu Discogs/);
});

test('kod kreskowy: warianty Discogs odpytywane, fallback tekstowy gdy pole barcode nic nie zwróci', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('musicbrainz')) return json({ releases: [] });
    seen.push(u);
    return u.includes('barcode=') ? json({ results: [] }) : json(DC_BODY);
  };
  const lk = createLookup({ getToken: () => 'T', userAgent: 't', fetchImpl });
  const out = await lk.searchRemote({ barcode: '724384260958' });
  assert.equal(out.counts.discogs, 1);
  assert.ok(seen.some((u) => u.includes('barcode=')));
  assert.ok(seen.some((u) => u.includes('q=')));
});

test('błąd jednego serwisu nie psuje wyników drugiego', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('musicbrainz')) throw new Error('sieć padła');
    return json(DC_BODY);
  };
  const lk = createLookup({ getToken: () => 'T', userAgent: 't', fetchImpl });
  const out = await lk.searchRemote({ query: 'x' });
  assert.equal(out.counts.discogs, 1);
  assert.match(out.errors.join(' '), /MusicBrainz: sieć padła/);
});

test('fetchRetry ponawia raz po 503 i kończy sukcesem', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? json({}, 503) : json({ ok: 1 }));
  const res = await fetchRetry('http://x', {}, { fetchImpl, retryDelay: 1 });
  assert.equal(res.status, 200);
  assert.equal(n, 2);
});

test('fetchRetry: po drugim 503 zwraca odpowiedź bez pętli; timeout daje czytelny błąd (B9)', async () => {
  let n = 0;
  const always503 = async () => (n++, json({}, 503));
  const res = await fetchRetry('http://x', {}, { fetchImpl: always503, retryDelay: 1 });
  assert.equal(res.status, 503);
  assert.equal(n, 2);

  const hang = (url, opts) =>
    new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
  await assert.rejects(fetchRetry('http://x', {}, { fetchImpl: hang, timeout: 30 }), /przekroczono czas oczekiwania/);
});

test('fetchTracklist: jawny błąd zamiast pustego tekstu przy HTTP 503', async () => {
  const fetchImpl = async () => json({}, 503);
  const lk = createLookup({ getToken: () => 'T', userAgent: 't', fetchImpl, retryDelay: 1 });
  // retry zużywa jedno ponowienie, więc test dostaje 503 dwukrotnie
  const r = await lk.fetchTracklist('MusicBrainz', 'mb-1');
  assert.equal(r.text, '');
  assert.match(r.error, /HTTP 503/);
});

test('fetchTracklist MusicBrainz formatuje utwory i czasy', async () => {
  const body = { media: [{ position: 1, tracks: [{ position: 1, title: 'Revolution 909', length: 325000 }, { position: 2, title: 'Da Funk', length: 328000 }] }] };
  const lk = createLookup({ getToken: () => '', userAgent: 't', fetchImpl: async () => json(body) });
  const r = await lk.fetchTracklist('MusicBrainz', 'mb-1');
  assert.equal(r.text, '1. Revolution 909 (5:25)\n2. Da Funk (5:28)');
});

test('downloadImage odrzuca protokoły inne niż http(s) i zbyt duże pliki', async () => {
  const big = { ok: true, status: 200, headers: headers({ 'content-length': '99999999' }), arrayBuffer: async () => new ArrayBuffer(10) };
  const lk = createLookup({ getToken: () => '', userAgent: 't', fetchImpl: async () => big });
  assert.equal(await lk.downloadImage('file:///etc/passwd'), null);
  assert.equal(await lk.downloadImage('to nie url'), null);
  assert.equal(await lk.downloadImage('https://x/y.jpg'), null);
});

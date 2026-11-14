'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapApiRelease, parseCsv, mapCsv, planImport, guessFormat, mapCondition } = require('../lib/discogsImport');
const { createLookup } = require('../lib/lookup');

test('guessFormat i mapCondition', () => {
  assert.equal(guessFormat(['Vinyl']), 'vinyl');
  assert.equal(guessFormat('LP, Album'), 'vinyl');
  assert.equal(guessFormat(['CD']), 'cd');
  assert.equal(guessFormat('Cassette'), 'cassette');
  assert.equal(guessFormat(['DVD']), null);
  assert.equal(mapCondition('Near Mint (NM or M-)'), 'Prawie nowy (NM)');
  assert.equal(mapCondition('Very Good Plus (VG+)'), 'Bardzo dobry+ (VG+)');
  assert.equal(mapCondition(''), '');
});

test('mapApiRelease: pola, numer rozróżniający wykonawcy i nieobsługiwany format', () => {
  const rel = {
    date_added: '2023-05-01T10:00:00-07:00',
    basic_information: {
      id: 1234,
      title: 'Nevermind',
      year: 1991,
      artists: [{ name: 'Nirvana (2)' }],
      labels: [{ name: 'DGC', catno: 'DGC-24425' }],
      formats: [{ name: 'Vinyl', descriptions: ['LP', 'Album'] }],
      genres: ['Rock'],
      cover_image: 'https://i.discogs.com/x.jpg'
    }
  };
  const c = mapApiRelease(rel);
  assert.equal(c.artist, 'Nirvana');
  assert.equal(c.format, 'vinyl');
  assert.equal(c.sourceId, '1234');
  assert.equal(c.catalogNumber, 'DGC-24425');
  assert.match(c.addedAt, /^2023-05-01T/);
  assert.equal(mapApiRelease({ basic_information: { id: 1, formats: [{ name: 'DVD' }] } }), null);
});

test('parseCsv: cudzysłowy, przecinki, nowe linie, BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","z ""q""\nw"\r\n\r\n2,,3\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'z "q"\nw'], ['2', '', '3']]);
});

test('mapCsv: eksport Discogs, pomijanie nieobsługiwanych formatów i brak wymaganych kolumn', () => {
  const csv = [
    'Catalog#,Artist,Title,Label,Format,Rating,Released,release_id,CollectionFolder,Date Added,Collection Media Condition,Collection Notes',
    'DGC-24425,"Nirvana (2)",Nevermind,DGC,"LP, Album",5,1991,1234,Uncategorized,2023-05-01 10:00:00,Near Mint (NM or M-),"podpisana, rzadka"',
    'X1,Jan Kowalski,Film,Studio,DVD,,2000,55,Uncategorized,2023-05-02 10:00:00,,'
  ].join('\n');
  const r = mapCsv(csv);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.skipped, 1);
  const c = r.candidates[0];
  assert.deepEqual([c.artist, c.title, c.year, c.format, c.sourceId, c.condition, c.notes], ['Nirvana', 'Nevermind', '1991', 'vinyl', '1234', 'Prawie nowy (NM)', 'podpisana, rzadka']);
  assert.equal(mapCsv('a,b\n1,2').error, 'columns');
  assert.equal(mapCsv('').error, 'empty');
});

test('planImport: pomija to samo wydanie Discogs, ten sam album i powtórzenia w imporcie', () => {
  const existing = [
    { id: '1', format: 'vinyl', artist: 'Nirvana', title: 'Nevermind', source: 'Discogs', sourceId: '1234' },
    { id: '2', format: 'cd', artist: 'Daft Punk', title: 'Homework', source: null, sourceId: null }
  ];
  const cands = [
    { format: 'vinyl', artist: 'Nirvana', title: 'Nevermind', source: 'Discogs', sourceId: '1234' },
    { format: 'cd', artist: 'DAFT PUNK', title: 'Homework (Remastered)', source: 'Discogs', sourceId: '777' },
    { format: 'cd', artist: 'Massive Attack', title: 'Mezzanine', source: 'Discogs', sourceId: '10' },
    { format: 'cd', artist: 'Massive Attack', title: 'Mezzanine', source: 'Discogs', sourceId: '10' }
  ];
  const plan = planImport(existing, cands);
  assert.equal(plan.toAdd.length, 1);
  assert.equal(plan.duplicates, 3);
});

test('fetchCollection: przechodzi po stronach, raportuje postęp i zgłasza błędy', async () => {
  const calls = [];
  const page = (n) => ({ pagination: { pages: 2, items: 3 }, releases: n === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] });
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.Authorization });
    const n = Number(/[?&]page=(\d+)/.exec(url)[1]);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => page(n) };
  };
  const lk = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl });
  const progress = [];
  const r = await lk.fetchCollection('jan', { onProgress: (p) => progress.push(p.done) });
  assert.equal(r.releases.length, 3);
  assert.deepEqual(progress, [2, 3]);
  assert.ok(calls.every((c) => c.auth === 'Discogs token=TOK' && !c.url.includes('TOK')), 'token w nagłówku, nie w URL');

  const lk404 = createLookup({ getToken: () => 'TOK', userAgent: 't', fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }) });
  await assert.rejects(lk404.fetchCollection('nikt'), /nie znaleziono/);
  const lkNoToken = createLookup({ getToken: () => '', userAgent: 't', fetchImpl });
  await assert.rejects(lkNoToken.fetchCollection('jan'), /Brak tokenu/);
});

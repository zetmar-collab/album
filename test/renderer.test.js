'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, findDuplicate } = require('../renderer/dedupe');
const { computeStats } = require('../renderer/stats');

test('norm usuwa polskie znaki i wielkość liter', () => {
  assert.equal(norm('Zażółć GĘŚLĄ Jaźń'), 'zazolc gesla jazn');
});

const items = [
  { id: '1', format: 'cd', artist: 'Daft Punk', title: 'Homework', barcode: '0724384260958' },
  { id: '2', format: 'vinyl', artist: 'Daft Punk', title: 'Discovery (Remastered)', barcode: '' },
  { id: '3', format: 'cassette', artist: 'Lady Pank', title: 'Zimowe graffiti', barcode: '' }
];

test('findDuplicate: ten sam kod (także z zerem wiodącym) i ten sam album w tym samym formacie', () => {
  assert.equal(findDuplicate(items, { barcode: '724384260958', artist: 'X', title: 'Y', format: 'cd' }).reason, 'barcode');
  assert.equal(findDuplicate(items, { artist: 'DAFT PUNK', title: 'discovery', format: 'vinyl' }).item.id, '2');
  assert.equal(findDuplicate(items, { artist: 'lady pank', title: 'Zimowe Graffiti!', format: 'cassette' }).reason, 'title');
});

test('findDuplicate: inny format albo edycja własna to nie duplikat', () => {
  assert.equal(findDuplicate(items, { artist: 'Daft Punk', title: 'Discovery', format: 'cd' }), null);
  assert.equal(findDuplicate(items, { id: '1', barcode: '724384260958', artist: 'Daft Punk', title: 'Homework', format: 'cd' }, '1'), null);
  assert.equal(findDuplicate(items, { artist: '', title: '', barcode: '', format: 'cd' }), null);
});

test('computeStats liczy formaty, dekady i najczęstszych wykonawców', () => {
  const s = computeStats([
    { format: 'vinyl', year: '1975', artist: 'Queen', label: 'EMI', coverFile: 'a.jpg', tracklist: '1. A' },
    { format: 'vinyl', year: '1979', artist: 'Queen', label: 'EMI' },
    { format: 'cd', year: '1997', artist: 'Daft Punk', label: 'Virgin' },
    { format: 'cd', year: '', artist: '', label: '' },
    null
  ]);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byFormat, { vinyl: 2, cd: 2, cassette: 0 });
  assert.deepEqual(s.byDecade, [{ name: '1970s', count: 2 }, { name: '1990s', count: 1 }]);
  assert.deepEqual(s.topArtists[0], { name: 'Queen', count: 2 });
  assert.deepEqual(s.topLabels[0], { name: 'EMI', count: 2 });
  assert.equal(s.withCover, 1);
  assert.equal(s.withTracklist, 1);
});

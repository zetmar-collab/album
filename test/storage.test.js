'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  saveJsonAtomic,
  loadJsonRecovering,
  safeBaseName,
  coverPath,
  sanitizeItem,
  sanitizeItems
} = require('../lib/storage');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'album-test-'));
}

test('saveJsonAtomic zapisuje plik, trzyma poprzednią wersję w .bak i nie zostawia .tmp', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'collection.json');
  saveJsonAtomic(f, [{ id: '1' }]);
  saveJsonAtomic(f, [{ id: '1' }, { id: '2' }]);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')).length, 1);
  assert.equal(fs.existsSync(f + '.tmp'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uszkodzony plik jest zachowany, a dane wracają z .bak (B1 z audytu)', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'collection.json');
  const good = Array.from({ length: 176 }, (_, i) => ({ id: String(i) }));
  saveJsonAtomic(f, good);
  saveJsonAtomic(f, good); // tworzy .bak z poprawną treścią
  const text = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, text.slice(0, Math.floor(text.length / 2))); // urwany zapis

  const r = loadJsonRecovering(f, [], Array.isArray);
  assert.equal(r.status, 'restored');
  assert.equal(r.value.length, 176);
  assert.ok(r.corruptPath && fs.existsSync(r.corruptPath), 'uszkodzona kopia musi zostać na dysku');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).length, 176, 'plik główny odtworzony');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uszkodzony plik bez .bak: start z pustą listą, ale oryginał NIE jest nadpisywany', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'collection.json');
  fs.writeFileSync(f, '[{"id":"1"},{"id":');
  const r = loadJsonRecovering(f, [], Array.isArray);
  assert.equal(r.status, 'corrupt');
  assert.deepEqual(r.value, []);
  // pierwszy zapis po awarii nie może zniszczyć śladu danych
  saveJsonAtomic(f, [{ id: 'nowa' }]);
  assert.ok(fs.existsSync(r.corruptPath));
  assert.match(fs.readFileSync(r.corruptPath, 'utf8'), /"id":"1"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('brak pliku to status missing; zła struktura (nie tablica) traktowana jak uszkodzenie', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'x.json');
  assert.equal(loadJsonRecovering(f, [], Array.isArray).status, 'missing');
  fs.writeFileSync(f, '{"a":1}');
  assert.equal(loadJsonRecovering(f, [], Array.isArray).status, 'corrupt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('safeBaseName i coverPath nie wypuszczają ścieżki poza katalog okładek', () => {
  assert.equal(safeBaseName('../../dokument.docx'), 'dokument.docx');
  assert.equal(safeBaseName('..\\..\\dokument.docx'), 'dokument.docx');
  assert.equal(safeBaseName('C:\\Users\\x\\a.jpg'), 'a.jpg');
  assert.equal(safeBaseName('..'), null);
  assert.equal(safeBaseName(''), null);
  assert.equal(safeBaseName(null), null);
  const dir = path.join(os.tmpdir(), 'covers');
  assert.equal(path.dirname(coverPath(dir, '../../x.jpg')), dir);
  assert.equal(coverPath(dir, '..'), null);
});

test('sanitizeItem: tylko 17 znanych pól, format z białej listy, liczby jako tekst', () => {
  const it = sanitizeItem({ id: 'a', format: 'dvd', artist: ' X ', year: 1999, coverFile: '../../evil.jpg', hack: 1, __proto__: { p: 1 } });
  assert.equal(it.format, 'vinyl');
  assert.equal(it.artist, 'X');
  assert.equal(it.year, '1999');
  assert.equal(it.coverFile, 'evil.jpg');
  assert.equal(it.hack, undefined);
  assert.equal(Object.keys(it).length, 17);
  assert.equal(sanitizeItem(null), null);
  assert.equal(sanitizeItem([1]), null);
  assert.equal(sanitizeItem('x'), null);
});

test('sanitizeItems pomija elementy null i naprawia zduplikowane id', () => {
  const { items, skipped } = sanitizeItems([null, { id: 'a' }, { id: 'a' }, 5, { title: 't' }]);
  assert.equal(skipped, 2);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
});

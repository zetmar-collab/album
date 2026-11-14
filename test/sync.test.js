'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { hashItems, planSync, mergeItems, extractCovers } = require('../lib/sync');
const { writeBackup, readBackup } = require('../lib/backup');
const { sanitizeItem } = require('../lib/storage');

const it = (id, extra = {}) => sanitizeItem({ id, format: 'cd', artist: 'A' + id, title: 'T' + id, ...extra });

test('hashItems: niezależny od kolejności pozycji i kluczy, czuły na zmianę treści', () => {
  const a = [it('1'), it('2')];
  assert.equal(hashItems(a), hashItems([a[1], a[0]]));
  assert.notEqual(hashItems(a), hashItems([a[0], { ...a[1], title: 'inny' }]));
});

test('planSync: push, pull, merge, none', () => {
  const base = [it('1'), it('2')];
  const hBase = hashItems(base);
  const local2 = [...base, it('3')];
  assert.equal(planSync({ localItems: base, remoteItems: null, lastHash: null }).action, 'push', 'brak pliku');
  assert.equal(planSync({ localItems: base, remoteItems: base, lastHash: null }).action, 'none');
  assert.equal(planSync({ localItems: local2, remoteItems: base, lastHash: hBase }).action, 'push', 'zmieniono tylko tutaj');
  assert.equal(planSync({ localItems: base, remoteItems: local2, lastHash: hBase }).action, 'pull', 'zmieniono tylko w pliku');
  assert.equal(planSync({ localItems: local2, remoteItems: [...base, it('9')], lastHash: hBase }).action, 'merge', 'zmieniono po obu stronach');
  assert.equal(planSync({ localItems: local2, remoteItems: base, lastHash: null }).action, 'merge', 'pierwsza synchronizacja z różnicami');
});

test('mergeItems: dodaje brakujące, zlicza konflikty i zostawia wersję lokalną', () => {
  const local = [it('1'), it('2', { title: 'lokalny' })];
  const remote = [it('2', { title: 'zdalny' }), it('3')];
  const m = mergeItems(local, remote);
  assert.deepEqual(m.items.map((x) => x.id), ['1', '2', '3']);
  assert.equal(m.items[1].title, 'lokalny');
  assert.equal(m.conflicts, 1);
  assert.equal(m.added.length, 1);
});

test('extractCovers: tylko wskazane obrazy, bez nadpisywania i bez ścieżek poza katalogiem', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'album-sync-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]);
  fs.writeFileSync(path.join(src, 'a.jpg'), JPEG);
  fs.writeFileSync(path.join(src, 'b.jpg'), JPEG);
  const items = [it('1', { coverFile: 'a.jpg' }), it('2', { coverFile: 'b.jpg' })];
  const zipFile = path.join(root, 'sync.zip');
  writeBackup(zipFile, { items, coversDir: src, token: '' });
  const backup = readBackup(zipFile);

  const dest = path.join(root, 'dest');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'b.jpg'), 'ISTNIEJACY');
  assert.equal(extractCovers(backup.zip, ['a.jpg', 'b.jpg', '../../zly.jpg'], dest), 1);
  assert.equal(fs.readFileSync(path.join(dest, 'b.jpg'), 'utf8'), 'ISTNIEJACY', 'istniejącego pliku nie nadpisano');
  assert.ok(fs.existsSync(path.join(dest, 'a.jpg')));
  assert.equal(new AdmZip(zipFile).getEntries().length >= 3, true);
  fs.rmSync(root, { recursive: true, force: true });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { readBackup, applyBackup, writeBackup } = require('../lib/backup');
const { saveJsonAtomic } = require('../lib/storage');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'album-bk-'));
  const dataDir = path.join(root, 'album-data');
  const coversDir = path.join(dataDir, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });
  return { root, dataDir, coversDir, dataFile: path.join(dataDir, 'collection.json') };
}

function makeZip(file, { items, covers = {}, settings }) {
  const zip = new AdmZip();
  zip.addFile('collection.json', Buffer.from(typeof items === 'string' ? items : JSON.stringify(items)));
  if (settings !== undefined) zip.addFile('settings.json', Buffer.from(JSON.stringify(settings)));
  for (const [name, buf] of Object.entries(covers)) zip.addFile(name, buf);
  zip.writeZip(file);
}

test('import: ścieżki ../ w coverFile i element null NIE psują kolekcji ani nie ruszają plików poza katalogiem (B3)', () => {
  const p = setup();
  const victim = path.join(p.root, 'dokument-uzytkownika.docx');
  fs.writeFileSync(victim, 'wazne');
  const zipFile = path.join(p.root, 'evil.zip');
  makeZip(zipFile, {
    items: [null, { id: 'x', format: 'cd', artist: 'A', title: 'T', coverFile: '../../dokument-uzytkownika.docx' }, 7],
    covers: { 'covers/../../dokument-uzytkownika.docx': Buffer.from('nadpisane') }
  });

  const backup = readBackup(zipFile);
  assert.equal(backup.skipped, 2);
  assert.equal(backup.items.length, 1);
  assert.equal(backup.items[0].coverFile, 'dokument-uzytkownika.docx');
  applyBackup(backup, p);

  assert.equal(fs.readFileSync(victim, 'utf8'), 'wazne', 'plik poza katalogiem okładek nietknięty');
  assert.equal(JSON.parse(fs.readFileSync(p.dataFile, 'utf8')).length, 1);
  // rozszerzenie .docx nie jest obrazem, więc nie zostaje rozpakowane nigdzie
  assert.equal(fs.readdirSync(p.coversDir).length, 0);
  fs.rmSync(p.root, { recursive: true, force: true });
});

test('import: odtwarza tylko okładki używane przez pozycje i tylko obrazy', () => {
  const p = setup();
  const zipFile = path.join(p.root, 'ok.zip');
  makeZip(zipFile, {
    items: [{ id: '1', format: 'vinyl', title: 'A', coverFile: 'a.jpg' }],
    covers: { 'covers/a.jpg': JPEG, 'covers/sierota.jpg': JPEG, 'covers/skrypt.js': Buffer.from('x') },
    settings: { discogsToken: 'TEST-TOKEN-NOT-REAL' }
  });
  const backup = readBackup(zipFile);
  assert.equal(backup.token, 'TEST-TOKEN-NOT-REAL');
  applyBackup(backup, p);
  assert.deepEqual(fs.readdirSync(p.coversDir).sort(), ['a.jpg']);
  fs.rmSync(p.root, { recursive: true, force: true });
});

test('import: błąd w połowie przywraca poprzednie okładki i kolekcję', () => {
  const p = setup();
  fs.writeFileSync(path.join(p.coversDir, 'stara.jpg'), JPEG);
  saveJsonAtomic(p.dataFile, [{ id: 'stara' }]);
  const zipFile = path.join(p.root, 'ok.zip');
  makeZip(zipFile, { items: [{ id: '1', title: 'A', coverFile: 'a.jpg' }], covers: { 'covers/a.jpg': JPEG } });
  const backup = readBackup(zipFile);

  // wymuszamy błąd zapisu kolekcji: pod ścieżką pliku jest katalog
  fs.rmSync(p.dataFile, { force: true });
  fs.rmSync(p.dataFile + '.bak', { force: true });
  fs.mkdirSync(p.dataFile);
  assert.throws(() => applyBackup(backup, p));
  assert.deepEqual(fs.readdirSync(p.coversDir), ['stara.jpg'], 'stare okładki wróciły');
  assert.equal(fs.existsSync(p.coversDir + '.new'), false);
  assert.equal(fs.existsSync(p.coversDir + '.old'), false);
  fs.rmSync(p.root, { recursive: true, force: true });
});

test('import: odrzuca ZIP bez collection.json i collection.json niebędący tablicą', () => {
  const p = setup();
  const a = path.join(p.root, 'a.zip');
  const z = new AdmZip();
  z.addFile('x.txt', Buffer.from('1'));
  z.writeZip(a);
  assert.throws(() => readBackup(a), /collection\.json/);
  const b = path.join(p.root, 'b.zip');
  makeZip(b, { items: '{"a":1}' });
  assert.throws(() => readBackup(b), /Uszkodzony/);
  const c = path.join(p.root, 'c.zip');
  makeZip(c, { items: 'to nie json' });
  assert.throws(() => readBackup(c), /Uszkodzony/);
  fs.rmSync(p.root, { recursive: true, force: true });
});

test('eksport: domyślnie bez tokenu, bez okładek-sierot, round-trip zachowuje pozycje', () => {
  const p = setup();
  fs.writeFileSync(path.join(p.coversDir, 'a.jpg'), JPEG);
  fs.writeFileSync(path.join(p.coversDir, 'sierota.jpg'), JPEG);
  const items = [{ id: '1', format: 'cd', artist: 'A', title: 'T', coverFile: 'a.jpg' }].map((i) =>
    require('../lib/storage').sanitizeItem(i)
  );
  const out = path.join(p.root, 'kopia.zip');
  const r = writeBackup(out, { items, coversDir: p.coversDir, token: '' });
  assert.equal(r.covers, 1);

  const names = new AdmZip(out).getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, ['collection.json', 'covers/a.jpg', 'settings.json']);

  const back = readBackup(out);
  assert.equal(back.token, '');
  assert.equal(back.items.length, 1);
  assert.equal(back.items[0].title, 'T');

  const withToken = path.join(p.root, 'z-tokenem.zip');
  writeBackup(withToken, { items, coversDir: p.coversDir, token: 'TEST-TOKEN-NOT-REAL' });
  assert.equal(readBackup(withToken).token, 'TEST-TOKEN-NOT-REAL');
  fs.rmSync(p.root, { recursive: true, force: true });
});

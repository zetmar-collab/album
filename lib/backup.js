'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { sanitizeItems, safeBaseName, saveJsonAtomic, IMAGE_EXT } = require('./storage');
const { t } = require('./messages');

const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_COVER_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 50000;

/**
 * Czyta i waliduje kopię zapasową (ZIP: collection.json + settings.json + covers/).
 * Nic nie zapisuje na dysk. Rzuca Error z komunikatem po polsku.
 */
function readBackup(zipPath) {
  const zip = new AdmZip(zipPath);
  if (zip.getEntries().length > MAX_ENTRIES) throw new Error(t('Kopia zapasowa zawiera zbyt wiele plików.'));
  const entry = zip.getEntry('collection.json');
  if (!entry) throw new Error(t('To nie jest kopia zapasowa aplikacji Album (brak collection.json).'));
  // Rozmiar deklarowany w nagłówku sprawdzamy PRZED rozpakowaniem (ochrona przed „bombą" ZIP).
  if (entry.header.size > MAX_JSON_BYTES) throw new Error(t('Plik collection.json w kopii jest zbyt duży.'));
  let parsed;
  try {
    parsed = JSON.parse(zip.readAsText(entry));
  } catch {
    throw new Error(t('Uszkodzony plik kopii zapasowej.'));
  }
  if (!Array.isArray(parsed)) throw new Error(t('Uszkodzony plik kopii zapasowej.'));
  const { items, skipped } = sanitizeItems(parsed);

  let token = '';
  const s = zip.getEntry('settings.json');
  if (s && s.header.size < 65536) {
    try {
      const o = JSON.parse(zip.readAsText(s));
      if (o && typeof o.discogsToken === 'string') token = o.discogsToken.trim();
    } catch {
      /* brak ustawień w kopii to nie błąd */
    }
  }
  return { zip, items, skipped, token };
}

/**
 * Stosuje wczytaną kopię (zastępuje kolekcję). Okładki rozpakowywane są do katalogu obok
 * i podmieniane dopiero po sukcesie; błąd w połowie przywraca poprzedni stan.
 * Odtwarzane są wyłącznie okładki, do których odwołują się pozycje, i tylko pliki graficzne.
 */
function applyBackup(backup, { dataFile, coversDir }) {
  const { zip, items } = backup;
  const wanted = new Set(items.map((i) => i.coverFile).filter(Boolean));
  const staging = coversDir + '.new';
  const old = coversDir + '.old';

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith('covers/')) continue;
      const base = safeBaseName(e.entryName);
      if (!base || !wanted.has(base)) continue;
      if (!IMAGE_EXT.has(path.extname(base).toLowerCase())) continue;
      if (e.header.size > MAX_COVER_BYTES) continue;
      fs.writeFileSync(path.join(staging, base), e.getData());
    }

    fs.rmSync(old, { recursive: true, force: true });
    const hadCovers = fs.existsSync(coversDir);
    if (hadCovers) fs.renameSync(coversDir, old);
    try {
      fs.renameSync(staging, coversDir);
      saveJsonAtomic(dataFile, items);
    } catch (err) {
      fs.rmSync(coversDir, { recursive: true, force: true });
      if (hadCovers) fs.renameSync(old, coversDir);
      throw err;
    }
    try {
      fs.rmSync(old, { recursive: true, force: true });
    } catch {
      /* sprzątanie nie jest krytyczne */
    }
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* j.w. */
    }
  }
  return { count: items.length };
}

/**
 * Tworzy kopię zapasową. Token Discogs trafia do pliku tylko wtedy, gdy przekazano go jawnie;
 * do ZIP-a dołączane są wyłącznie okładki używane przez pozycje.
 */
function writeBackup(zipPath, { items, coversDir, token }) {
  const zip = new AdmZip();
  zip.addFile('collection.json', Buffer.from(JSON.stringify(items, null, 2), 'utf8'));
  zip.addFile('settings.json', Buffer.from(JSON.stringify({ discogsToken: token || '' }, null, 2), 'utf8'));
  const added = new Set();
  for (const it of items) {
    if (!it.coverFile || added.has(it.coverFile)) continue;
    const p = path.join(coversDir, it.coverFile);
    if (fs.existsSync(p)) {
      zip.addLocalFile(p, 'covers');
      added.add(it.coverFile);
    }
  }
  zip.writeZip(zipPath);
  return { count: items.length, covers: added.size };
}

module.exports = { readBackup, applyBackup, writeBackup };

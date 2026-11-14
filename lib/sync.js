'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeBaseName, IMAGE_EXT } = require('./storage');

const SYNC_FILE = 'Album-sync.zip';
const MAX_COVER_BYTES = 25 * 1024 * 1024;

/** JSON z posortowanymi kluczami - ten sam zbiór pozycji zawsze daje ten sam zapis (niezależnie od kolejności). */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Odcisk całej kolekcji (bez uwzględnienia kolejności pozycji). */
function hashItems(items) {
  const sorted = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return crypto.createHash('sha256').update(stable(sorted)).digest('hex');
}

/**
 * Trójstronne porównanie: lokalna kolekcja, plik w folderze synchronizacji i odcisk z ostatniej udanej synchronizacji.
 *  - push  : zmieniła się tylko ta strona (albo pliku jeszcze nie ma) -> zapisujemy plik
 *  - pull  : zmienił się tylko plik (inne urządzenie) -> przejmujemy go
 *  - merge : zmieniły się obie strony (albo to pierwsza synchronizacja) -> łączymy
 *  - none  : bez różnic
 */
function planSync({ localItems, remoteItems, lastHash }) {
  const lh = hashItems(localItems);
  if (!remoteItems) return { action: 'push', localHash: lh, remoteHash: null };
  const rh = hashItems(remoteItems);
  if (lh === rh) return { action: 'none', localHash: lh, remoteHash: rh };
  if (lastHash && rh === lastHash) return { action: 'push', localHash: lh, remoteHash: rh };
  if (lastHash && lh === lastHash) return { action: 'pull', localHash: lh, remoteHash: rh };
  return { action: 'merge', localHash: lh, remoteHash: rh };
}

/**
 * Łączy kolekcje po id: pozycje z obu stron zostają, a przy różnych wersjach tej samej pozycji wygrywa lokalna
 * (liczymy takie konflikty). Usunięcia nie są propagowane przy łączeniu - to świadome, bezpieczne ustawienie.
 */
function mergeItems(local, remote) {
  const byId = new Map(local.map((i) => [i.id, i]));
  const added = [];
  let conflicts = 0;
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) added.push(r);
    else if (stable(l) !== stable(r)) conflicts++;
  }
  return { items: local.concat(added), added, conflicts };
}

/** Wypakowuje z kopii tylko wskazane okładki (obrazy do 25 MB) i nie nadpisuje istniejących plików. */
function extractCovers(zip, names, coversDir) {
  const wanted = new Set(names);
  let n = 0;
  fs.mkdirSync(coversDir, { recursive: true });
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('covers/')) continue;
    const base = safeBaseName(e.entryName);
    if (!base || !wanted.has(base) || !IMAGE_EXT.has(path.extname(base).toLowerCase())) continue;
    if (e.header.size > MAX_COVER_BYTES) continue;
    const target = path.join(coversDir, base);
    if (fs.existsSync(target)) continue;
    fs.writeFileSync(target, e.getData());
    n++;
  }
  return n;
}

module.exports = { SYNC_FILE, hashItems, planSync, mergeItems, extractCovers };

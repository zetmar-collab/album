'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FORMATS = ['vinyl', 'cd', 'cassette'];
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

/**
 * Zapis atomowy: najpierw plik tymczasowy, potem rename (na tym samym dysku to jedna operacja),
 * dzięki czemu przerwany zapis nie zostawia uciętego JSON-a. Poprzednia wersja trafia do <plik>.bak.
 */
function saveJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.bak');
    } catch {
      /* kopia pomocnicza - brak jej nie blokuje zapisu */
    }
  }
  fs.renameSync(tmp, file);
}

/**
 * Wczytuje JSON; przy uszkodzeniu NIE gubi danych po cichu:
 *  - uszkodzony plik jest zachowywany obok jako <plik>.corrupt-<czas>,
 *  - jeśli istnieje poprawny <plik>.bak, jest przywracany.
 * Zwraca { value, status: 'ok' | 'missing' | 'restored' | 'corrupt', corruptPath, error }.
 */
function loadJsonRecovering(file, fallback, validate = () => true) {
  const read = (f) => {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!validate(v)) throw new Error('Nieprawidłowa struktura pliku');
    return v;
  };
  const bak = file + '.bak';

  const restoreFromBak = () => {
    if (!fs.existsSync(bak)) return null;
    try {
      const v = read(bak);
      fs.copyFileSync(bak, file);
      return v;
    } catch {
      return null;
    }
  };

  if (fs.existsSync(file)) {
    try {
      return { value: read(file), status: 'ok', corruptPath: null, error: null };
    } catch (err) {
      let corruptPath = `${file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(file, corruptPath);
      } catch {
        corruptPath = null;
      }
      const v = restoreFromBak();
      if (v !== null) return { value: v, status: 'restored', corruptPath, error: err.message };
      return { value: fallback, status: 'corrupt', corruptPath, error: err.message };
    }
  }

  const v = restoreFromBak();
  if (v !== null) return { value: v, status: 'restored', corruptPath: null, error: null };
  return { value: fallback, status: 'missing', corruptPath: null, error: null };
}

/** Sama nazwa pliku (bez katalogów, także dla separatorów Windows). null, gdy nic sensownego nie zostaje. */
function safeBaseName(name) {
  if (name == null) return null;
  const base = path.basename(String(name).replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..') return null;
  return base;
}

/** Pełna ścieżka okładki gwarantowanie wewnątrz coversDir (albo null). */
function coverPath(coversDir, name) {
  const base = safeBaseName(name);
  return base ? path.join(coversDir, base) : null;
}

const toStr = (v) => (v == null ? '' : String(v).trim());

/**
 * Normalizuje pozycję do dokładnie tych 17 pól, które współdzielą desktop i Android.
 * Zwraca null dla czegokolwiek, co nie jest zwykłym obiektem. Nieznane pola są pomijane celowo
 * (chroni przed zanieczyszczeniem obiektów i przed ścieżkami w polu coverFile).
 */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const addedAt =
    typeof raw.addedAt === 'string' && !Number.isNaN(Date.parse(raw.addedAt)) ? raw.addedAt : new Date().toISOString();
  return {
    id: toStr(raw.id) || crypto.randomUUID(),
    format: FORMATS.includes(raw.format) ? raw.format : 'vinyl',
    artist: toStr(raw.artist),
    title: toStr(raw.title),
    year: toStr(raw.year),
    label: toStr(raw.label),
    catalogNumber: toStr(raw.catalogNumber),
    barcode: toStr(raw.barcode),
    genre: toStr(raw.genre),
    country: toStr(raw.country),
    condition: toStr(raw.condition),
    tracklist: toStr(raw.tracklist),
    notes: toStr(raw.notes),
    coverFile: safeBaseName(raw.coverFile),
    source: toStr(raw.source) || null,
    sourceId: toStr(raw.sourceId) || null,
    wishlist: raw.wishlist === true, // true = pozycja z listy życzeń (jeszcze jej nie mam)
    addedAt
  };
}

/** Normalizuje listę; pomija nieprawidłowe elementy i dba o unikalność id. */
function sanitizeItems(arr) {
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const raw of arr) {
    const it = sanitizeItem(raw);
    if (!it) {
      skipped++;
      continue;
    }
    if (seen.has(it.id)) it.id = crypto.randomUUID();
    seen.add(it.id);
    items.push(it);
  }
  return { items, skipped };
}

module.exports = {
  FORMATS,
  IMAGE_EXT,
  saveJsonAtomic,
  loadJsonRecovering,
  safeBaseName,
  coverPath,
  sanitizeItem,
  sanitizeItems
};

'use strict';

const { findDuplicate } = require('../renderer/dedupe');

/** Discogs dopisuje do nazw wykonawców numer rozróżniający, np. "Nirvana (2)" - w kolekcji go nie chcemy. */
const cleanArtist = (s) => String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim();

/** Nazwy formatów Discogs -> nasz format albo null (DVD, plik cyfrowy itd. nie są obsługiwane). */
function guessFormat(names) {
  const f = (Array.isArray(names) ? names.join(' ') : String(names || '')).toLowerCase();
  if (/\bcassette\b|\bmc\b|\bcass\b/.test(f)) return 'cassette';
  if (/vinyl|\blp\b|\b7"|\b10"|\b12"|shellac/.test(f)) return 'vinyl';
  if (/\bcd\b|cdr|sacd|\bhdcd\b/.test(f)) return 'cd';
  return null;
}

/** Stan nośnika z Discogs ("Near Mint (NM or M-)") -> pole "Stan" w aplikacji. */
function mapCondition(text) {
  const m = /\((M|NM|VG\+|VG|G\+|G|F\/P|F|P)(?=[\s)])/.exec(String(text || ''));
  if (!m) return '';
  const map = {
    M: 'Nowy (M)',
    NM: 'Prawie nowy (NM)',
    'VG+': 'Bardzo dobry+ (VG+)',
    VG: 'Bardzo dobry (VG)',
    'G+': 'Dobry (G)',
    G: 'Dobry (G)',
    F: 'Słaby (F/P)',
    P: 'Słaby (F/P)',
    'F/P': 'Słaby (F/P)'
  };
  return map[m[1]] || '';
}

const iso = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** Jeden element odpowiedzi API (/users/{u}/collection/folders/0/releases) -> kandydat na pozycję. */
function mapApiRelease(rel) {
  const b = (rel && rel.basic_information) || {};
  const format = guessFormat((b.formats || []).map((f) => f.name));
  if (!format || !b.id) return null;
  const label = (b.labels || [])[0] || {};
  return {
    format,
    artist: cleanArtist((b.artists || []).map((a) => a.name).join(', ')),
    title: String(b.title || ''),
    year: b.year ? String(b.year) : '',
    label: cleanArtist(label.name || ''),
    catalogNumber: label.catno && label.catno !== 'none' ? String(label.catno) : '',
    genre: (b.genres || []).join(', '),
    source: 'Discogs',
    sourceId: String(b.id),
    addedAt: iso(rel.date_added),
    coverUrl: String(b.cover_image || b.thumb || '')
  };
}

/** Parser CSV (RFC 4180): cudzysłowy, przecinki i znaki nowej linii w polach, BOM na początku. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/** Eksport kolekcji z Discogs (Collection -> Export): kolumny Artist, Title, Label, Catalog#, Format, Released, release_id... */
function mapCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { candidates: [], skipped: 0, error: rows.length ? null : 'empty' };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const ia = col('artist');
  const it = col('title');
  if (ia === -1 || it === -1) return { candidates: [], skipped: 0, error: 'columns' };
  const get = (r, name) => (col(name) === -1 ? '' : String(r[col(name)] || '').trim());
  const candidates = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const format = guessFormat(get(r, 'format'));
    if (!format) {
      skipped++;
      continue;
    }
    const year = /\d{4}/.exec(get(r, 'released'));
    const rid = get(r, 'release_id');
    candidates.push({
      format,
      artist: cleanArtist(r[ia]),
      title: String(r[it] || '').trim(),
      year: year ? year[0] : '',
      label: cleanArtist(get(r, 'label')),
      catalogNumber: get(r, 'catalog#'),
      genre: '',
      condition: mapCondition(get(r, 'collection media condition')),
      notes: get(r, 'collection notes'),
      source: rid ? 'Discogs' : null,
      sourceId: rid || null,
      addedAt: iso(get(r, 'date added')),
      coverUrl: ''
    });
  }
  return { candidates, skipped, error: null };
}

/** Dzieli kandydatów na nowych i takich, które już są w kolekcji (to samo wydanie Discogs albo ten sam album i format). */
function planImport(existing, candidates) {
  const known = new Set(existing.filter((i) => i && i.source === 'Discogs' && i.sourceId).map((i) => String(i.sourceId)));
  const toAdd = [];
  let duplicates = 0;
  const pool = existing.slice();
  for (const c of candidates) {
    const sameRelease = c.sourceId && c.source === 'Discogs' && known.has(String(c.sourceId));
    if (sameRelease || findDuplicate(pool, c)) {
      duplicates++;
      continue;
    }
    toAdd.push(c);
    pool.push(c); // powtórzenia w samym imporcie też są pomijane
    if (c.sourceId) known.add(String(c.sourceId));
  }
  return { toAdd, duplicates };
}

module.exports = { cleanArtist, guessFormat, mapCondition, mapApiRelease, parseCsv, mapCsv, planImport };

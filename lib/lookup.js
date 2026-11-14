'use strict';

const { fetchRetry } = require('./net');

const MB_RELEASE = 'https://musicbrainz.org/ws/2/release/';
const COVER_HOSTS = ['coverartarchive.org', 'archive.org', 'discogs.com'];

/** Ten sam kod kreskowy bywa zapisany z zerem wiodącym lub bez (UPC-A 12 cyfr vs EAN-13). */
function barcodeVariants(barcode) {
  const b = String(barcode).replace(/\D/g, '');
  const set = new Set();
  if (b) set.add(b);
  const noZeros = b.replace(/^0+/, '');
  if (noZeros) set.add(noZeros);
  if (b.length === 12) set.add('0' + b);
  return [...set];
}

/** Przeplot wyników (Discogs pierwszy), żeby oba serwisy były widoczne na górze listy. */
function interleave(discogs, musicbrainz) {
  const out = [];
  const n = Math.max(discogs.length, musicbrainz.length);
  for (let i = 0; i < n; i++) {
    if (discogs[i]) out.push(discogs[i]);
    if (musicbrainz[i]) out.push(musicbrainz[i]);
  }
  return out;
}

function msToMinSec(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * Klient MusicBrainz + Discogs. Token Discogs przekazywany jest WYŁĄCZNIE nagłówkiem Authorization
 * (nigdy w adresie URL, który mógłby trafić do logów).
 */
function createLookup({ getToken, userAgent, fetchImpl, timeout = 15000, retryDelay = 1200 }) {
  const cfg = { fetchImpl, timeout, retryDelay };
  const req = (url, headers = {}) => fetchRetry(url, { headers: { 'User-Agent': userAgent, ...headers } }, cfg);

  function discogsHeaders() {
    const t = String((getToken && getToken()) || '').trim();
    return t ? { Authorization: 'Discogs token=' + t } : null;
  }

  async function searchMusicBrainz(query) {
    const url = MB_RELEASE + '?query=' + encodeURIComponent(query) + '&fmt=json&limit=8';
    const res = await req(url, { Accept: 'application/json' });
    if (!res.ok) throw new Error('MusicBrainz: HTTP ' + res.status);
    const data = await res.json();
    return (data.releases || []).map((r) => {
      const li = (r['label-info'] || [])[0] || {};
      return {
        source: 'MusicBrainz',
        sourceId: r.id,
        artist: (r['artist-credit'] || []).map((a) => (a.name || '') + (a.joinphrase || '')).join(''),
        title: r.title || '',
        year: (r.date || '').slice(0, 4),
        label: (li.label && li.label.name) || '',
        catalogNumber: li['catalog-number'] || '',
        country: r.country || '',
        formatText: (r.media && r.media[0] && r.media[0].format) || '',
        barcode: r.barcode || '',
        coverUrl: 'https://coverartarchive.org/release/' + r.id + '/front-500'
      };
    });
  }

  async function searchDiscogs(params) {
    const headers = discogsHeaders();
    if (!headers) {
      return { error: 'Brak tokenu Discogs — dodaj go w Ustawieniach, aby przeszukiwać Discogs.', results: [] };
    }
    const qs = new URLSearchParams({ ...params, type: 'release', per_page: '8' });
    const res = await req('https://api.discogs.com/database/search?' + qs.toString(), headers);
    if (res.status === 401) return { error: 'Discogs: nieprawidłowy token (sprawdź Ustawienia).', results: [] };
    if (res.status === 429) return { error: 'Discogs: przekroczono limit zapytań — spróbuj za chwilę.', results: [] };
    if (!res.ok) return { error: 'Discogs: HTTP ' + res.status, results: [] };
    const data = await res.json();
    const results = (data.results || []).map((r) => {
      const t = r.title || '';
      const sep = t.indexOf(' - ');
      return {
        source: 'Discogs',
        sourceId: String(r.id),
        artist: sep > -1 ? t.slice(0, sep) : '',
        title: sep > -1 ? t.slice(sep + 3) : t,
        year: r.year ? String(r.year) : '',
        label: (r.label && r.label[0]) || '',
        catalogNumber: r.catno && r.catno !== 'none' ? r.catno : '',
        country: r.country || '',
        formatText: (r.format || []).join(', '),
        barcode: (r.barcode && r.barcode[0]) || '',
        genre: (r.genre || []).join(', '),
        coverUrl: r.cover_image || r.thumb || ''
      };
    });
    return { error: null, results };
  }

  /**
   * Wszystkie warianty kodu odpytywane równolegle (zamiast do 6 zapytań jedno po drugim).
   * Najpierw pole `barcode`; Discogs często trzyma kody ze spacjami, więc gdy to nic nie da,
   * używamy wyszukiwania pełnotekstowego.
   */
  async function searchDiscogsBarcode(variants) {
    const byField = await Promise.all(variants.map((v) => searchDiscogs({ barcode: v })));
    const failed = byField.find((r) => r.error);
    if (failed) return failed;
    const hit = byField.find((r) => r.results.length);
    if (hit) return hit;
    const byText = await Promise.all(variants.map((v) => searchDiscogs({ q: v })));
    const textHit = byText.find((r) => r.results.length);
    if (textHit) return textHit;
    const textErr = byText.find((r) => r.error);
    return { error: textErr ? textErr.error : null, results: [] };
  }

  async function verifyDiscogsToken(token) {
    const t = String(token || '').trim();
    if (!t) return { ok: true, empty: true };
    const res = await req('https://api.discogs.com/oauth/identity', { Authorization: 'Discogs token=' + t });
    if (res.ok) {
      const d = await res.json();
      return { ok: true, username: d.username };
    }
    if (res.status === 401) {
      return { ok: false, message: 'Discogs odrzucił ten token. Skopiuj token ponownie z discogs.com → Settings → Developers.' };
    }
    return { ok: false, message: 'Nie udało się sprawdzić tokenu (Discogs: HTTP ' + res.status + ').' };
  }

  async function searchRemote({ barcode, query } = {}) {
    const tasks = [];
    if (barcode) {
      const variants = barcodeVariants(barcode);
      tasks.push(searchMusicBrainz(variants.map((v) => 'barcode:' + JSON.stringify(v)).join(' OR ')));
      tasks.push(searchDiscogsBarcode(variants));
    } else {
      tasks.push(searchMusicBrainz(String(query || '')));
      tasks.push(searchDiscogs({ q: String(query || '') }));
    }
    const [mb, dc] = await Promise.allSettled(tasks);
    const out = { results: [], errors: [], counts: { musicbrainz: 0, discogs: 0 } };
    let mbResults = [];
    let dcResults = [];
    if (mb.status === 'fulfilled') mbResults = mb.value;
    else out.errors.push('MusicBrainz: ' + mb.reason.message);
    if (dc.status === 'fulfilled') {
      dcResults = dc.value.results;
      if (dc.value.error) out.errors.push(dc.value.error);
    } else {
      out.errors.push('Discogs: ' + dc.reason.message);
    }
    out.counts.musicbrainz = mbResults.length;
    out.counts.discogs = dcResults.length;
    out.results = interleave(dcResults, mbResults);
    return out;
  }

  /** Lista utworów jako tekst, po jednym w wierszu. Zwraca { text, error } - błąd nie jest już cichy. */
  async function fetchTracklist(source, sourceId) {
    if (source === 'MusicBrainz') {
      const res = await req(MB_RELEASE + encodeURIComponent(sourceId) + '?inc=recordings&fmt=json', { Accept: 'application/json' });
      if (!res.ok) return { text: '', error: 'MusicBrainz: HTTP ' + res.status };
      const data = await res.json();
      const media = data.media || [];
      const multi = media.length > 1;
      const lines = [];
      for (const m of media) {
        for (const t of m.tracks || []) {
          const title = t.title || (t.recording && t.recording.title) || '';
          const dur = msToMinSec(t.length || (t.recording && t.recording.length));
          lines.push((multi ? m.position + '-' : '') + t.position + '. ' + title + (dur ? ' (' + dur + ')' : ''));
        }
      }
      return { text: lines.join('\n'), error: null };
    }
    if (source === 'Discogs') {
      const headers = discogsHeaders();
      if (!headers) return { text: '', error: 'Brak tokenu Discogs — nie można pobrać listy utworów.' };
      const res = await req('https://api.discogs.com/releases/' + encodeURIComponent(sourceId), headers);
      if (!res.ok) return { text: '', error: 'Discogs: HTTP ' + res.status };
      const data = await res.json();
      const text = (data.tracklist || [])
        .filter((t) => t.type_ !== 'heading')
        .map((t) => (t.position ? t.position + '. ' : '') + (t.title || '') + (t.duration ? ' (' + t.duration + ')' : ''))
        .join('\n');
      return { text, error: null };
    }
    return { text: '', error: null };
  }

  /** Okładki pobieramy tylko po https i tylko z serwisów, z których pochodzą wyniki wyszukiwania. */
  function coverHostAllowed(u) {
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return COVER_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  }

  /** Pobiera obraz (okładkę) z limitem rozmiaru. Zwraca Buffer albo null; typ weryfikuje wołający po sygnaturze. */
  async function downloadImage(url, maxBytes = 10 * 1024 * 1024) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!coverHostAllowed(u)) return null;
    const res = await req(url);
    if (!res.ok) return null;
    // Przekierowanie (np. coverartarchive.org -> archive.org) też musi kończyć się na dozwolonym hoście.
    try {
      if (res.url && !coverHostAllowed(new URL(res.url))) return null;
    } catch {
      return null;
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > maxBytes) return null;
    return buf;
  }

  /**
   * Cała kolekcja użytkownika z Discogs (folder 0 = wszystkie), strona po stronie (100 pozycji).
   * `onProgress({ done, total })` pozwala pokazać postęp przy dużych kolekcjach.
   */
  async function fetchCollection(username, { onProgress, maxPages = 100 } = {}) {
    const headers = discogsHeaders();
    if (!headers) throw new Error('Brak tokenu Discogs — dodaj go w Ustawieniach.');
    const releases = [];
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const url =
        'https://api.discogs.com/users/' + encodeURIComponent(username) + '/collection/folders/0/releases?per_page=100&page=' + page + '&sort=added&sort_order=asc';
      const res = await req(url, headers);
      if (res.status === 401) throw new Error('Discogs: nieprawidłowy token.');
      if (res.status === 404) throw new Error('Discogs: nie znaleziono kolekcji użytkownika ' + username + '.');
      if (res.status === 429) throw new Error('Discogs: przekroczono limit zapytań — spróbuj za chwilę.');
      if (!res.ok) throw new Error('Discogs: HTTP ' + res.status);
      const data = await res.json();
      const pages = (data.pagination && data.pagination.pages) || 1;
      total = (data.pagination && data.pagination.items) || total;
      releases.push(...(data.releases || []));
      if (onProgress) onProgress({ done: releases.length, total });
      if (page >= pages) break;
    }
    return { releases, total };
  }

  return { searchRemote, fetchTracklist, verifyDiscogsToken, downloadImage, barcodeVariants, fetchCollection };
}

module.exports = { createLookup, barcodeVariants, interleave };

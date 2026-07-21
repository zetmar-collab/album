const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const dgram = require('dgram');
const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const AdmZip = require('adm-zip');
const QRCode = require('qrcode');

const PHONE_PORT = 8137;
const APP_UA = 'AlbumApp/1.0 (kolekcja muzyczna; https://github.com/zetmar-collab/album)';

let mainWindow = null;
let dataDir = '';
let coversDir = '';
let dataFile = '';
let settingsFile = '';

let items = [];
let settings = { discogsToken: '' };

// ---------- pliki danych ----------

function initPaths() {
  dataDir = path.join(app.getPath('userData'), 'album-data');
  coversDir = path.join(dataDir, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });
  dataFile = path.join(dataDir, 'collection.json');
  settingsFile = path.join(dataDir, 'settings.json');
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function loadAll() {
  items = loadJson(dataFile, []);
  settings = Object.assign({ discogsToken: '' }, loadJson(settingsFile, {}));
}

function saveItems() {
  saveJson(dataFile, items);
}

function coverUrlFor(item) {
  if (!item.coverFile) return null;
  const p = path.join(coversDir, item.coverFile);
  if (!fs.existsSync(p)) return null;
  return pathToFileURL(p).href;
}

function itemForRenderer(item) {
  return Object.assign({}, item, { coverUrl: coverUrlFor(item) });
}

// ---------- wyszukiwanie w bazach ----------

async function searchMusicBrainz(query) {
  const url = 'https://musicbrainz.org/ws/2/release/?query=' + encodeURIComponent(query) + '&fmt=json&limit=8';
  const res = await fetch(url, { headers: { 'User-Agent': APP_UA, Accept: 'application/json' } });
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
  const token = (settings.discogsToken || '').trim();
  if (!token) {
    return { error: 'Brak tokenu Discogs — dodaj go w Ustawieniach, aby przeszukiwać Discogs.', results: [] };
  }
  const qs = new URLSearchParams(Object.assign({}, params, { type: 'release', per_page: '8', token }));
  const res = await fetch('https://api.discogs.com/database/search?' + qs.toString(), {
    headers: { 'User-Agent': APP_UA }
  });
  if (res.status === 401) return { error: 'Discogs: nieprawidłowy token (sprawdź Ustawienia).', results: [] };
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

// Ten sam kod kreskowy bywa zapisany w bazach z zerem wiodącym lub bez
// (UPC-A 12 cyfr vs EAN-13 z zerem) — szukamy wszystkich wariantów.
function barcodeVariants(barcode) {
  const b = String(barcode).replace(/\D/g, '');
  const set = new Set();
  if (b) set.add(b);
  const noZeros = b.replace(/^0+/, '');
  if (noZeros) set.add(noZeros);
  if (b.length === 12) set.add('0' + b);
  return [...set];
}

async function searchDiscogsBarcode(variants) {
  let error = null;
  for (const v of variants) {
    const r = await searchDiscogs({ barcode: v });
    if (r.error) return r;
    if (r.results.length) return r;
  }
  // Discogs czesto przechowuje kody ze spacjami (np. "7 24384 26095 8") i wtedy
  // parametr barcode nie trafia — fallback na wyszukiwanie pelnotekstowe.
  for (const v of variants) {
    const r = await searchDiscogs({ q: v });
    if (r.error) { error = r.error; break; }
    if (r.results.length) return r;
  }
  return { error, results: [] };
}

async function verifyDiscogsToken(token) {
  if (!token) return { ok: true, empty: true };
  const res = await fetch('https://api.discogs.com/oauth/identity', {
    headers: { 'User-Agent': APP_UA, Authorization: 'Discogs token=' + token }
  });
  if (res.ok) {
    const d = await res.json();
    return { ok: true, username: d.username };
  }
  if (res.status === 401) return { ok: false, message: 'Discogs odrzucił ten token. Skopiuj token ponownie z discogs.com → Settings → Developers.' };
  return { ok: false, message: 'Nie udało się sprawdzić tokenu (Discogs: HTTP ' + res.status + ').' };
}

// Wspólne wyszukiwanie: po kodzie kreskowym albo po tekście.
async function searchRemote({ barcode, query }) {
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
  // Przeplot wyników, żeby oba serwisy były widoczne od razu na górze listy.
  const n = Math.max(mbResults.length, dcResults.length);
  for (let i = 0; i < n; i++) {
    if (dcResults[i]) out.results.push(dcResults[i]);
    if (mbResults[i]) out.results.push(mbResults[i]);
  }
  return out;
}

function msToMinSec(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Lista utworów jako tekst, po jednym utworze w wierszu: "1. Tytuł (3:45)".
async function fetchTracklist(source, sourceId) {
  if (source === 'MusicBrainz') {
    const res = await fetch('https://musicbrainz.org/ws/2/release/' + encodeURIComponent(sourceId) + '?inc=recordings&fmt=json', {
      headers: { 'User-Agent': APP_UA, Accept: 'application/json' }
    });
    if (!res.ok) return '';
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
    return lines.join('\n');
  }
  if (source === 'Discogs') {
    const token = (settings.discogsToken || '').trim();
    if (!token) return '';
    const res = await fetch('https://api.discogs.com/releases/' + encodeURIComponent(sourceId) + '?token=' + encodeURIComponent(token), {
      headers: { 'User-Agent': APP_UA }
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.tracklist || [])
      .filter((t) => t.type_ !== 'heading')
      .map((t) => (t.position ? t.position + '. ' : '') + (t.title || '') + (t.duration ? ' (' + t.duration + ')' : ''))
      .join('\n');
  }
  return '';
}

async function downloadCover(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': APP_UA }, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    const ct = res.headers.get('content-type') || '';
    const ext = ct.includes('png') ? '.png' : '.jpg';
    const name = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(coversDir, name), buf);
    return name;
  } catch {
    return null;
  }
}

function deleteCoverFile(name) {
  if (!name) return;
  try {
    fs.unlinkSync(path.join(coversDir, name));
  } catch {}
}

// ---------- odczyt kodu kreskowego ze zdjęcia ----------

let zxingPromise = null;

// W spakowanej aplikacji (asar) moduł nie znajduje sam pliku .wasm — wczytujemy go ręcznie.
function resolveWasmPath() {
  const candidates = [
    path.join(__dirname, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm')
      : null
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

async function getZxing() {
  if (!zxingPromise) {
    zxingPromise = (async () => {
      const mod = await import('zxing-wasm/reader');
      const wasmPath = resolveWasmPath();
      if (wasmPath) {
        const buf = fs.readFileSync(wasmPath);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        mod.prepareZXingModule({ overrides: { wasmBinary: ab } });
      }
      return mod;
    })();
  }
  return zxingPromise;
}

async function decodeBarcodesFromImage(buffer) {
  const { readBarcodes } = await getZxing();
  const results = await readBarcodes(new Uint8Array(buffer), { tryHarder: true, tryRotate: true, tryInvert: true });
  return results.map((r) => r.text).filter((t) => t && /^[0-9]{7,14}$/.test(t.replace(/\s/g, '')));
}

// ---------- serwer dla telefonu ----------

let phoneServer = null;

// Wszystkie sensowne adresy IPv4 (bez link-local 169.254.x i pętli zwrotnej).
function getAllLanIps() {
  const ifaces = os.networkInterfaces();
  const all = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) all.push(i.address);
    }
  }
  return all;
}

// Adres interfejsu, którym komputer faktycznie wychodzi do internetu
// (sztuczka z UDP connect — nic nie jest wysyłane).
function detectRouteIp() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const s = dgram.createSocket('udp4');
      s.on('error', () => { try { s.close(); } catch {} finish(null); });
      s.connect(53, '8.8.8.8', () => {
        let addr = null;
        try { addr = s.address().address; } catch {}
        try { s.close(); } catch {}
        finish(addr);
      });
      setTimeout(() => finish(null), 1500);
    } catch {
      finish(null);
    }
  });
}

async function getLanIp() {
  const all = getAllLanIps();
  const routeIp = await detectRouteIp();
  if (routeIp && all.includes(routeIp)) return routeIp;
  return all.find((a) => a.startsWith('192.168.')) || all.find((a) => a.startsWith('10.')) || all[0] || '127.0.0.1';
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function handleIncomingBarcode(barcode) {
  const lookup = await searchRemote({ barcode });
  sendToRenderer('phone-event', { type: 'barcode', barcode, results: lookup.results, errors: lookup.errors, counts: lookup.counts });
  return lookup;
}

function startPhoneServer() {
  const srv = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  srv.get('/', (req, res) => res.sendFile(path.join(__dirname, 'phone', 'phone.html')));

  srv.post('/api/barcode', express.json(), async (req, res) => {
    const barcode = String((req.body && req.body.barcode) || '').replace(/\D/g, '');
    if (barcode.length < 7) return res.json({ ok: false, message: 'Nieprawidłowy kod (za krótki).' });
    try {
      const lookup = await handleIncomingBarcode(barcode);
      res.json({ ok: true, barcode, found: lookup.results.length });
    } catch (e) {
      res.json({ ok: false, message: 'Błąd wyszukiwania: ' + e.message });
    }
  });

  srv.post('/api/photo', upload.single('photo'), async (req, res) => {
    if (!req.file) return res.json({ ok: false, message: 'Brak zdjęcia.' });
    try {
      const codes = await decodeBarcodesFromImage(req.file.buffer);
      if (!codes.length) {
        return res.json({ ok: false, message: 'Nie wykryto kodu kreskowego. Zrób zdjęcie bliżej, przy dobrym świetle.' });
      }
      const barcode = codes[0].replace(/\s/g, '');
      const lookup = await handleIncomingBarcode(barcode);
      res.json({ ok: true, barcode, found: lookup.results.length });
    } catch (e) {
      res.json({ ok: false, message: 'Błąd odczytu zdjęcia: ' + e.message });
    }
  });

  srv.post('/api/cover', upload.single('photo'), (req, res) => {
    if (!req.file) return res.json({ ok: false, message: 'Brak zdjęcia.' });
    const ext = (req.file.mimetype || '').includes('png') ? '.png' : '.jpg';
    const name = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(coversDir, name), req.file.buffer);
    sendToRenderer('phone-event', { type: 'cover', coverFile: name, coverUrl: pathToFileURL(path.join(coversDir, name)).href });
    res.json({ ok: true });
  });

  phoneServer = srv.listen(PHONE_PORT, '0.0.0.0');
  phoneServer.on('error', (e) => {
    console.error('Serwer telefonu nie wystartował:', e.message);
    phoneServer = null;
  });
}

// ---------- IPC ----------

function setupIpc() {
  ipcMain.handle('items:list', () => items.map(itemForRenderer));

  ipcMain.handle('items:save', async (ev, item) => {
    const clean = {
      id: item.id || crypto.randomUUID(),
      format: ['vinyl', 'cd', 'cassette'].includes(item.format) ? item.format : 'vinyl',
      artist: String(item.artist || '').trim(),
      title: String(item.title || '').trim(),
      year: String(item.year || '').trim(),
      label: String(item.label || '').trim(),
      catalogNumber: String(item.catalogNumber || '').trim(),
      barcode: String(item.barcode || '').trim(),
      genre: String(item.genre || '').trim(),
      country: String(item.country || '').trim(),
      condition: String(item.condition || '').trim(),
      tracklist: String(item.tracklist || '').trim(),
      notes: String(item.notes || '').trim(),
      coverFile: item.coverFile || null,
      source: item.source || null,
      sourceId: item.sourceId || null,
      addedAt: item.addedAt || new Date().toISOString()
    };
    if (item.newCoverUrl) {
      const name = await downloadCover(item.newCoverUrl);
      if (name) {
        if (clean.coverFile) deleteCoverFile(clean.coverFile);
        clean.coverFile = name;
      }
    }
    const idx = items.findIndex((i) => i.id === clean.id);
    if (idx > -1) {
      const oldCover = items[idx].coverFile;
      if (oldCover && oldCover !== clean.coverFile) deleteCoverFile(oldCover);
      items[idx] = clean;
    } else {
      items.push(clean);
    }
    saveItems();
    return itemForRenderer(clean);
  });

  ipcMain.handle('items:delete', (ev, id) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx > -1) {
      deleteCoverFile(items[idx].coverFile);
      items.splice(idx, 1);
      saveItems();
    }
    return true;
  });

  ipcMain.handle('search:remote', (ev, params) => searchRemote(params || {}));

  ipcMain.handle('lookup:tracks', (ev, p) =>
    fetchTracklist((p && p.source) || '', (p && p.sourceId) || '').catch(() => '')
  );

  ipcMain.handle('settings:get', () => settings);

  ipcMain.handle('settings:status', async () => {
    const token = (settings.discogsToken || '').trim();
    if (!token) return { hasToken: false };
    try {
      const check = await verifyDiscogsToken(token);
      return { hasToken: true, valid: check.ok, username: check.username || null, message: check.message || null };
    } catch (e) {
      return { hasToken: true, valid: null, message: 'Brak połączenia z Discogs (' + e.message + ')' };
    }
  });

  ipcMain.handle('open:discogsTokenPage', () => {
    shell.openExternal('https://www.discogs.com/settings/developers');
    return true;
  });

  ipcMain.handle('settings:set', async (ev, s) => {
    const token = String((s && s.discogsToken) || '').trim();
    let check;
    try {
      check = await verifyDiscogsToken(token);
    } catch (e) {
      check = { ok: false, message: 'Brak połączenia z Discogs (' + e.message + '). Token nie został zapisany.' };
    }
    if (!check.ok) return { ok: false, message: check.message };
    settings = Object.assign({}, settings, { discogsToken: token });
    saveJson(settingsFile, settings);
    return { ok: true, username: check.username || null, empty: !!check.empty };
  });

  ipcMain.handle('cover:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Wybierz okładkę',
      filters: [{ name: 'Obrazy', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const ext = path.extname(src).toLowerCase() || '.jpg';
    const name = crypto.randomUUID() + ext;
    fs.copyFileSync(src, path.join(coversDir, name));
    return { coverFile: name, coverUrl: pathToFileURL(path.join(coversDir, name)).href };
  });

  ipcMain.handle('phone:info', async () => {
    const main = await getLanIp();
    const url = 'http://' + main + ':' + PHONE_PORT + '/';
    const qr = await QRCode.toDataURL(url, { width: 260, margin: 1 });
    const altUrls = getAllLanIps()
      .filter((a) => a !== main)
      .map((a) => 'http://' + a + ':' + PHONE_PORT + '/');
    return { url, qr, altUrls, serverOk: !!phoneServer };
  });

  ipcMain.handle('export:excel', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Eksport kolekcji do Excela',
      defaultPath: path.join(app.getPath('documents'), 'Album-kolekcja-' + today + '.xlsx'),
      filters: [{ name: 'Skoroszyt Excel', extensions: ['xlsx'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const FORMAT_PL = { vinyl: 'Winyl', cd: 'CD', cassette: 'Kaseta' };
      const rows = items.map((i) => ({
        'Format': FORMAT_PL[i.format] || i.format,
        'Wykonawca': i.artist,
        'Tytuł': i.title,
        'Rok': i.year,
        'Wytwórnia': i.label,
        'Nr katalogowy': i.catalogNumber,
        'Kod kreskowy': i.barcode,
        'Gatunek': i.genre,
        'Kraj': i.country,
        'Stan': i.condition,
        'Liczba utworów': i.tracklist ? i.tracklist.split('\n').filter((l) => l.trim()).length : '',
        'Lista utworów': i.tracklist || '',
        'Notatki': i.notes,
        'Data dodania': (i.addedAt || '').slice(0, 10)
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [8, 26, 32, 6, 20, 14, 15, 16, 8, 18, 10, 50, 30, 12].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Kolekcja');
      XLSX.writeFile(wb, r.filePath);
      return { ok: true, path: r.filePath, count: rows.length };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('backup:export', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Zapisz kopię zapasową',
      defaultPath: path.join(app.getPath('documents'), 'Album-kopia-' + today + '.zip'),
      filters: [{ name: 'Kopia zapasowa Album (ZIP)', extensions: ['zip'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const zip = new AdmZip();
      saveItems();
      zip.addLocalFile(dataFile, '', 'collection.json');
      if (fs.existsSync(settingsFile)) zip.addLocalFile(settingsFile, '', 'settings.json');
      if (fs.existsSync(coversDir)) zip.addLocalFolder(coversDir, 'covers');
      zip.writeZip(r.filePath);
      return { ok: true, path: r.filePath, count: items.length };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Wybierz plik kopii zapasowej',
      filters: [{ name: 'Kopia zapasowa Album (ZIP)', extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const zip = new AdmZip(r.filePaths[0]);
      const entry = zip.getEntry('collection.json');
      if (!entry) return { ok: false, message: 'To nie jest kopia zapasowa aplikacji Album (brak collection.json).' };
      const incoming = JSON.parse(zip.readAsText(entry));
      if (!Array.isArray(incoming)) return { ok: false, message: 'Uszkodzony plik kopii zapasowej.' };

      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Przywróć', 'Anuluj'],
        defaultId: 1,
        cancelId: 1,
        title: 'Przywracanie kopii zapasowej',
        message: 'Przywrócić kopię zapasową?',
        detail:
          'Kopia zawiera ' + incoming.length + ' pozycji.\n' +
          'Obecna kolekcja (' + items.length + ' pozycji) zostanie ZASTĄPIONA.'
      });
      if (choice.response !== 0) return { ok: false, canceled: true };

      fs.rmSync(coversDir, { recursive: true, force: true });
      fs.mkdirSync(coversDir, { recursive: true });
      for (const e of zip.getEntries()) {
        if (!e.isDirectory && e.entryName.startsWith('covers/')) {
          const base = path.basename(e.entryName);
          fs.writeFileSync(path.join(coversDir, base), e.getData());
        }
      }
      items = incoming;
      saveItems();
      const s = zip.getEntry('settings.json');
      if (s) {
        try {
          const imported = JSON.parse(zip.readAsText(s));
          if (imported && typeof imported.discogsToken === 'string' && !settings.discogsToken) {
            settings.discogsToken = imported.discogsToken;
            saveJson(settingsFile, settings);
          }
        } catch {}
      }
      sendToRenderer('data-changed', {});
      return { ok: true, count: items.length };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
}

// ---------- okno ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14151a',
    title: 'Album',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => (mainWindow = null));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    initPaths();
    loadAll();
    setupIpc();
    startPhoneServer();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (phoneServer) phoneServer.close();
    app.quit();
  });
}

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const dgram = require('dgram');
const XLSX = require('xlsx');
const QRCode = require('qrcode');

const { saveJsonAtomic, loadJsonRecovering, safeBaseName, coverPath, sanitizeItem, sanitizeItems } = require('./lib/storage');
const { readBackup, applyBackup, writeBackup } = require('./lib/backup');
const { createLookup } = require('./lib/lookup');
const { createPhoneApp } = require('./lib/phoneServer');
const { sniffImage } = require('./lib/image');

const PHONE_PORT = 8137;
const PHONE_IDLE_MS = 15 * 60 * 1000;
const PHONE_COVER_MAX_DIM = 2000;
const APP_UA = 'AlbumApp/1.0 (kolekcja muzyczna; https://github.com/zetmar-collab/album)';

let mainWindow = null;
let dataDir = '';
let coversDir = '';
let dataFile = '';
let settingsFile = '';

let items = [];
let settings = { discogsToken: '' };
let loadReport = { status: 'ok', corruptPath: null, skipped: 0 };

// Okładki wgrane w tej sesji edycji (z dysku lub z telefonu), jeszcze nie zapisane przy pozycji.
// Tylko takie pliki wolno usunąć po anulowaniu edycji.
const sessionCovers = new Set();

const lookup = createLookup({ getToken: () => settings.discogsToken, userAgent: APP_UA });

// ---------- pliki danych ----------

function initPaths() {
  dataDir = path.join(app.getPath('userData'), 'album-data');
  coversDir = path.join(dataDir, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });
  dataFile = path.join(dataDir, 'collection.json');
  settingsFile = path.join(dataDir, 'settings.json');
}

/** Szyfrowanie tokenu systemowym magazynem (DPAPI/Keychain/libsecret); na Linuksie bez keyringu zostaje zwykły tekst. */
function encryptionUsable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch {
    return false;
  }
}

function loadSettings() {
  const r = loadJsonRecovering(settingsFile, {}, (v) => v && typeof v === 'object' && !Array.isArray(v));
  const o = r.value;
  let token = '';
  if (typeof o.discogsTokenEnc === 'string') {
    try {
      token = safeStorage.decryptString(Buffer.from(o.discogsTokenEnc, 'base64'));
    } catch {
      token = '';
    }
  } else if (typeof o.discogsToken === 'string') {
    token = o.discogsToken;
  }
  settings = { discogsToken: token.trim() };
}

function saveSettings() {
  const out = {};
  if (settings.discogsToken) {
    if (encryptionUsable()) {
      try {
        out.discogsTokenEnc = safeStorage.encryptString(settings.discogsToken).toString('base64');
      } catch {
        out.discogsToken = settings.discogsToken;
      }
    } else {
      out.discogsToken = settings.discogsToken;
    }
  }
  saveJsonAtomic(settingsFile, out);
}

function loadAll() {
  const r = loadJsonRecovering(dataFile, [], Array.isArray);
  const clean = sanitizeItems(r.value);
  items = clean.items;
  loadReport = { status: r.status, corruptPath: r.corruptPath, skipped: clean.skipped };
  loadSettings();
}

function saveItems() {
  saveJsonAtomic(dataFile, items);
}

function coverUrlFor(item) {
  const p = coverPath(coversDir, item.coverFile);
  if (!p || !fs.existsSync(p)) return null;
  return pathToFileURL(p).href;
}

function itemForRenderer(item) {
  return Object.assign({}, item, { coverUrl: coverUrlFor(item) });
}

function deleteCoverFile(name) {
  const p = coverPath(coversDir, name);
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    /* plik mógł już nie istnieć */
  }
}

/** Informuje o problemach z plikiem danych po starcie, żeby nic nie znikało po cichu. */
function reportLoadProblems() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { status, corruptPath, skipped } = loadReport;
  const lines = [];
  let type = 'warning';
  if (status === 'corrupt') {
    lines.push('Plik kolekcji był uszkodzony i nie udało się go odzyskać. Aplikacja wystartowała z pustą kolekcją.');
    lines.push('Możesz przywrócić dane z kopii zapasowej (Ustawienia → Przywróć z kopii).');
    type = 'error';
  } else if (status === 'restored') {
    lines.push('Plik kolekcji był uszkodzony — przywrócono ostatnią poprawną wersję (plik .bak).');
  }
  if (corruptPath) lines.push('Uszkodzony plik zachowano jako:\n' + corruptPath);
  if (skipped > 0) lines.push('Pominięto ' + skipped + ' nieprawidłowych pozycji w pliku kolekcji.');
  if (!lines.length) return;
  dialog.showMessageBox(mainWindow, { type, title: 'Album — dane kolekcji', message: 'Problem z plikiem kolekcji', detail: lines.join('\n\n'), buttons: ['OK'] });
}

// ---------- okładki ----------

async function downloadCover(url) {
  try {
    const buf = await lookup.downloadImage(url);
    if (!buf) return null;
    const ext = sniffImage(buf);
    if (!ext) return null;
    const name = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(coversDir, name), buf);
    return name;
  } catch {
    return null;
  }
}

/**
 * Okładka z telefonu: obraz jest weryfikowany po sygnaturze, a zbyt duży zmniejszany
 * (telefon zwykle zmniejsza już sam, to tylko zabezpieczenie). Zwraca { coverFile, coverUrl } albo null.
 */
function storePhoneCover(buf) {
  const ext = sniffImage(buf);
  if (!ext) return null;
  let out = buf;
  let outExt = ext;
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (Math.max(width, height) > PHONE_COVER_MAX_DIM) {
      const scaled =
        width >= height ? img.resize({ width: PHONE_COVER_MAX_DIM, quality: 'good' }) : img.resize({ height: PHONE_COVER_MAX_DIM, quality: 'good' });
      out = scaled.toJPEG(88);
      outExt = '.jpg';
    }
  } catch {
    return null;
  }
  const name = crypto.randomUUID() + outExt;
  const full = path.join(coversDir, name);
  fs.writeFileSync(full, out);
  sessionCovers.add(name);
  return { coverFile: name, coverUrl: pathToFileURL(full).href };
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
    } catch {
      /* próbujemy kolejną ścieżkę */
    }
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

// ---------- serwer dla telefonu (uruchamiany na żądanie, z tokenem sesji) ----------

let phoneServer = null;
let phoneToken = '';
let phoneIdleTimer = null;

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
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const s = dgram.createSocket('udp4');
      s.on('error', () => {
        try {
          s.close();
        } catch {
          /* gniazdo już zamknięte */
        }
        finish(null);
      });
      s.connect(53, '8.8.8.8', () => {
        let addr = null;
        try {
          addr = s.address().address;
        } catch {
          /* brak adresu */
        }
        try {
          s.close();
        } catch {
          /* gniazdo już zamknięte */
        }
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
  const result = await lookup.searchRemote({ barcode });
  sendToRenderer('phone-event', { type: 'barcode', barcode, results: result.results, errors: result.errors, counts: result.counts });
  return result;
}

function touchPhone() {
  if (phoneIdleTimer) clearTimeout(phoneIdleTimer);
  phoneIdleTimer = setTimeout(() => stopPhoneServer('bezczynność'), PHONE_IDLE_MS);
}

function stopPhoneServer(reason) {
  if (phoneIdleTimer) {
    clearTimeout(phoneIdleTimer);
    phoneIdleTimer = null;
  }
  if (!phoneServer) return;
  const srv = phoneServer;
  phoneServer = null;
  phoneToken = '';
  try {
    srv.close();
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
  } catch {
    /* serwer już zatrzymany */
  }
  if (reason) sendToRenderer('phone-event', { type: 'stopped', reason });
}

function startPhoneServer() {
  if (phoneServer) {
    touchPhone();
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const token = crypto.randomBytes(16).toString('hex');
    const expressApp = createPhoneApp({
      token,
      pageFile: path.join(__dirname, 'phone', 'phone.html'),
      onBarcode: handleIncomingBarcode,
      onCover: (saved) => sendToRenderer('phone-event', { type: 'cover', coverFile: saved.coverFile, coverUrl: saved.coverUrl }),
      decodeBarcodes: decodeBarcodesFromImage,
      processCover: async (buf) => storePhoneCover(buf),
      onActivity: touchPhone
    });
    const srv = expressApp.listen(PHONE_PORT, '0.0.0.0');
    srv.once('listening', () => {
      phoneServer = srv;
      phoneToken = token;
      touchPhone();
      resolve(true);
    });
    srv.once('error', (e) => {
      console.error('Serwer telefonu nie wystartował:', e.message);
      resolve(false);
    });
  });
}

// ---------- IPC ----------

function setupIpc() {
  ipcMain.handle('items:list', () => items.map(itemForRenderer));

  ipcMain.handle('items:save', async (ev, raw) => {
    const clean = sanitizeItem(raw);
    if (!clean) throw new Error('Nieprawidłowe dane pozycji.');
    let coverFailed = false;
    if (raw && raw.newCoverUrl) {
      const name = await downloadCover(String(raw.newCoverUrl));
      if (name) {
        if (clean.coverFile) deleteCoverFile(clean.coverFile);
        clean.coverFile = name;
      } else {
        coverFailed = true;
      }
    }
    const idx = items.findIndex((i) => i.id === clean.id);
    if (idx > -1) {
      const oldCover = items[idx].coverFile;
      if (oldCover && oldCover !== clean.coverFile && !items.some((o, k) => k !== idx && o.coverFile === oldCover)) deleteCoverFile(oldCover);
      items[idx] = clean;
    } else {
      items.push(clean);
    }
    if (clean.coverFile) sessionCovers.delete(clean.coverFile);
    saveItems();
    return Object.assign(itemForRenderer(clean), { coverFailed });
  });

  ipcMain.handle('items:delete', (ev, id) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx > -1) {
      const cover = items[idx].coverFile;
      items.splice(idx, 1);
      if (cover && !items.some((o) => o.coverFile === cover)) deleteCoverFile(cover);
      saveItems();
    }
    return true;
  });

  // Usuwa okładki wgrane w anulowanej/zakończonej edycji - wyłącznie te z bieżącej sesji i nieużywane przez żadną pozycję.
  ipcMain.handle('cover:discard', (ev, names) => {
    for (const n of Array.isArray(names) ? names : []) {
      const base = safeBaseName(n);
      if (!base || !sessionCovers.has(base)) continue;
      sessionCovers.delete(base);
      if (!items.some((i) => i.coverFile === base)) deleteCoverFile(base);
    }
    return true;
  });

  ipcMain.handle('search:remote', (ev, params) => lookup.searchRemote(params || {}));

  ipcMain.handle('lookup:tracks', async (ev, p) => {
    try {
      return await lookup.fetchTracklist((p && p.source) || '', (p && p.sourceId) || '');
    } catch (e) {
      return { text: '', error: e.message };
    }
  });

  ipcMain.handle('settings:get', () => settings);

  ipcMain.handle('settings:status', async () => {
    const token = (settings.discogsToken || '').trim();
    if (!token) return { hasToken: false };
    try {
      const check = await lookup.verifyDiscogsToken(token);
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
      check = await lookup.verifyDiscogsToken(token);
    } catch (e) {
      check = { ok: false, message: 'Brak połączenia z Discogs (' + e.message + '). Token nie został zapisany.' };
    }
    if (!check.ok) return { ok: false, message: check.message };
    settings = Object.assign({}, settings, { discogsToken: token });
    saveSettings();
    return { ok: true, username: check.username || null, empty: !!check.empty };
  });

  ipcMain.handle('cover:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Wybierz okładkę',
      filters: [{ name: 'Obrazy', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = fs.readFileSync(r.filePaths[0]);
    const ext = sniffImage(buf);
    if (!ext) {
      dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Ten plik nie jest obsługiwanym obrazem.', buttons: ['OK'] });
      return null;
    }
    const name = crypto.randomUUID() + ext;
    const full = path.join(coversDir, name);
    fs.writeFileSync(full, buf);
    sessionCovers.add(name);
    return { coverFile: name, coverUrl: pathToFileURL(full).href };
  });

  ipcMain.handle('phone:info', async () => {
    const ok = await startPhoneServer();
    const main = await getLanIp();
    const withToken = (ip) => 'http://' + ip + ':' + PHONE_PORT + '/?t=' + phoneToken;
    const url = withToken(main);
    const qr = await QRCode.toDataURL(url, { width: 260, margin: 1 });
    const altUrls = getAllLanIps()
      .filter((a) => a !== main)
      .map(withToken);
    return { url, qr, altUrls, serverOk: ok, idleMinutes: PHONE_IDLE_MS / 60000 };
  });

  ipcMain.handle('phone:stop', () => {
    stopPhoneServer('zakończono ręcznie');
    return true;
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

    // Token Discogs to sekret - do kopii trafia tylko za wyraźną zgodą (domyślnie: bez tokenu).
    let includeToken = false;
    if (settings.discogsToken) {
      const ask = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Bez tokenu (zalecane)', 'Dołącz token', 'Anuluj'],
        defaultId: 0,
        cancelId: 2,
        title: 'Kopia zapasowa',
        message: 'Czy dołączyć token Discogs do kopii zapasowej?',
        detail: 'Kopię łatwo przesłać dalej (e-mail, chmura). Token daje dostęp do Twojego konta Discogs — dołącz go tylko, jeśli kopia zostaje wyłącznie u Ciebie.'
      });
      if (ask.response === 2) return { ok: false, canceled: true };
      includeToken = ask.response === 1;
    }

    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Zapisz kopię zapasową',
      defaultPath: path.join(app.getPath('documents'), 'Album-kopia-' + today + '.zip'),
      filters: [{ name: 'Kopia zapasowa Album (ZIP)', extensions: ['zip'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const res = writeBackup(r.filePath, { items, coversDir, token: includeToken ? settings.discogsToken : '' });
      return { ok: true, path: r.filePath, count: res.count, tokenIncluded: includeToken };
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
      const backup = readBackup(r.filePaths[0]);
      const detail =
        'Kopia zawiera ' + backup.items.length + ' pozycji' +
        (backup.skipped ? ' (pominięto ' + backup.skipped + ' nieprawidłowych)' : '') + '.\n' +
        'Obecna kolekcja (' + items.length + ' pozycji) zostanie ZASTĄPIONA.\n' +
        'Poprzednia wersja pliku kolekcji zostanie zachowana jako collection.json.bak.';
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Przywróć', 'Anuluj'],
        defaultId: 1,
        cancelId: 1,
        title: 'Przywracanie kopii zapasowej',
        message: 'Przywrócić kopię zapasową?',
        detail
      });
      if (choice.response !== 0) return { ok: false, canceled: true };

      applyBackup(backup, { dataFile, coversDir });
      items = backup.items;
      sessionCovers.clear();
      if (backup.token && !settings.discogsToken) {
        settings = Object.assign({}, settings, { discogsToken: backup.token });
        saveSettings();
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
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Interfejs jest lokalny - nie wpuszczamy żadnych nowych okien ani nawigacji poza aplikację.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.once('did-finish-load', reportLoadProblems);
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
    createWindow();
  });

  app.on('window-all-closed', () => {
    stopPhoneServer();
    app.quit();
  });
}

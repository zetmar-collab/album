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
const { createBarcodeDecoder } = require('./lib/barcode');
const { findOrphanCovers } = require('./lib/orphans');
const { sanitizePrefs } = require('./lib/prefs');
const { SYNC_FILE, hashItems, planSync, mergeItems, extractCovers } = require('./lib/sync');
const { summarize, idsToRefresh } = require('./lib/valuation');
const { mapApiRelease, mapCsv, planImport } = require('./lib/discogsImport');
const { checkLatest } = require('./lib/update');
const i18n = require('./lib/messages');
const t = i18n.t;

const PHONE_PORT = 8137;
const PHONE_IDLE_MS = 15 * 60 * 1000;
const PHONE_COVER_MAX_DIM = 2000;
const REPO = 'zetmar-collab/album';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_UA = 'AlbumApp/1.0 (kolekcja muzyczna; https://github.com/zetmar-collab/album)';

let mainWindow = null;
let dataDir = '';
let coversDir = '';
let dataFile = '';
let settingsFile = '';

let items = [];
let marketFile = '';
let syncStateFile = '';
let marketCache = {}; // { releaseId: { value, currency, forSale, at } } - wyceny z Discogs (osobny plik, nie w pozycjach)
let valueRun = null; // trwające odświeżanie wycen: { cancel: boolean }
let settings = { discogsToken: '', prefs: sanitizePrefs() };
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
  marketFile = path.join(dataDir, 'market-values.json');
  syncStateFile = path.join(dataDir, 'sync-state.json');
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
  settings = { discogsToken: token.trim(), prefs: sanitizePrefs(o.prefs) };
  applyLanguage();
}

/** Język interfejsu: z ustawień albo z języka systemu (polski lub angielski). */
function applyLanguage() {
  i18n.setLang(i18n.resolveLang(settings.prefs.language, app.getLocale()));
}

function saveSettings() {
  const out = { prefs: settings.prefs };
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
  marketCache = loadJsonRecovering(marketFile, {}, (v) => v && typeof v === 'object' && !Array.isArray(v)).value;
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
    lines.push(t('Plik kolekcji był uszkodzony i nie udało się go odzyskać. Aplikacja wystartowała z pustą kolekcją.'));
    lines.push(t('Możesz przywrócić dane z kopii zapasowej (Ustawienia → Przywróć z kopii).'));
    type = 'error';
  } else if (status === 'restored') {
    lines.push(t('Plik kolekcji był uszkodzony — przywrócono ostatnią poprawną wersję (plik .bak).'));
  }
  if (corruptPath) lines.push(t('Uszkodzony plik zachowano jako:\n{path}', { path: corruptPath }));
  if (skipped > 0) lines.push(t('Pominięto {n} nieprawidłowych pozycji w pliku kolekcji.', { n: skipped }));
  if (!lines.length) return;
  dialog.showMessageBox(mainWindow, { type, title: t('Album — dane kolekcji'), message: t('Problem z plikiem kolekcji'), detail: lines.join('\n\n'), buttons: ['OK'] });
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


// W spakowanej aplikacji (asar) moduł nie znajduje sam pliku .wasm — wczytujemy go ręcznie.
function resolveWasmPath() {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm')
      : null,
    path.join(__dirname, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm')
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

// Dekodowanie kodów kreskowych odbywa się w osobnym wątku (lib/barcodeWorker.js). W spakowanej aplikacji
// plik wątku i moduł WASM leżą poza archiwum asar (asarUnpack), bo wątek nie czyta z archiwum.
let barcodeDecoder = null;

function unpacked(p) {
  const marker = 'app.asar' + path.sep;
  const i = p.indexOf(marker);
  return i === -1 ? p : p.slice(0, i) + 'app.asar.unpacked' + path.sep + p.slice(i + marker.length);
}

function decodeBarcodesFromImage(buffer) {
  if (!barcodeDecoder) {
    barcodeDecoder = createBarcodeDecoder({
      wasmPath: resolveWasmPath(),
      workerFile: unpacked(path.join(__dirname, 'lib', 'barcodeWorker.js'))
    });
  }
  return barcodeDecoder.decode(buffer);
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
    if (!clean) throw new Error(t('Nieprawidłowe dane pozycji.'));
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

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    inStore: !!process.windowsStore,
    lang: i18n.getLang(),
    platform: process.platform
  }));

  // Okno aplikacji może zmieniać tylko te preferencje. syncFolder (dokąd trafia kopia kolekcji) ustawia wyłącznie
  // proces główny przez sync:chooseFolder / sync:clear (okno wyboru folderu), a skipVersion przez update:skip.
  const RENDERER_PREFS = ['checkUpdates', 'language', 'currency'];
  ipcMain.handle('prefs:set', (ev, patchObj) => {
    const safe = {};
    for (const k of RENDERER_PREFS) if (patchObj && Object.prototype.hasOwnProperty.call(patchObj, k)) safe[k] = patchObj[k];
    settings = Object.assign({}, settings, { prefs: sanitizePrefs(Object.assign({}, settings.prefs, safe)) });
    saveSettings();
    applyLanguage();
    return settings.prefs;
  });

  // Sprawdzanie aktualizacji: tylko informacja i link do strony wydania - nic nie jest pobierane ani instalowane.
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const r = await checkLatest({ repo: REPO, current });
      settings.prefs.lastUpdateCheck = Date.now();
      saveSettings();
      return Object.assign({ ok: true, current }, r);
    } catch (e) {
      return { ok: false, current, message: e.message };
    }
  });

  ipcMain.handle('update:open', (ev, url) => {
    const u = String(url || '');
    if (u.startsWith('https://github.com/' + REPO + '/releases/')) shell.openExternal(u);
    return true;
  });

  ipcMain.handle('update:skip', (ev, version) => {
    settings = Object.assign({}, settings, { prefs: sanitizePrefs(Object.assign({}, settings.prefs, { skipVersion: String(version || '') })) });
    saveSettings();
    return true;
  });

  ipcMain.handle('settings:status', async () => {
    const token = (settings.discogsToken || '').trim();
    if (!token) return { hasToken: false };
    try {
      const check = await lookup.verifyDiscogsToken(token);
      return { hasToken: true, valid: check.ok, username: check.username || null, message: check.message || null };
    } catch (e) {
      return { hasToken: true, valid: null, message: t('Brak połączenia z Discogs ({message})', { message: e.message }) };
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
      check = { ok: false, message: t('Brak połączenia z Discogs ({message}). Token nie został zapisany.', { message: e.message }) };
    }
    if (!check.ok) return { ok: false, message: check.message };
    settings = Object.assign({}, settings, { discogsToken: token });
    saveSettings();
    return { ok: true, username: check.username || null, empty: !!check.empty };
  });

  ipcMain.handle('cover:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: t('Wybierz okładkę'),
      filters: [{ name: t('Obrazy'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = fs.readFileSync(r.filePaths[0]);
    const ext = sniffImage(buf);
    if (!ext) {
      dialog.showMessageBox(mainWindow, { type: 'warning', message: t('Ten plik nie jest obsługiwanym obrazem.'), buttons: ['OK'] });
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

  // Konserwacja: okładki, do których nic nie się nie odwołuje. Usuwanie tylko po potwierdzeniu i do Kosza.
  ipcMain.handle('covers:orphans', () => {
    const list = findOrphanCovers(coversDir, items, sessionCovers);
    return { count: list.length, bytes: list.reduce((n, o) => n + o.size, 0) };
  });

  ipcMain.handle('covers:cleanup', async () => {
    const list = findOrphanCovers(coversDir, items, sessionCovers);
    if (!list.length) return { ok: true, removed: 0, failed: 0 };
    const mb = (list.reduce((n, o) => n + o.size, 0) / 1048576).toFixed(1);
    const ask = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [t('Przenieś do Kosza'), t('Anuluj')],
      defaultId: 1,
      cancelId: 1,
      title: t('Nieużywane okładki'),
      message: t('Znaleziono nieużywanych okładek: {n} ({mb} MB)', { n: list.length, mb }),
      detail: t('Do tych plików nie odwołuje się żadna pozycja kolekcji. Zostaną przeniesione do Kosza, więc możesz je przywrócić.')
    });
    if (ask.response !== 0) return { ok: false, canceled: true };
    let removed = 0;
    let failed = 0;
    for (const o of list) {
      try {
        await shell.trashItem(path.join(coversDir, o.name));
        removed++;
      } catch {
        failed++;
      }
    }
    return { ok: true, removed, failed };
  });

  // ---------- import kolekcji z Discogs (konto lub plik CSV) ----------

  /** Wspólna część importu: plan, potwierdzenie, zapis, a potem (w tle) pobranie okładek. */
  async function runImport(candidates, skipped) {
    const plan = planImport(items, candidates);
    if (!plan.toAdd.length) return { ok: true, added: 0, duplicates: plan.duplicates, skipped };
    const ask = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [t('import.add', { n: plan.toAdd.length }), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      title: t('import.title'),
      message: t('import.confirm', { n: plan.toAdd.length }),
      detail: t('import.detail', { dup: plan.duplicates, skipped })
    });
    if (ask.response !== 0) return { ok: false, canceled: true };

    const fresh = plan.toAdd.map((c) => sanitizeItem(Object.assign({}, c, { id: null })));
    items.push(...fresh);
    saveItems();
    sendToRenderer('data-changed', { reason: 'import' });

    // Okładki dociągamy po zapisie (maks. 4 naraz) - błąd jednej nie psuje reszty importu.
    const withCover = fresh.map((it, i) => ({ id: it.id, url: plan.toAdd[i].coverUrl })).filter((x) => x.url);
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < withCover.length) {
        const job = withCover[cursor++];
        const name = await downloadCover(job.url);
        const it = items.find((x) => x.id === job.id);
        if (name && it) it.coverFile = name;
        done++;
        sendToRenderer('import-progress', { stage: 'covers', done, total: withCover.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, withCover.length) }, worker));
    if (withCover.length) {
      saveItems();
      sendToRenderer('data-changed', { reason: 'import' });
    }
    return { ok: true, added: fresh.length, duplicates: plan.duplicates, skipped };
  }

  ipcMain.handle('import:discogsApi', async () => {
    try {
      if (!settings.discogsToken) return { ok: false, message: t('import.noToken') };
      const who = await lookup.verifyDiscogsToken(settings.discogsToken);
      if (!who.ok || !who.username) return { ok: false, message: who.message || t('import.noToken') };
      const { releases } = await lookup.fetchCollection(who.username, {
        onProgress: (p) => sendToRenderer('import-progress', { stage: 'fetch', done: p.done, total: p.total })
      });
      const mapped = releases.map(mapApiRelease);
      return await runImport(mapped.filter(Boolean), mapped.filter((x) => !x).length);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('import:discogsCsv', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: t('import.csvOpen'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        properties: ['openFile']
      });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      if (fs.statSync(r.filePaths[0]).size > 20 * 1024 * 1024) return { ok: false, message: t('import.csvTooBig') };
      const parsed = mapCsv(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (parsed.error) return { ok: false, message: t('import.csvBad') };
      return await runImport(parsed.candidates, parsed.skipped);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  // ---------- synchronizacja przez wspólny folder (OneDrive / Dysk / Dropbox) ----------

  const readSyncState = () => loadJsonRecovering(syncStateFile, {}, (v) => v && typeof v === 'object' && !Array.isArray(v)).value;
  const writeSyncState = (folder, hash) => saveJsonAtomic(syncStateFile, { folder, lastHash: hash, at: Date.now() });

  ipcMain.handle('sync:status', () => ({ folder: settings.prefs.syncFolder }));

  ipcMain.handle('sync:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: t('sync.chooseTitle'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    settings = Object.assign({}, settings, { prefs: sanitizePrefs(Object.assign({}, settings.prefs, { syncFolder: r.filePaths[0] })) });
    saveSettings();
    return { ok: true, folder: settings.prefs.syncFolder };
  });

  ipcMain.handle('sync:clear', () => {
    settings = Object.assign({}, settings, { prefs: sanitizePrefs(Object.assign({}, settings.prefs, { syncFolder: '' })) });
    saveSettings();
    return { ok: true };
  });

  ipcMain.handle('sync:run', async () => {
    const folder = settings.prefs.syncFolder;
    if (!folder) return { ok: false, message: t('sync.noFolder') };
    try {
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { ok: false, message: t('sync.folderMissing', { folder }) };
      const file = path.join(folder, SYNC_FILE);
      const remote = fs.existsSync(file) ? readBackup(file) : null;
      const st = readSyncState();
      const lastHash = st.folder === folder ? st.lastHash || null : null;
      const plan = planSync({ localItems: items, remoteItems: remote && remote.items, lastHash });

      const push = () => {
        const tmp = file + '.tmp';
        const res = writeBackup(tmp, { items, coversDir, token: '' }); // token Discogs nigdy nie trafia do folderu synchronizacji
        fs.renameSync(tmp, file);
        writeSyncState(folder, hashItems(items));
        return { ok: true, action: 'push', count: res.count };
      };

      if (plan.action === 'none') {
        writeSyncState(folder, plan.localHash);
        return { ok: true, action: 'none' };
      }
      if (plan.action === 'push') return push();

      if (plan.action === 'pull') {
        const ask = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [t('sync.pull'), t('common.cancel')],
          defaultId: 1,
          cancelId: 1,
          title: t('sync.pullTitle'),
          message: t('sync.pullMessage', { remote: remote.items.length }),
          detail: t('sync.pullDetail', { local: items.length })
        });
        if (ask.response !== 0) return { ok: false, canceled: true };
        applyBackup(remote, { dataFile, coversDir });
        items = remote.items;
        sessionCovers.clear();
        writeSyncState(folder, hashItems(items));
        sendToRenderer('data-changed', { reason: 'sync' });
        return { ok: true, action: 'pull', count: items.length };
      }

      // merge
      const m = mergeItems(items, remote.items);
      const ask = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [t('sync.merge'), t('common.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: t('sync.pullTitle'),
        message: t('sync.mergeMessage'),
        detail: t('sync.mergeDetail', { added: m.added.length, conflicts: m.conflicts })
      });
      if (ask.response !== 0) return { ok: false, canceled: true };
      extractCovers(remote.zip, m.added.map((i) => i.coverFile).filter(Boolean), coversDir);
      items = m.items;
      saveItems();
      const res = push();
      sendToRenderer('data-changed', { reason: 'sync' });
      return { ok: true, action: 'merge', added: m.added.length, conflicts: m.conflicts, count: res.count };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  // ---------- wycena kolekcji (najniższe oferty na Discogs) ----------

  ipcMain.handle('value:get', () => summarize(items, marketCache, settings.prefs.currency));

  ipcMain.handle('value:cancel', () => {
    if (valueRun) valueRun.cancel = true;
    return true;
  });

  ipcMain.handle('value:refresh', async () => {
    if (!settings.discogsToken) return { ok: false, message: t('value.noToken') };
    if (valueRun) return { ok: false, message: 'busy' };
    const currency = settings.prefs.currency;
    const ids = idsToRefresh(items, marketCache, currency);
    valueRun = { cancel: false };
    try {
      let done = 0;
      for (const id of ids) {
        if (valueRun.cancel) break;
        const r = await lookup.fetchMarketStats(id, currency);
        // brak ofert też zapamiętujemy (wartość 0 nie jest liczona), żeby nie pytać w kółko
        marketCache[id] = r ? { value: r.value, currency: r.currency, forSale: r.forSale, at: Date.now() } : { value: null, currency, forSale: 0, at: Date.now() };
        done++;
        sendToRenderer('value-progress', { done, total: ids.length });
        await new Promise((resolve) => setTimeout(resolve, 1100)); // limit Discogs: 60 zapytań/min
      }
      saveJsonAtomic(marketFile, marketCache);
      return Object.assign({ ok: true, canceled: valueRun.cancel }, summarize(items, marketCache, currency));
    } catch (e) {
      saveJsonAtomic(marketFile, marketCache); // zachowujemy to, co już pobrano
      return { ok: false, message: e.message };
    } finally {
      valueRun = null;
    }
  });

  ipcMain.handle('export:excel', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: t('Eksport kolekcji do Excela'),
      defaultPath: path.join(app.getPath('documents'), 'Album-kolekcja-' + today + '.xlsx'),
      filters: [{ name: t('Skoroszyt Excel'), extensions: ['xlsx'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const FORMAT_NAME = { vinyl: t('Winyl'), cd: 'CD', cassette: t('Kaseta') };
      const rows = items.map((i) => ({
        [t('Format')]: FORMAT_NAME[i.format] || i.format,
        [t('Wykonawca')]: i.artist,
        [t('Tytuł')]: i.title,
        [t('Rok')]: i.year,
        [t('Wytwórnia')]: i.label,
        [t('Nr katalogowy')]: i.catalogNumber,
        [t('Kod kreskowy')]: i.barcode,
        [t('Gatunek')]: i.genre,
        [t('Kraj')]: i.country,
        [t('Stan')]: i.condition,
        [t('Liczba utworów')]: i.tracklist ? i.tracklist.split('\n').filter((l) => l.trim()).length : '',
        [t('Lista utworów')]: i.tracklist || '',
        [t('Notatki')]: i.notes,
        [t('Status')]: i.wishlist ? t('wish.chip') : t('W kolekcji'),
        [t('Data dodania')]: (i.addedAt || '').slice(0, 10)
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [8, 26, 32, 6, 20, 14, 15, 16, 8, 18, 10, 50, 30, 14, 12].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, t('Kolekcja'));
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
        buttons: [t('Bez tokenu (zalecane)'), t('Dołącz token'), t('Anuluj')],
        defaultId: 0,
        cancelId: 2,
        title: t('Kopia zapasowa'),
        message: t('Czy dołączyć token Discogs do kopii zapasowej?'),
        detail: t('Kopię łatwo przesłać dalej (e-mail, chmura). Token daje dostęp do Twojego konta Discogs — dołącz go tylko, jeśli kopia zostaje wyłącznie u Ciebie.')
      });
      if (ask.response === 2) return { ok: false, canceled: true };
      includeToken = ask.response === 1;
    }

    const r = await dialog.showSaveDialog(mainWindow, {
      title: t('Zapisz kopię zapasową'),
      defaultPath: path.join(app.getPath('documents'), 'Album-kopia-' + today + '.zip'),
      filters: [{ name: t('Kopia zapasowa Album (ZIP)'), extensions: ['zip'] }]
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
      title: t('Wybierz plik kopii zapasowej'),
      filters: [{ name: t('Kopia zapasowa Album (ZIP)'), extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const backup = readBackup(r.filePaths[0]);
      const detail = t(
        'Kopia zawiera {n} pozycji{skipped}.\nObecna kolekcja ({local} pozycji) zostanie ZASTĄPIONA.\nPoprzednia wersja pliku kolekcji zostanie zachowana jako collection.json.bak.',
        { n: backup.items.length, skipped: backup.skipped ? t(' (pominięto {n} nieprawidłowych)', { n: backup.skipped }) : '', local: items.length }
      );
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: [t('Przywróć'), t('Anuluj')],
        defaultId: 1,
        cancelId: 1,
        title: t('Przywracanie kopii zapasowej'),
        message: t('Przywrócić kopię zapasową?'),
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

/** Raz na dobę (jeśli włączone, i nie w wersji ze Sklepu, która aktualizuje się sama) pyta GitHub o nowe wydanie. */
async function autoCheckUpdates() {
  const p = settings.prefs;
  if (!p.checkUpdates || process.windowsStore) return;
  if (Date.now() - p.lastUpdateCheck < UPDATE_INTERVAL_MS) return;
  try {
    const r = await checkLatest({ repo: REPO, current: app.getVersion() });
    settings.prefs.lastUpdateCheck = Date.now();
    saveSettings();
    if (r.updateAvailable && r.latest !== p.skipVersion.replace(/^v/, '')) {
      sendToRenderer('update-available', { latest: r.latest, current: app.getVersion(), url: r.url });
    }
  } catch {
    /* brak internetu - spróbujemy przy następnym uruchomieniu */
  }
}

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
  mainWindow.webContents.once('did-finish-load', () => {
    reportLoadProblems();
    autoCheckUpdates();
  });
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
    if (barcodeDecoder) barcodeDecoder.close();
    app.quit();
  });
}

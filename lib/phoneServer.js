'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { sniffImage } = require('./image');

/**
 * Aplikacja Express dla telefonu. Każde żądanie (poza limitem zapytań) wymaga tokenu sesji,
 * który jest tylko w kodzie QR pokazywanym w aplikacji - inne urządzenia w sieci nie mogą
 * wgrywać plików ani wywoływać wyszukiwania.
 *
 * Zależności od Electrona wstrzykiwane są z zewnątrz (onBarcode, onCover, decodeBarcodes, processCover),
 * dzięki czemu moduł da się testować samym Node.
 */
function createPhoneApp(opts) {
  const { token, pageFile, onBarcode, onCover, decodeBarcodes, processCover, onActivity = () => {} } = opts;
  const maxFile = opts.maxFileBytes || 8 * 1024 * 1024;
  const perMinute = opts.perMinute || 60;

  const app = express();
  app.disable('x-powered-by');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFile, files: 1, fields: 4, parts: 6 } });

  const hits = new Map();
  function limited(ip) {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 500) hits.clear();
    return arr.length > perMinute;
  }

  function tokenOk(given) {
    if (typeof given !== 'string' || !token || given.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  }

  app.use((req, res, next) => {
    onActivity();
    if (limited(req.ip)) return res.status(429).json({ ok: false, message: 'Zbyt wiele zapytań. Odczekaj chwilę.' });
    next();
  });

  app.get('/', (req, res) => {
    if (!tokenOk(req.query.t)) {
      return res.status(403).type('text/plain; charset=utf-8').send('Zeskanuj kod QR z aplikacji Album, aby połączyć telefon.');
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(pageFile);
  });

  const guard = (req, res, next) => {
    if (tokenOk(req.get('x-album-token'))) return next();
    res.status(403).json({ ok: false, message: 'Sesja wygasła lub brak dostępu — zeskanuj kod QR w aplikacji ponownie.' });
  };

  app.post('/api/barcode', guard, express.json({ limit: '2kb' }), async (req, res) => {
    const barcode = String((req.body && req.body.barcode) || '').replace(/\D/g, '');
    if (barcode.length < 7 || barcode.length > 14) return res.json({ ok: false, message: 'Nieprawidłowy kod (7-14 cyfr).' });
    try {
      const lookup = await onBarcode(barcode);
      res.json({ ok: true, barcode, found: lookup.results.length });
    } catch (e) {
      res.json({ ok: false, message: 'Błąd wyszukiwania: ' + e.message });
    }
  });

  app.post('/api/photo', guard, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.json({ ok: false, message: 'Brak zdjęcia.' });
    if (!sniffImage(req.file.buffer)) return res.status(400).json({ ok: false, message: 'To nie jest zdjęcie.' });
    try {
      const codes = await decodeBarcodes(req.file.buffer);
      if (!codes.length) {
        return res.json({ ok: false, message: 'Nie wykryto kodu kreskowego. Zrób zdjęcie bliżej, przy dobrym świetle.' });
      }
      const barcode = codes[0].replace(/\s/g, '');
      const lookup = await onBarcode(barcode);
      res.json({ ok: true, barcode, found: lookup.results.length });
    } catch (e) {
      res.json({ ok: false, message: 'Błąd odczytu zdjęcia: ' + e.message });
    }
  });

  app.post('/api/cover', guard, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.json({ ok: false, message: 'Brak zdjęcia.' });
    if (!sniffImage(req.file.buffer)) return res.status(400).json({ ok: false, message: 'To nie jest zdjęcie.' });
    try {
      const saved = await processCover(req.file.buffer);
      if (!saved) return res.status(400).json({ ok: false, message: 'Nie udało się przetworzyć zdjęcia.' });
      onCover(saved);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, message: 'Błąd zapisu okładki: ' + e.message });
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, message: 'Zdjęcie jest za duże.' });
    res.status(400).json({ ok: false, message: 'Nieprawidłowe żądanie.' });
  });

  return app;
}

module.exports = { createPhoneApp };

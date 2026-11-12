'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPhoneApp } = require('../lib/phoneServer');

const TOKEN = 'a'.repeat(32);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

async function start(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-phone-'));
  const pageFile = path.join(dir, 'phone.html');
  fs.writeFileSync(pageFile, '<html>strona telefonu</html>');
  const calls = { barcodes: [], covers: [], activity: 0 };
  const app = createPhoneApp({
    token: TOKEN,
    pageFile,
    onBarcode: async (b) => {
      calls.barcodes.push(b);
      return { results: [{}, {}] };
    },
    onCover: (c) => calls.covers.push(c),
    decodeBarcodes: async () => ['5099749534728'],
    processCover: async () => ({ coverFile: 'x.jpg', coverUrl: 'file:///x.jpg' }),
    onActivity: () => calls.activity++,
    ...overrides
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); fs.rmSync(dir, { recursive: true, force: true }); }) };
}

const form = (buf, type = 'image/png') => {
  const fd = new FormData();
  fd.append('photo', new Blob([buf], { type }), 'photo.png');
  return fd;
};

test('strona i API odmawiają dostępu bez tokenu (S1)', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(s.base + '/')).status, 403);
    assert.equal((await fetch(s.base + '/?t=zly')).status, 403);
    // poprawny token z QR: przekierowanie na czysty adres + ciasteczko HttpOnly (token nie zostaje w URL)
    const first = await fetch(s.base + '/?t=' + TOKEN, { redirect: 'manual' });
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), '/');
    const cookie = first.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const pair = cookie.split(';')[0];
    assert.equal((await fetch(s.base + '/', { headers: { cookie: pair } })).status, 200);
    assert.equal((await fetch(s.base + '/', { headers: { cookie: 'album_t=' + 'b'.repeat(32) } })).status, 403);
    // API przyjmuje też samo ciasteczko (bez nagłówka)
    const viaCookie = await fetch(s.base + '/api/barcode', { method: 'POST', headers: { cookie: pair, 'content-type': 'application/json' }, body: '{"barcode":"5099749534728"}' });
    assert.equal(viaCookie.status, 200);
    const r = await fetch(s.base + '/api/barcode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"barcode":"5099749534728"}' });
    assert.equal(r.status, 403);
    const c = await fetch(s.base + '/api/cover', { method: 'POST', body: form(PNG) });
    assert.equal(c.status, 403);
    assert.equal(s.calls.barcodes.length, 1, 'tylko wywołanie z ciasteczkiem dotarło do wyszukiwania');
    assert.equal(s.calls.covers.length, 0);
  } finally {
    await s.close();
  }
});

test('z tokenem: kod kreskowy, zdjęcie i okładka działają', async () => {
  const s = await start();
  try {
    const h = { 'x-album-token': TOKEN };
    const b = await (await fetch(s.base + '/api/barcode', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"barcode":"5099749534728"}' })).json();
    assert.deepEqual([b.ok, b.found], [true, 2]);
    const p = await (await fetch(s.base + '/api/photo', { method: 'POST', headers: h, body: form(PNG) })).json();
    assert.equal(p.ok, true);
    assert.equal(p.barcode, '5099749534728');
    const c = await (await fetch(s.base + '/api/cover', { method: 'POST', headers: h, body: form(PNG) })).json();
    assert.equal(c.ok, true);
    assert.equal(s.calls.covers.length, 1);
    assert.ok(s.calls.activity >= 3);
  } finally {
    await s.close();
  }
});

test('pliki niebędące obrazami są odrzucane, a nieprawidłowe kody nie wywołują wyszukiwania', async () => {
  const s = await start();
  try {
    const h = { 'x-album-token': TOKEN };
    const bad = await fetch(s.base + '/api/cover', { method: 'POST', headers: h, body: form(Buffer.from('#!/bin/sh\nrm -rf /'), 'image/png') });
    assert.equal(bad.status, 400);
    assert.equal(s.calls.covers.length, 0);
    const short = await (await fetch(s.base + '/api/barcode', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"barcode":"123"}' })).json();
    assert.equal(short.ok, false);
    assert.equal(s.calls.barcodes.length, 0);
  } finally {
    await s.close();
  }
});

test('zbyt duży plik daje 413, a limit zapytań 429', async () => {
  const s = await start({ maxFileBytes: 1024, perMinute: 8 });
  try {
    const h = { 'x-album-token': TOKEN };
    const big = Buffer.concat([PNG, Buffer.alloc(5000)]);
    const r = await fetch(s.base + '/api/cover', { method: 'POST', headers: h, body: form(big) });
    assert.equal(r.status, 413);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await fetch(s.base + '/?t=' + TOKEN, { redirect: 'manual' })).status;
    assert.equal(last, 429);
  } finally {
    await s.close();
  }
});

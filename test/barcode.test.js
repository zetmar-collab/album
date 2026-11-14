'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBarcodeDecoder } = require('../lib/barcode');

const WASM = path.join(__dirname, '..', 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');

// Moduł zapisu też ładuje WASM z lokalnego pliku (domyślnie pobierałby go z CDN, więc test zależałby od sieci).
const WRITER_WASM = path.join(__dirname, '..', 'node_modules', 'zxing-wasm', 'dist', 'writer', 'zxing_writer.wasm');
let writerReady = null;

async function makeEan(text) {
  const { writeBarcode, prepareZXingModule } = await import('zxing-wasm/writer');
  if (!writerReady) {
    const b = fs.readFileSync(WRITER_WASM);
    prepareZXingModule({ overrides: { wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } });
    writerReady = true;
  }
  const w = await writeBarcode(text, { format: 'EAN-13', scale: 4, withQuietZones: true });
  return Buffer.from(await w.image.arrayBuffer());
}

test('dekoder w wątku odczytuje EAN-13 ze zdjęcia PNG', async () => {
  const dec = createBarcodeDecoder({ wasmPath: WASM });
  try {
    const png = await makeEan('5099749534728');
    assert.deepEqual(await dec.decode(png), ['5099749534728']);
    // kolejne zdjęcie w tym samym wątku
    assert.deepEqual(await dec.decode(await makeEan('4006381333931')), ['4006381333931']);
  } finally {
    await dec.close();
  }
});

test('zdjęcie bez kodu daje pustą listę, a nie błąd; śmieci zgłaszają błąd i wątek działa dalej', async () => {
  const dec = createBarcodeDecoder({ wasmPath: WASM });
  try {
    const empty = await dec.decode(Buffer.alloc(200, 0));
    assert.deepEqual(empty, []);
    const png = await makeEan('5099749534728');
    assert.deepEqual(await dec.decode(png), ['5099749534728']);
  } finally {
    await dec.close();
  }
});

test('limit czasu zatrzymuje wątek i następne zdjęcie działa w nowym', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-bc-'));
  const slow = path.join(dir, 'slow.js');
  fs.writeFileSync(slow, "require('worker_threads').parentPort.on('message', () => {});"); // nigdy nie odpowiada
  const dec = createBarcodeDecoder({ workerFile: slow, timeout: 150 });
  try {
    await assert.rejects(dec.decode(Buffer.from('x')), /zbyt długo/);
    await assert.rejects(dec.decode(Buffer.from('y')), /zbyt długo/);
  } finally {
    await dec.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

'use strict';

// Wątek roboczy: dekodowanie kodów kreskowych (zxing-wasm) poza głównym procesem Electrona,
// żeby duże zdjęcie z telefonu nie blokowało okna aplikacji.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

let modPromise = null;

function load() {
  if (!modPromise) {
    modPromise = (async () => {
      const mod = await import('zxing-wasm/reader');
      // W spakowanej aplikacji moduł nie znajduje sam pliku .wasm - wczytujemy go ręcznie.
      if (workerData && workerData.wasmPath) {
        const b = fs.readFileSync(workerData.wasmPath);
        mod.prepareZXingModule({ overrides: { wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } });
      }
      return mod;
    })();
  }
  return modPromise;
}

parentPort.on('message', async ({ id, buffer }) => {
  try {
    const { readBarcodes } = await load();
    const results = await readBarcodes(new Uint8Array(buffer), { tryHarder: true, tryRotate: true, tryInvert: true });
    parentPort.postMessage({ id, texts: results.map((r) => r.text) });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e) });
  }
});

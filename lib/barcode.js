'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { t } = require('./messages');

/**
 * Dekoder kodów kreskowych w osobnym wątku. Wątek jest tworzony leniwie, restartowany po awarii
 * i zatrzymywany po przekroczeniu limitu czasu, żeby jedno wadliwe zdjęcie nie blokowało kolejnych.
 */
function createBarcodeDecoder({ wasmPath = null, workerFile = path.join(__dirname, 'barcodeWorker.js'), timeout = 20000 } = {}) {
  let worker = null;
  let seq = 0;
  const pending = new Map();

  // Odrzuca oczekujące żądania danego wątku (nie dotyka żądań już przekazanych nowemu wątkowi).
  function failAll(err, w) {
    for (const [id, p] of pending) {
      if (w && p.worker !== w) continue;
      clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
  }

  function ensure() {
    if (worker) return worker;
    const w = new Worker(workerFile, { workerData: { wasmPath } });
    w.unref(); // nie przytrzymuje zamknięcia aplikacji
    w.on('message', (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.texts || []);
    });
    w.on('error', (e) => failAll(e, w));
    w.on('exit', () => {
      if (worker === w) worker = null;
      failAll(new Error(t('Dekoder kodów kreskowych został zatrzymany.')), w);
    });
    worker = w;
    return w;
  }

  /** Zwraca listę 7-14-cyfrowych kodów znalezionych na zdjęciu (bufor zawiera plik obrazu). */
  function decode(buffer) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const w = ensure();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(t('Odczyt kodu trwał zbyt długo.')));
        // wątek mógł utknąć na tym zdjęciu - zaczynamy od nowa
        if (worker === w) {
          worker = null;
          w.terminate();
        }
      }, timeout);
      pending.set(id, { resolve, reject, timer, worker: w });
      // kopia, bo bufor z multera może być fragmentem większej puli pamięci
      const copy = new Uint8Array(buffer).buffer;
      w.postMessage({ id, buffer: copy }, [copy]);
    }).then((texts) => texts.map((t) => String(t).replace(/\s/g, '')).filter((t) => /^[0-9]{7,14}$/.test(t)));
  }

  function close() {
    if (worker) {
      const w = worker;
      worker = null;
      return w.terminate();
    }
    return Promise.resolve();
  }

  return { decode, close };
}

module.exports = { createBarcodeDecoder };

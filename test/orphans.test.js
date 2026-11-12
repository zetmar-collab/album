'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findOrphanCovers } = require('../lib/orphans');

test('findOrphanCovers: znajduje tylko nieużywane obrazy i respektuje listę wyjątków', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-orph-'));
  fs.writeFileSync(path.join(dir, 'uzywana.jpg'), 'aaaa');
  fs.writeFileSync(path.join(dir, 'sierota.jpg'), 'bbbbbb');
  fs.writeFileSync(path.join(dir, 'edytowana.png'), 'cc');
  fs.writeFileSync(path.join(dir, 'notatki.txt'), 'nie obraz');
  fs.mkdirSync(path.join(dir, 'podkatalog.jpg'));
  const items = [{ id: '1', coverFile: 'uzywana.jpg' }, null, { id: '2', coverFile: null }];

  const orphans = findOrphanCovers(dir, items, new Set(['edytowana.png']));
  assert.deepEqual(orphans, [{ name: 'sierota.jpg', size: 6 }]);

  assert.deepEqual(findOrphanCovers(path.join(dir, 'brak'), items), [], 'brak folderu to brak sierot');
  fs.rmSync(dir, { recursive: true, force: true });
});

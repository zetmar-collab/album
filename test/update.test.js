'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, isNewer, checkLatest } = require('../lib/update');
const { sanitizePrefs, DEFAULTS } = require('../lib/prefs');

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });

test('parseVersion i isNewer porównują numerycznie, nie tekstowo', () => {
  assert.deepEqual(parseVersion('v1.10.2'), [1, 10, 2]);
  assert.equal(parseVersion('abc'), null);
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('v1.2.0', '1.2.0'), false);
  assert.equal(isNewer('1.1.9', '1.2.0'), false);
  assert.equal(isNewer('zepsute', '1.2.0'), false);
});

test('checkLatest: nowsza wersja, ta sama wersja, brak wydań i podejrzany adres', async () => {
  const repo = 'zetmar-collab/album';
  const rel = (tag, url) => ({ tag_name: tag, name: 'Album ' + tag, html_url: url || 'https://github.com/' + repo + '/releases/tag/' + tag });
  assert.equal((await checkLatest({ repo, current: '1.2.0', fetchImpl: async () => json(rel('v1.3.0')) })).updateAvailable, true);
  assert.equal((await checkLatest({ repo, current: '1.2.0', fetchImpl: async () => json(rel('v1.2.0')) })).updateAvailable, false);
  assert.equal((await checkLatest({ repo, current: '1.2.0', fetchImpl: async () => json({}, 404) })).updateAvailable, false);
  await assert.rejects(checkLatest({ repo, current: '1.2.0', fetchImpl: async () => json(rel('v9.0.0', 'https://evil.example/x')) }), /adres/);
  await assert.rejects(checkLatest({ repo, current: '1.2.0', fetchImpl: async () => json({}, 500) }), /HTTP 500/);
});

test('sanitizePrefs: wartości domyślne i odrzucanie nieprawidłowych', () => {
  assert.deepEqual(sanitizePrefs(undefined), { ...DEFAULTS });
  const p = sanitizePrefs({ checkUpdates: 'tak', language: 'de', skipVersion: '<script>', lastUpdateCheck: -5, syncFolder: 'C:\OneDrive\Album' });
  assert.equal(p.checkUpdates, true);
  assert.equal(p.language, 'auto');
  assert.equal(p.skipVersion, '');
  assert.equal(p.lastUpdateCheck, 0);
  assert.equal(p.syncFolder, 'C:\OneDrive\Album');
  assert.equal(sanitizePrefs({ language: 'en', checkUpdates: false }).language, 'en');
});

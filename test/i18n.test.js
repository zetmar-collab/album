'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../renderer/i18n');
const pl = require('../renderer/lang-pl');
const en = require('../renderer/lang-en');

i18n.register('pl', pl);
i18n.register('en', en);

test('słowniki PL i EN mają identyczny zestaw kluczy (nic nie zostaje nieprzetłumaczone)', () => {
  const a = Object.keys(pl).sort();
  const b = Object.keys(en).sort();
  assert.deepEqual(a.filter((k) => !b.includes(k)), [], 'klucze tylko w PL');
  assert.deepEqual(b.filter((k) => !a.includes(k)), [], 'klucze tylko w EN');
});

test('t(): podstawianie parametrów, wybór języka i awaryjny powrót do PL/klucza', () => {
  i18n.setLang('en');
  assert.equal(i18n.t('update.upToDate', { current: '1.2.0' }), 'You have the latest version (1.2.0).');
  i18n.setLang('pl');
  assert.match(i18n.t('update.upToDate', { current: '1.2.0' }), /najnowszą wersję/);
  assert.equal(i18n.t('brak.takiego.klucza'), 'brak.takiego.klucza');
  assert.equal(i18n.t('update.newer', {}), 'Dostępna wersja {latest}.');
});

test('resolveLang: auto wybiera język systemu, a wartości jawne są respektowane', () => {
  assert.equal(i18n.resolveLang('auto', 'pl-PL'), 'pl');
  assert.equal(i18n.resolveLang('auto', 'en-US'), 'en');
  assert.equal(i18n.resolveLang('auto', 'de-DE'), 'en');
  assert.equal(i18n.resolveLang('pl', 'en-US'), 'pl');
  assert.equal(i18n.resolveLang('en', 'pl-PL'), 'en');
});

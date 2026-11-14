'use strict';

// Pilnuje, żeby żaden tekst widoczny dla użytkownika nie został bez angielskiego tłumaczenia:
// każdy literał w wywołaniach t('...') oraz każdy tekst statycznego HTML musi mieć wpis w słowniku EN.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../lib/messages');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const en = i18n._dicts.en;
const pl = i18n._dicts.pl;

// teksty, które wyglądają tak samo w obu językach
const SAME = new Set(['Album', 'CD', 'Format', 'OK', 'Wi‑Fi', 'ZIP', 'Generate new token', 'discogs.com', 'Polski', 'English']);

function sourceKeys(file) {
  const src = read(file);
  const keys = [];
  // t('...') i t("...") - także gdy poprzedza je spacja, nawias lub operator
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    keys.push(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  return keys;
}

test('każdy klucz użyty w t() ma tłumaczenie (nazwane: PL i EN, polskie teksty: EN)', () => {
  const files = ['renderer/app.js', 'main.js', 'lib/backup.js', 'lib/lookup.js', 'lib/net.js', 'lib/update.js', 'lib/barcode.js', 'lib/phoneServer.js'];
  const missing = [];
  for (const f of files) {
    for (const k of sourceKeys(f)) {
      if (/^[a-z]+\.[A-Za-z]+$/.test(k)) {
        if (pl[k] === undefined || en[k] === undefined) missing.push(f + ': ' + k);
      } else if (en[k] === undefined && !SAME.has(k)) {
        missing.push(f + ': ' + k);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('statyczny HTML: każdy tekst widoczny w index.html ma tłumaczenie EN (albo klucz data-i18n)', () => {
  const html = read('renderer/index.html')
    .replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]*data-i18n="[^"]*"[^>]*>[^<]*/g, '<i18n/>'); // elementy z kluczami są tłumaczone osobno
  const texts = new Set();
  for (const m of html.matchAll(/>([^<>]+)</g)) texts.add(m[1].replace(/\s+/g, ' ').trim());
  for (const m of html.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) texts.add(m[1]);
  const missing = [...texts].filter((s) => s && /[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(s) && !SAME.has(s) && en[s] === undefined);
  assert.deepEqual(missing, []);
});

test('statyczny HTML strony telefonu: słownik EN pokrywa wszystkie teksty', () => {
  const html = read('phone/phone.html');
  const dict = html.match(/const EN = \{([\s\S]*?)\n    \};/)[1];
  const keys = new Set([...dict.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'")));
  const body = html.split('<body>')[1].split('<script>')[0].replace(/<svg[\s\S]*?<\/svg>/g, '');
  const texts = new Set();
  for (const m of body.matchAll(/>([^<>]+)</g)) texts.add(m[1].replace(/\s+/g, ' ').trim());
  for (const m of body.matchAll(/(?:placeholder|aria-label)="([^"]+)"/g)) texts.add(m[1]);
  const missing = [...texts].filter((s) => s && /[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(s) && s !== 'Album' && !keys.has(s));
  assert.deepEqual(missing, []);
});

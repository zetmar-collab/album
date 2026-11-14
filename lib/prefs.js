'use strict';

/** Preferencje użytkownika zapisywane w settings.json (obok tokenu Discogs). Każda wartość jest walidowana. */
const DEFAULTS = Object.freeze({
  checkUpdates: true, // sprawdzanie nowych wersji na GitHubie (tylko poza Sklepem Microsoft)
  lastUpdateCheck: 0, // znacznik czasu ostatniego sprawdzenia (ms)
  skipVersion: '', // wersja, o której użytkownik nie chce już słyszeć
  language: 'auto', // 'auto' (język systemu), 'pl' albo 'en'
  syncFolder: '', // folder synchronizacji (np. OneDrive)
  currency: 'EUR' // waluta wyceny kolekcji (Discogs nie obsługuje PLN)
});

const LANGS = new Set(['auto', 'pl', 'en']);
const { CURRENCIES } = require('./valuation');

function sanitizePrefs(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    checkUpdates: typeof o.checkUpdates === 'boolean' ? o.checkUpdates : DEFAULTS.checkUpdates,
    lastUpdateCheck: Number.isFinite(o.lastUpdateCheck) && o.lastUpdateCheck > 0 ? Math.floor(o.lastUpdateCheck) : 0,
    skipVersion: typeof o.skipVersion === 'string' && /^v?\d+(\.\d+){0,2}$/.test(o.skipVersion) ? o.skipVersion : '',
    language: LANGS.has(o.language) ? o.language : DEFAULTS.language,
    currency: CURRENCIES.includes(o.currency) ? o.currency : DEFAULTS.currency,
    syncFolder: typeof o.syncFolder === 'string' && o.syncFolder.length < 1024 && !o.syncFolder.includes('\0') ? o.syncFolder : ''
  };
}

module.exports = { DEFAULTS, sanitizePrefs };

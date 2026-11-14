'use strict';

// Minimalny silnik tłumaczeń (okno aplikacji i proces główny). Słowniki rejestrują pliki lang-pl.js / lang-en.js.
(function (root) {
  const dicts = {};
  let lang = 'pl';

  function register(code, entries) {
    dicts[code] = Object.assign(dicts[code] || {}, entries);
  }

  /** 'auto' wybiera język systemu (polski albo angielski), pozostałe wartości są przyjmowane wprost. */
  function resolveLang(pref, systemLocale) {
    if (pref === 'pl' || pref === 'en') return pref;
    return /^pl\b/i.test(String(systemLocale || '')) ? 'pl' : 'en';
  }

  function setLang(code) {
    lang = dicts[code] ? code : 'pl';
    return lang;
  }

  function getLang() {
    return lang;
  }

  /** t('klucz', { n: 3 }) - brak tłumaczenia wraca do polskiego, a w ostateczności do klucza. */
  function t(key, params) {
    let s = (dicts[lang] && dicts[lang][key]) ?? (dicts.pl && dicts.pl[key]) ?? key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
    return s;
  }

  /** Podmienia teksty elementów oznaczonych data-i18n / data-i18n-title / -placeholder / -aria. */
  function applyDom(doc) {
    doc.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    doc.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    doc.documentElement.lang = lang;
  }

  const api = { register, resolveLang, setLang, getLang, t, applyDom, _dicts: dicts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlbumI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);

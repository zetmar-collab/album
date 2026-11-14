'use strict';

// Silnik tłumaczeń (okno aplikacji, proces główny i moduły lib). Kluczem może być nazwa (np. 'update.download')
// albo polski tekst źródłowy - wtedy polski interfejs działa bez słownika, a angielski bierze tekst ze słownika EN.
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

  /** t('klucz', { n: 3 }[, 'en']) - brak tłumaczenia wraca do polskiego, a w ostateczności do samego klucza. */
  function t(key, params, forceLang) {
    const L = forceLang || lang;
    let s = dicts[L] && dicts[L][key];
    if (s === undefined) s = dicts.pl && dicts.pl[key];
    if (s === undefined) s = key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
    return s;
  }

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  /** Tłumaczy statyczny tekst strony (węzły tekstowe i atrybuty title/placeholder/aria-label) według słownika języka. */
  function translateStatic(doc) {
    const d = dicts[lang];
    if (!d || lang === 'pl') return;
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p && /^(SCRIPT|STYLE)$/i.test(p.tagName)) continue;
      nodes.push(n);
    }
    for (const n of nodes) {
      const key = norm(n.nodeValue);
      if (key && d[key] !== undefined) {
        const lead = /^\s*/.exec(n.nodeValue)[0];
        const trail = /\s*$/.exec(n.nodeValue)[0];
        n.nodeValue = lead + d[key] + trail;
      }
    }
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      doc.querySelectorAll('[' + attr + ']').forEach((el) => {
        const key = norm(el.getAttribute(attr));
        if (d[key] !== undefined) el.setAttribute(attr, d[key]);
      });
    }
    if (d[doc.title] !== undefined) doc.title = d[doc.title];
  }

  /** Podmienia teksty elementów oznaczonych data-i18n / data-i18n-title / -placeholder / -aria, potem tłumaczy resztę. */
  function applyDom(doc) {
    doc.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    doc.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    translateStatic(doc);
    doc.documentElement.lang = lang;
  }

  const api = { register, resolveLang, setLang, getLang, t, applyDom, translateStatic, _dicts: dicts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlbumI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

/** Waluty obsługiwane przez parametr curr_abbr API Discogs (PLN nie jest wśród nich). */
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'SEK', 'NZD', 'MXN', 'BRL', 'ZAR'];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Identyfikator wydania Discogs do wyceny (tylko pozycje pobrane z Discogs mają go w polu sourceId). */
const releaseIdOf = (item) => (item && item.source === 'Discogs' && /^\d+$/.test(String(item.sourceId || '')) ? String(item.sourceId) : null);

/**
 * Orientacyjna wartość kolekcji: suma najniższych cen ofert (Discogs) dla pozycji, które mają świeżą wycenę
 * w wybranej walucie. Pozycje z listy życzeń nie są liczone.
 */
function summarize(items, cache, currency) {
  let total = 0;
  let counted = 0;
  let owned = 0;
  for (const it of items) {
    if (!it || it.wishlist) continue;
    owned++;
    const id = releaseIdOf(it);
    const v = id && cache[id];
    if (v && v.currency === currency && Number.isFinite(v.value)) {
      total += v.value;
      counted++;
    }
  }
  return { total: Math.round(total * 100) / 100, counted, owned, currency };
}

/** Wydania, dla których trzeba (ponownie) zapytać o cenę: bez wyceny, w innej walucie albo starsze niż tydzień. */
function idsToRefresh(items, cache, currency, now = Date.now()) {
  const ids = new Set();
  for (const it of items) {
    if (!it || it.wishlist) continue;
    const id = releaseIdOf(it);
    if (!id) continue;
    const v = cache[id];
    if (!v || v.currency !== currency || now - v.at > WEEK_MS) ids.add(id);
  }
  return [...ids];
}

module.exports = { CURRENCIES, releaseIdOf, summarize, idsToRefresh };

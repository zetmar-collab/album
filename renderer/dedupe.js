'use strict';

// Wykrywanie duplikatów i normalizacja tekstu do wyszukiwania. Plik działa w przeglądarce (okno aplikacji)
// i w Node (testy) - bez zależności.
(function (root) {
  /** Małe litery, bez znaków diakrytycznych (ł, ą, ę…) - do porównań i wyszukiwania. */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ł/g, 'l')
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  // Ten sam tytuł bywa zapisany z dopiskiem ("Remastered", "(Deluxe Edition)") i interpunkcją - porównujemy rdzeń.
  function core(s) {
    return norm(s)
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

  /**
   * Szuka w kolekcji pozycji, którą kandydat powtarza: ten sam kod kreskowy (z tolerancją na zero wiodące)
   * albo ten sam wykonawca i tytuł w tym samym formacie. Zwraca { item, reason } albo null.
   */
  function findDuplicate(items, cand, ignoreId) {
    const bc = digits(cand.barcode);
    const artist = core(cand.artist);
    const title = core(cand.title);
    for (const i of items) {
      if (!i || (ignoreId && i.id === ignoreId)) continue;
      if (bc && digits(i.barcode) === bc) return { item: i, reason: 'barcode' };
      if (artist && title && i.format === cand.format && core(i.artist) === artist && core(i.title) === title) {
        return { item: i, reason: 'title' };
      }
    }
    return null;
  }

  const api = { norm, core, findDuplicate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlbumDedupe = api;
})(typeof window !== 'undefined' ? window : globalThis);

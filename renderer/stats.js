'use strict';

// Statystyki kolekcji - czysta funkcja bez zależności (okno aplikacji i testy w Node).
(function (root) {
  function top(map, n) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));
  }

  function computeStats(items) {
    const byFormat = { vinyl: 0, cd: 0, cassette: 0 };
    const decades = new Map();
    const artists = new Map();
    const labels = new Map();
    let withTracklist = 0;
    let withCover = 0;
    let wishlist = 0;
    for (const i of items) {
      if (!i) continue;
      if (i.wishlist) {
        wishlist++; // lista życzeń nie wchodzi do statystyk kolekcji
        continue;
      }
      if (byFormat[i.format] !== undefined) byFormat[i.format]++;
      const y = /^\d{4}/.exec(String(i.year || ''));
      if (y) {
        const d = Math.floor(Number(y[0]) / 10) * 10 + 's';
        decades.set(d, (decades.get(d) || 0) + 1);
      }
      const a = String(i.artist || '').trim();
      if (a) artists.set(a, (artists.get(a) || 0) + 1);
      const l = String(i.label || '').trim();
      if (l) labels.set(l, (labels.get(l) || 0) + 1);
      if (String(i.tracklist || '').trim()) withTracklist++;
      if (i.coverFile) withCover++;
    }
    return {
      total: items.filter((i) => i && !i.wishlist).length,
      wishlist,
      byFormat,
      byDecade: [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
      topArtists: top(artists, 5),
      topLabels: top(labels, 5),
      withTracklist,
      withCover
    };
  }

  const api = { computeStats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlbumStats = api;
})(typeof window !== 'undefined' ? window : globalThis);

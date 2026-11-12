'use strict';

const fs = require('fs');
const path = require('path');
const { IMAGE_EXT } = require('./storage');

/**
 * Pliki obrazów w folderze okładek, do których nie odwołuje się żadna pozycja kolekcji
 * (np. po awarii w trakcie edycji). `keep` to nazwy, których nie wolno ruszać (okładki bieżącej edycji).
 */
function findOrphanCovers(coversDir, items, keep = new Set()) {
  const used = new Set(items.map((i) => i && i.coverFile).filter(Boolean));
  let names = [];
  try {
    names = fs.readdirSync(coversDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (used.has(name) || keep.has(name)) continue;
    if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) continue; // nie dotykamy plików, które nie są obrazami
    let st;
    try {
      st = fs.statSync(path.join(coversDir, name));
    } catch {
      continue;
    }
    if (st.isFile()) out.push({ name, size: st.size });
  }
  return out;
}

module.exports = { findOrphanCovers };

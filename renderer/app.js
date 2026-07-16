'use strict';

const FORMAT_LABEL = { vinyl: 'WINYL', cd: 'CD', cassette: 'KASETA' };
const FORMAT_ICON = { vinyl: '💿', cd: '💿', cassette: '📼' };

let allItems = [];
let currentFormat = 'all';
let currentSort = 'artist';
let currentView = localStorage.getItem('albumView') || 'grid';
let searchText = '';
let editingItem = null; // pozycja edytowana w modalu (null = nowa)

const $ = (id) => document.getElementById(id);

// ---------- pomocnicze ----------

function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => closeModal(b.dataset.close))
);

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function guessFormat(formatText) {
  const f = (formatText || '').toLowerCase();
  if (f.includes('vinyl') || f.includes('lp') || f.includes('7"') || f.includes('12"')) return 'vinyl';
  if (f.includes('cassette')) return 'cassette';
  if (f.includes('cd')) return 'cd';
  return null;
}

// ---------- lista ----------

async function refresh() {
  allItems = await window.api.listItems();
  render();
}

function render() {
  const q = searchText.toLowerCase();
  let list = allItems.filter((i) => {
    if (currentFormat !== 'all' && i.format !== currentFormat) return false;
    if (!q) return true;
    return [i.artist, i.title, i.label, i.genre, i.year, i.catalogNumber, i.barcode]
      .join(' ').toLowerCase().includes(q);
  });

  list.sort((a, b) => {
    if (currentSort === 'addedAt') return (b.addedAt || '').localeCompare(a.addedAt || '');
    if (currentSort === 'year') return (a.year || '9999').localeCompare(b.year || '9999');
    const ka = (a[currentSort] || '').toLowerCase();
    const kb = (b[currentSort] || '').toLowerCase();
    return ka.localeCompare(kb, 'pl');
  });

  const counts = { vinyl: 0, cd: 0, cassette: 0 };
  allItems.forEach((i) => { if (counts[i.format] !== undefined) counts[i.format]++; });
  $('stats').textContent =
    allItems.length + ' pozycji · ' + counts.vinyl + ' winyli · ' + counts.cd + ' CD · ' + counts.cassette + ' kaset';

  const grid = $('grid');
  grid.innerHTML = '';
  grid.className = currentView === 'list' ? 'list' : 'grid';
  $('emptyState').classList.toggle('hidden', allItems.length > 0);

  for (const item of list) {
    const el = document.createElement('div');
    if (currentView === 'list') {
      el.className = 'row';
      el.innerHTML =
        '<div class="row-cover">' +
        (item.coverUrl ? '<img src="' + esc(item.coverUrl) + '" loading="lazy" />' : FORMAT_ICON[item.format] || '🎵') +
        '</div>' +
        '<div class="row-main"><div class="row-artist">' + esc(item.artist || '(nieznany)') + '</div>' +
        '<div class="row-title">' + esc(item.title || '(bez tytułu)') + '</div></div>' +
        '<span class="badge badge-' + item.format + '">' + FORMAT_LABEL[item.format] + '</span>' +
        '<span class="row-col">' + esc(item.year || '') + '</span>' +
        '<span class="row-col row-label">' + esc(item.label || '') + '</span>' +
        '<span class="row-col row-cond">' + esc(item.condition || '') + '</span>';
    } else {
      el.className = 'card';
      el.innerHTML =
        '<div class="card-cover">' +
        (item.coverUrl ? '<img src="' + esc(item.coverUrl) + '" loading="lazy" />' : FORMAT_ICON[item.format] || '🎵') +
        '</div>' +
        '<div class="card-info">' +
        '<div class="card-artist">' + esc(item.artist || '(nieznany)') + '</div>' +
        '<div class="card-title">' + esc(item.title || '(bez tytułu)') + '</div>' +
        '<div class="card-meta"><span class="badge badge-' + item.format + '">' + FORMAT_LABEL[item.format] + '</span>' +
        (item.year ? '<span class="card-year">' + esc(item.year) + '</span>' : '') +
        '</div></div>';
    }
    const del = document.createElement('button');
    del.className = 'del-btn';
    del.title = 'Usuń z kolekcji';
    del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Usunąć „' + (item.artist || '(nieznany)') + ' — ' + (item.title || '(bez tytułu)') + '" z kolekcji?')) return;
      await window.api.deleteItem(item.id);
      await refresh();
      toast('Usunięto z kolekcji.');
    });
    el.appendChild(del);
    el.addEventListener('click', () => openEdit(item));
    grid.appendChild(el);
  }
}

// ---------- modal edycji ----------

function setCoverPreview(url) {
  const p = $('coverPreview');
  p.innerHTML = url ? '<img src="' + esc(url) + '" />' : '<span>Brak okładki</span>';
}

function fillForm(data) {
  $('fFormat').value = data.format || 'vinyl';
  $('fArtist').value = data.artist || '';
  $('fTitle').value = data.title || '';
  $('fYear').value = data.year || '';
  $('fLabel').value = data.label || '';
  $('fCatalog').value = data.catalogNumber || '';
  $('fBarcode').value = data.barcode || '';
  $('fGenre').value = data.genre || '';
  $('fCountry').value = data.country || '';
  $('fCondition').value = data.condition || '';
  $('fTracks').value = data.tracklist || '';
  $('fNotes').value = data.notes || '';
}

function openEdit(item, prefill) {
  editingItem = item ? Object.assign({}, item) : {
    id: null, format: 'vinyl', coverFile: null, coverUrl: null, newCoverUrl: null
  };
  if (prefill) applyResult(prefill, true);
  $('editTitle').textContent = item ? 'Edytuj pozycję' : 'Dodaj pozycję';
  $('btnDelete').classList.toggle('hidden', !item);
  if (!prefill) fillForm(editingItem);
  setCoverPreview(editingItem.newCoverUrl || editingItem.coverUrl);
  $('onlineResults').classList.add('hidden');
  $('onlineErrors').classList.add('hidden');
  $('onlineInfo').classList.add('hidden');
  $('onlineQuery').value = '';
  openModal('editModal');
  $('fArtist').focus();
}

// Zastosowanie wyniku z MusicBrainz/Discogs do formularza.
let trackFetchSeq = 0;

function applyResult(r, intoNewItem) {
  const fmt = guessFormat(r.formatText) || (intoNewItem ? editingItem.format : $('fFormat').value);
  fillForm({
    format: fmt,
    artist: r.artist,
    title: r.title,
    year: r.year,
    label: r.label,
    catalogNumber: r.catalogNumber,
    barcode: r.barcode,
    genre: r.genre || '',
    country: r.country,
    condition: intoNewItem ? '' : $('fCondition').value,
    tracklist: intoNewItem ? '' : $('fTracks').value,
    notes: intoNewItem ? '' : $('fNotes').value
  });
  editingItem.source = r.source;
  editingItem.sourceId = r.sourceId;
  if (r.coverUrl) {
    editingItem.newCoverUrl = r.coverUrl;
    setCoverPreview(r.coverUrl);
  }
  if (r.sourceId) {
    const seq = ++trackFetchSeq;
    const ta = $('fTracks');
    const prevPlaceholder = ta.placeholder;
    ta.placeholder = '⏳ Pobieram listę utworów…';
    window.api.fetchTracks({ source: r.source, sourceId: r.sourceId }).then((txt) => {
      if (seq !== trackFetchSeq) return;
      ta.placeholder = prevPlaceholder;
      if (txt) ta.value = txt;
    });
  }
}

function renderOnlineResults(results, errors, counts) {
  const box = $('onlineResults');
  const errBox = $('onlineErrors');
  const info = $('onlineInfo');
  if (counts) {
    info.textContent = 'Znaleziono — Discogs: ' + counts.discogs + ' · MusicBrainz: ' + counts.musicbrainz;
    info.classList.remove('hidden');
  } else {
    info.classList.add('hidden');
  }
  const errText = (errors || []).join(' · ');
  errBox.textContent = errText;
  if (/token/i.test(errText)) {
    const b = document.createElement('button');
    b.className = 'btn btn-small';
    b.style.marginLeft = '8px';
    b.textContent = 'Otwórz Ustawienia';
    b.addEventListener('click', openSettings);
    errBox.appendChild(b);
  }
  errBox.classList.toggle('hidden', !(errors && errors.length));

  if (!results.length) {
    box.innerHTML = '<div class="online-result"><div class="or-main"><div class="or-sub">Brak wyników.' +
      (/token/i.test(errText) ? ' Polskie wydania najłatwiej znaleźć przez Discogs — dodaj token w Ustawieniach.' : '') +
      '</div></div></div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = '';
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'online-result';
    row.innerHTML =
      (r.coverUrl
        ? '<img src="' + esc(r.coverUrl) + '" onerror="this.outerHTML=\'<div class=noimg>♪</div>\'" />'
        : '<div class="noimg">♪</div>') +
      '<div class="or-main"><div class="or-title">' + esc(r.artist ? r.artist + ' — ' + r.title : r.title) + '</div>' +
      '<div class="or-sub">' + esc([r.year, r.formatText, r.label, r.country].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="or-source">' + esc(r.source) + '</span>';
    row.addEventListener('click', () => {
      applyResult(r, false);
      box.classList.add('hidden');
    });
    box.appendChild(row);
  }
  box.classList.remove('hidden');
}

async function onlineSearch() {
  const q = $('onlineQuery').value.trim();
  if (!q) return;
  const btn = $('btnOnlineSearch');
  btn.disabled = true;
  btn.textContent = 'Szukam…';
  try {
    const isBarcode = /^[0-9\s-]{7,16}$/.test(q);
    const res = await window.api.searchRemote(isBarcode ? { barcode: q.replace(/\D/g, '') } : { query: q });
    renderOnlineResults(res.results, res.errors, res.counts);
  } catch (e) {
    toast('Błąd wyszukiwania: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Szukaj';
  }
}

async function saveEdit() {
  const item = Object.assign({}, editingItem, {
    format: $('fFormat').value,
    artist: $('fArtist').value,
    title: $('fTitle').value,
    year: $('fYear').value,
    label: $('fLabel').value,
    catalogNumber: $('fCatalog').value,
    barcode: $('fBarcode').value,
    genre: $('fGenre').value,
    country: $('fCountry').value,
    condition: $('fCondition').value,
    tracklist: $('fTracks').value,
    notes: $('fNotes').value
  });
  if (!item.artist && !item.title) {
    toast('Podaj przynajmniej wykonawcę lub tytuł.');
    return;
  }
  if (!item.id && item.barcode && allItems.some((i) => i.barcode && i.barcode === item.barcode)) {
    if (!confirm('Pozycja z tym kodem kreskowym już jest w kolekcji. Dodać mimo to?')) return;
  }
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = 'Zapisuję…';
  try {
    await window.api.saveItem(item);
    closeModal('editModal');
    await refresh();
    toast(item.id ? 'Zapisano zmiany.' : 'Dodano do kolekcji: ' + (item.artist || item.title));
  } catch (e) {
    toast('Błąd zapisu: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zapisz';
  }
}

// ---------- telefon ----------

function phoneLog(msg) {
  const log = $('phoneLog');
  const d = document.createElement('div');
  d.textContent = new Date().toLocaleTimeString('pl-PL') + ' — ' + msg;
  log.prepend(d);
}

async function openPhone() {
  const info = await window.api.phoneInfo();
  $('phoneQr').src = info.qr;
  $('phoneUrl').textContent = info.url;
  $('phoneAlt').textContent = (info.altUrls && info.altUrls.length)
    ? 'Adresy zapasowe (gdy główny nie działa): ' + info.altUrls.join('  ·  ')
    : '';
  if (!info.serverOk) phoneLog('Uwaga: serwer nie wystartował (port zajęty?). Uruchom aplikację ponownie.');
  openModal('phoneModal');
}

window.api.onPhoneEvent((data) => {
  if (data.type === 'barcode') {
    phoneLog('Odebrano kod ' + data.barcode + ' — znaleziono wyników: ' + data.results.length);
    closeModal('phoneModal');
    if (data.results.length) {
      openEdit(null, Object.assign({}, data.results[0], { barcode: data.results[0].barcode || data.barcode }));
      renderOnlineResults(data.results, data.errors, data.counts);
      toast('Zeskanowano kod ' + data.barcode + '. Wybierz właściwe wydanie z listy lub zapisz.');
    } else {
      openEdit(null);
      $('fBarcode').value = data.barcode;
      const err = (data.errors || []).join(' · ');
      toast('Kod ' + data.barcode + ' — brak wyników w bazach.' + (err ? ' (' + err + ')' : ''), 6000);
    }
  } else if (data.type === 'cover') {
    const modalOpen = !$('editModal').classList.contains('hidden');
    if (!modalOpen) openEdit(null);
    editingItem.coverFile = data.coverFile;
    editingItem.newCoverUrl = null;
    setCoverPreview(data.coverUrl);
    toast('Otrzymano zdjęcie okładki z telefonu.');
  }
});

window.api.onDataChanged(() => {
  refresh();
  toast('Kolekcja została przywrócona z kopii zapasowej.');
});

// ---------- ustawienia / kopia zapasowa ----------

async function refreshDiscogsStatus() {
  const el = $('discogsStatus');
  el.className = 'discogs-status';
  el.textContent = 'Sprawdzam połączenie z Discogs…';
  const st = await window.api.settingsStatus();
  if (!st.hasToken) {
    el.className = 'discogs-status bad';
    el.textContent = '✖ Brak tokenu Discogs — wyszukiwanie działa tylko w MusicBrainz.';
  } else if (st.valid) {
    el.className = 'discogs-status ok';
    el.textContent = '✔ Discogs połączony — zalogowano jako „' + st.username + '".';
  } else if (st.valid === false) {
    el.className = 'discogs-status bad';
    el.textContent = '✖ Zapisany token jest nieprawidłowy. ' + (st.message || '');
  } else {
    el.textContent = '… Nie udało się sprawdzić tokenu: ' + (st.message || 'brak internetu?');
  }
}

async function openSettings() {
  const s = await window.api.getSettings();
  $('discogsToken').value = s.discogsToken || '';
  openModal('settingsModal');
  refreshDiscogsStatus();
}

// ---------- zdarzenia ----------

$('btnAdd').addEventListener('click', () => openEdit(null));
$('btnPhone').addEventListener('click', openPhone);
$('btnSettings').addEventListener('click', openSettings);
$('btnSave').addEventListener('click', saveEdit);
$('btnOnlineSearch').addEventListener('click', onlineSearch);
$('onlineQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') onlineSearch(); });

$('btnDelete').addEventListener('click', async () => {
  if (!editingItem || !editingItem.id) return;
  if (!confirm('Usunąć „' + (editingItem.artist || '') + ' — ' + (editingItem.title || '') + '" z kolekcji?')) return;
  await window.api.deleteItem(editingItem.id);
  closeModal('editModal');
  await refresh();
  toast('Usunięto z kolekcji.');
});

$('btnPickCover').addEventListener('click', async () => {
  const r = await window.api.pickCover();
  if (r) {
    editingItem.coverFile = r.coverFile;
    editingItem.newCoverUrl = null;
    setCoverPreview(r.coverUrl);
  }
});

$('btnClearCover').addEventListener('click', () => {
  editingItem.coverFile = null;
  editingItem.newCoverUrl = null;
  setCoverPreview(null);
});

$('btnDiscogsPage').addEventListener('click', () => window.api.openDiscogsTokenPage());

$('btnSaveSettings').addEventListener('click', async () => {
  const btn = $('btnSaveSettings');
  btn.disabled = true;
  btn.textContent = 'Sprawdzam token…';
  try {
    const r = await window.api.saveSettings({ discogsToken: $('discogsToken').value });
    if (r.ok) {
      if (r.username) toast('Token poprawny — połączono z Discogs jako „' + r.username + '". Zapisano.', 5000);
      else toast('Zapisano ustawienia (bez tokenu Discogs).');
      refreshDiscogsStatus();
    } else {
      toast('⚠ ' + r.message, 7000);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zapisz ustawienia';
  }
});

$('btnExport').addEventListener('click', async () => {
  const r = await window.api.exportBackup();
  if (r.ok) toast('Utworzono kopię zapasową (' + r.count + ' pozycji): ' + r.path, 6000);
  else if (!r.canceled) toast('Błąd kopii zapasowej: ' + r.message);
});

$('btnImport').addEventListener('click', async () => {
  const r = await window.api.importBackup();
  if (r.ok) {
    closeModal('settingsModal');
  } else if (!r.canceled) {
    toast('Błąd przywracania: ' + r.message, 6000);
  }
});

$('btnExcel').addEventListener('click', async () => {
  const r = await window.api.exportExcel();
  if (r.ok) toast('Wyeksportowano ' + r.count + ' pozycji do: ' + r.path, 6000);
  else if (!r.canceled) toast('Błąd eksportu: ' + r.message, 6000);
});

document.querySelectorAll('#viewToggle .chip').forEach((btn) => {
  if (btn.dataset.view === currentView) {
    document.querySelectorAll('#viewToggle .chip').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
  }
  btn.addEventListener('click', () => {
    document.querySelectorAll('#viewToggle .chip').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    localStorage.setItem('albumView', currentView);
    render();
  });
});

$('searchInput').addEventListener('input', (e) => { searchText = e.target.value; render(); });
$('sortSelect').addEventListener('change', (e) => { currentSort = e.target.value; render(); });

document.querySelectorAll('#formatFilters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#formatFilters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentFormat = chip.dataset.format;
    render();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ['editModal', 'phoneModal', 'settingsModal'].forEach(closeModal);
  }
});

refresh();

'use strict';

const FORMAT_LABEL = { vinyl: 'WINYL', cd: 'CD', cassette: 'KASETA' };

const { t } = window.AlbumI18n;
let appInfo = { version: '', inStore: false, lang: 'pl' };

/** Język interfejsu ustala proces główny (ustawienie użytkownika albo język systemu). */
async function initI18n() {
  appInfo = await window.api.appInfo();
  window.AlbumI18n.setLang(appInfo.lang);
  window.AlbumI18n.applyDom(document);
}

/** Ikona z zestawu SVG (sprite w index.html) - spójna na każdym systemie, w przeciwieństwie do emoji. */
const icon = (name, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const FORMAT_ICON = { vinyl: icon('disc'), cd: icon('disc'), cassette: icon('cassette') };

let allItems = [];
let currentFormat = 'all';
let currentSort = 'artist';
let currentView = localStorage.getItem('albumView') || 'grid';
let searchText = '';
let editingItem = null; // pozycja edytowana w modalu (null = nowa)
let editSnapshot = ''; // stan formularza przy otwarciu - do wykrywania niezapisanych zmian
const editCovers = new Set(); // okładki wgrane w tej sesji edycji (do posprzątania po anulowaniu)
let searchTimer = null;
let searchSeq = 0;
const collator = new Intl.Collator('pl', { sensitivity: 'accent' });

const $ = (id) => document.getElementById(id);

// ---------- pomocnicze ----------

function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

let lastFocus = null;

function openModal(id) {
  lastFocus = document.activeElement;
  $(id).classList.remove('hidden');
  const box = $(id).querySelector('.modal');
  if (box) {
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  }
}

function closeModal(id) {
  $(id).classList.add('hidden');
  if (lastFocus && lastFocus.isConnected) {
    try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* element mógł zniknąć */ }
  }
}

// Tab krąży wewnątrz otwartego okna zamiast uciekać do tła.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const open = [...document.querySelectorAll('.modal-backdrop:not(.hidden)')].pop();
  if (!open) return;
  const items = [...open.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === open.querySelector('.modal'))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.close === 'editModal') requestCloseEdit();
    else closeModal(b.dataset.close);
  })
);

// Wyszukiwanie bez rozróżniania wielkości liter i polskich znaków (ł, ą, ę…) - patrz dedupe.js.
const { norm, findDuplicate } = window.AlbumDedupe;

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
  allItems = (await window.api.listItems()).map((i) => {
    i._hay = norm([i.artist, i.title, i.label, i.genre, i.year, i.catalogNumber, i.barcode, i.notes].join(' '));
    return i;
  });
  render();
}

function render() {
  const words = norm(searchText).split(/\s+/).filter(Boolean);
  let list = allItems.filter((i) => {
    if (currentFormat !== 'all' && i.format !== currentFormat) return false;
    return words.every((w) => i._hay.includes(w));
  });

  list.sort((a, b) => {
    if (currentSort === 'addedAt') return (b.addedAt || '').localeCompare(a.addedAt || '');
    if (currentSort === 'year') return (a.year || '9999').localeCompare(b.year || '9999');
    return collator.compare(a[currentSort] || '', b[currentSort] || '');
  });

  const counts = { vinyl: 0, cd: 0, cassette: 0 };
  allItems.forEach((i) => { if (counts[i.format] !== undefined) counts[i.format]++; });
  $('stats').textContent =
    allItems.length + ' pozycji · ' + counts.vinyl + ' winyli · ' + counts.cd + ' CD · ' + counts.cassette + ' kaset';

  document.querySelectorAll('#formatFilters .chip').forEach((chip) => {
    const f = chip.dataset.format;
    const n = chip.querySelector('.chip-count');
    if (n) n.textContent = f === 'all' ? allItems.length : counts[f];
  });

  const grid = $('grid');
  grid.innerHTML = '';
  grid.className = currentView === 'list' ? 'list' : 'grid';
  $('emptyState').classList.toggle('hidden', allItems.length > 0);
  const frag = document.createDocumentFragment();

  if (currentView === 'list' && list.length) {
    const head = document.createElement('div');
    head.className = 'list-head';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML =
      '<span></span><span>Wykonawca / tytuł</span><span>Format</span><span class="num">Rok</span>' +
      '<span class="c-label">Wytwórnia</span><span class="c-cond">Stan</span><span></span>';
    frag.appendChild(head);
  }
  if (!list.length && allItems.length) {
    const none = document.createElement('div');
    none.className = 'empty-inline';
    none.textContent = 'Brak pozycji pasujących do wyszukiwania lub filtra.';
    frag.appendChild(none);
  }

  for (const item of list) {
    const el = document.createElement('div');
    if (currentView === 'list') {
      el.className = 'row';
      el.innerHTML =
        '<div class="row-cover">' +
        (item.coverUrl ? '<img src="' + esc(item.coverUrl) + '" loading="lazy" decoding="async" alt="" />' : FORMAT_ICON[item.format] || icon('music')) +
        '</div>' +
        '<div class="row-main"><div class="row-artist">' + esc(item.artist || '(nieznany)') + '</div>' +
        '<div class="row-title">' + esc(item.title || '(bez tytułu)') + '</div></div>' +
        '<span class="badge badge-' + item.format + '">' + FORMAT_LABEL[item.format] + '</span>' +
        '<span class="row-col num">' + esc(item.year || '') + '</span>' +
        '<span class="row-col c-label" title="' + esc(item.label || '') + '">' + esc(item.label || '') + '</span>' +
        '<span class="row-col c-cond">' + esc(item.condition || '') + '</span>';
    } else {
      el.className = 'card';
      el.innerHTML =
        '<div class="card-cover">' +
        (item.coverUrl ? '<img src="' + esc(item.coverUrl) + '" loading="lazy" decoding="async" alt="" />' : FORMAT_ICON[item.format] || icon('music')) +
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
    del.setAttribute('aria-label', 'Usuń z kolekcji');
    del.innerHTML = icon('trash', 'ic-sm');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Usunąć „' + (item.artist || '(nieznany)') + ' — ' + (item.title || '(bez tytułu)') + '" z kolekcji?')) return;
      await window.api.deleteItem(item.id);
      await refresh();
      toast('Usunięto z kolekcji.');
    });
    el.appendChild(del);
    el.tabIndex = 0;
    el.title = (item.artist || '(nieznany)') + ' — ' + (item.title || '(bez tytułu)');
    el.setAttribute('role', 'button');
    el.addEventListener('click', () => openEdit(item));
    el.addEventListener('keydown', (e) => {
      if (e.target === el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openEdit(item);
      }
    });
    frag.appendChild(el);
  }
  grid.appendChild(frag);
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

function formState() {
  return JSON.stringify([
    $('fFormat').value, $('fArtist').value, $('fTitle').value, $('fYear').value, $('fLabel').value,
    $('fCatalog').value, $('fBarcode').value, $('fGenre').value, $('fCountry').value, $('fCondition').value,
    $('fTracks').value, $('fNotes').value,
    (editingItem && editingItem.coverFile) || '', (editingItem && editingItem.newCoverUrl) || ''
  ]);
}

function isDirty() {
  return !$('editModal').classList.contains('hidden') && formState() !== editSnapshot;
}

/** Zamyka okno edycji i sprząta okładki wgrane w tej sesji, których nie zapisano przy pozycji. */
function finishEdit(savedCoverFile) {
  const names = [...editCovers].filter((n) => n !== savedCoverFile);
  editCovers.clear();
  trackFetchSeq++; // unieważnia trwające pobieranie listy utworów
  if (names.length) window.api.discardCovers(names);
  closeModal('editModal');
}

function requestCloseEdit() {
  if ($('editModal').classList.contains('hidden')) return;
  if (isDirty() && !confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')) return;
  finishEdit(null);
}

function openEdit(item, prefill) {
  // Nowe okno edycji nie może odziedziczyć okładek/pobierania z poprzedniego.
  if (!$('editModal').classList.contains('hidden')) finishEdit(null);
  trackFetchSeq++;
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
  // Wstępnie wypełniona (zeskanowana) pozycja liczy się jako niezapisana.
  editSnapshot = prefill ? '' : formState();
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
    const startValue = ta.value;
    ta.placeholder = 'Pobieram listę utworów…';
    window.api
      .fetchTracks({ source: r.source, sourceId: r.sourceId })
      .then((res) => {
        if (seq !== trackFetchSeq) return; // okno zamknięto lub wybrano inny wynik
        ta.placeholder = prevPlaceholder;
        if (res && res.error) toast('Nie udało się pobrać listy utworów: ' + res.error, 6000);
        else if (res && res.text) {
          if (ta.value !== startValue && ta.value.trim()) toast('Lista utworów pobrana, ale pole było edytowane — nie nadpisano.', 5000);
          else ta.value = res.text;
        }
      })
      .catch((e) => {
        if (seq === trackFetchSeq) {
          ta.placeholder = prevPlaceholder;
          toast('Nie udało się pobrać listy utworów: ' + e.message, 6000);
        }
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
    b.classList.add('btn-inline');
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
      (r.coverUrl ? '<img src="' + esc(r.coverUrl) + '" alt="" />' : '<div class="noimg">' + icon('music', 'ic-sm') + '</div>') +
      '<div class="or-main"><div class="or-title">' + esc(r.artist ? r.artist + ' — ' + r.title : r.title) + '</div>' +
      '<div class="or-sub">' + esc([r.year, r.formatText, r.label, r.country].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="or-source">' + esc(r.source) + '</span>';
    const thumb = row.querySelector('img');
    if (thumb) {
      thumb.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'noimg';
        ph.innerHTML = icon('music', 'ic-sm');
        thumb.replaceWith(ph);
      });
    }
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
  const seq = ++searchSeq;
  btn.disabled = true;
  btn.querySelector('.lbl').textContent = 'Szukam…';
  try {
    const isBarcode = /^[0-9\s-]{7,16}$/.test(q);
    const res = await window.api.searchRemote(isBarcode ? { barcode: q.replace(/\D/g, '') } : { query: q });
    if (seq === searchSeq && !$('editModal').classList.contains('hidden')) renderOnlineResults(res.results, res.errors, res.counts);
  } catch (e) {
    toast('Błąd wyszukiwania: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.lbl').textContent = 'Szukaj';
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
  if (!item.id) {
    const dup = findDuplicate(allItems, item);
    if (dup) {
      const what = dup.reason === 'barcode' ? 'Pozycja z tym kodem kreskowym' : 'Podobna pozycja (ten sam wykonawca, tytuł i format)';
      if (!confirm(what + ' już jest w kolekcji: „' + (dup.item.artist || '?') + ' — ' + (dup.item.title || '?') + '”. Dodać mimo to?')) return;
    }
  }
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = 'Zapisuję…';
  try {
    const saved = await window.api.saveItem(item);
    finishEdit(saved.coverFile);
    await refresh();
    if (saved.coverFailed) toast('Zapisano, ale nie udało się pobrać okładki (sprawdź połączenie lub wybierz plik ręcznie).', 7000);
    else toast(item.id ? 'Zapisano zmiany.' : 'Dodano do kolekcji: ' + (item.artist || item.title));
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
  $('phoneIdle').textContent = info.idleMinutes || 15;
  if (!info.serverOk) phoneLog('Uwaga: serwer nie wystartował (port zajęty?). Uruchom aplikację ponownie.');
  openModal('phoneModal');
}

// ---------- tryb serii (telefon) ----------

let batchQueue = Promise.resolve();

/** Zapisuje pierwszy wynik wyszukiwania bez otwierania formularza. Duplikaty pomija. */
async function handleBatchScan(data) {
  const r = data.results[0];
  if (!r) {
    phoneLog('✖ Kod ' + data.barcode + ': brak wyników — dodaj tę pozycję ręcznie.');
    return;
  }
  const cand = {
    format: guessFormat(r.formatText) || 'vinyl',
    artist: r.artist,
    title: r.title,
    year: r.year,
    label: r.label,
    catalogNumber: r.catalogNumber,
    barcode: r.barcode || data.barcode,
    genre: r.genre || '',
    country: r.country,
    source: r.source,
    sourceId: r.sourceId
  };
  const name = (cand.artist || '?') + ' — ' + (cand.title || '?');
  const dup = findDuplicate(allItems, cand);
  if (dup) {
    phoneLog('⏭ Pominięto duplikat: ' + name);
    return;
  }
  try {
    let tracklist = '';
    if (r.sourceId) {
      const t = await window.api.fetchTracks({ source: r.source, sourceId: r.sourceId });
      if (t && t.text) tracklist = t.text;
    }
    await window.api.saveItem(Object.assign({ id: null, tracklist, notes: '', condition: '', coverFile: null, newCoverUrl: r.coverUrl || null }, cand));
    await refresh();
    phoneLog('✔ Dodano: ' + name);
  } catch (e) {
    phoneLog('✖ Błąd zapisu (' + name + '): ' + e.message);
  }
}

window.api.onPhoneEvent((data) => {
  if (data.type === 'barcode') {
    phoneLog('Odebrano kod ' + data.barcode + ' — znaleziono wyników: ' + data.results.length);
    if ($('batchMode').checked && $('editModal').classList.contains('hidden')) {
      batchQueue = batchQueue.then(() => handleBatchScan(data));
      return;
    }
    closeModal('phoneModal');
    if (!$('editModal').classList.contains('hidden')) {
      // Użytkownik właśnie edytuje pozycję - nie nadpisujemy formularza. Wyniki pokazujemy na liście do wyboru.
      $('onlineQuery').value = data.barcode;
      if (!$('fBarcode').value) $('fBarcode').value = data.barcode;
      renderOnlineResults(data.results, data.errors, data.counts);
      toast('Zeskanowano kod ' + data.barcode + '. Formularz zostawiono bez zmian — wybierz wynik z listy, jeśli pasuje.', 6000);
    } else if (data.results.length) {
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
    editCovers.add(data.coverFile);
    setCoverPreview(data.coverUrl);
    toast('Otrzymano zdjęcie okładki z telefonu.');
  } else if (data.type === 'stopped') {
    phoneLog('Połączenie z telefonem zakończone (' + data.reason + ').');
  }
});

window.api.onDataChanged((d) => {
  refresh();
  if (!d || d.reason !== 'import') toast(t('import.restored'));
});

// ---------- import z Discogs ----------

window.api.onImportProgress((p) => toast(t(p.stage === 'covers' ? 'import.covers' : 'import.progress', { done: p.done, total: p.total || p.done }), 60000));

async function runImportUi(call) {
  closeModal('settingsModal');
  const r = await call();
  if (r.canceled) return;
  if (!r.ok) toast(t('import.error', { message: r.message }), 8000);
  else if (!r.added) toast(t('import.nothing', { dup: r.duplicates, skipped: r.skipped }), 6000);
  else toast(t('import.done', { added: r.added, dup: r.duplicates, skipped: r.skipped }), 7000);
}
$('btnImportApi').addEventListener('click', () => runImportUi(() => window.api.importDiscogsApi()));
$('btnImportCsv').addEventListener('click', () => runImportUi(() => window.api.importDiscogsCsv()));

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
  $('updateInfo').textContent = appInfo.inStore ? t('update.store') : t('update.current', { current: appInfo.version });
  $('prefUpdatesRow').classList.toggle('hidden', appInfo.inStore);
  $('btnUpdateCheck').classList.toggle('hidden', appInfo.inStore);
  $('prefUpdates').checked = !s.prefs || s.prefs.checkUpdates !== false;
  $('updateResult').textContent = '';
  openModal('settingsModal');
  refreshDiscogsStatus();
  refreshOrphanInfo();
}

// ---------- zdarzenia ----------

// ---------- aktualizacje ----------

let pendingUpdate = null;

function showUpdate(d) {
  pendingUpdate = d;
  $('updateText').textContent = t('update.available', { latest: d.latest, current: d.current });
  $('updateBanner').classList.remove('hidden');
}

window.api.onUpdateAvailable(showUpdate);
$('btnUpdateGet').addEventListener('click', () => pendingUpdate && window.api.updateOpen(pendingUpdate.url));
$('btnUpdateSkip').addEventListener('click', () => {
  if (pendingUpdate) window.api.updateSkip(pendingUpdate.latest);
  $('updateBanner').classList.add('hidden');
});
$('btnUpdateClose').addEventListener('click', () => $('updateBanner').classList.add('hidden'));

$('prefUpdates').addEventListener('change', (e) => window.api.prefsSet({ checkUpdates: e.target.checked }));
$('btnUpdateCheck').addEventListener('click', async () => {
  const out = $('updateResult');
  out.textContent = t('update.checking');
  const r = await window.api.updateCheck();
  if (!r.ok) out.textContent = t('update.error', { message: r.message });
  else if (r.updateAvailable) {
    out.textContent = t('update.newer', { latest: r.latest });
    showUpdate({ latest: r.latest, current: r.current, url: r.url });
  } else out.textContent = t('update.upToDate', { current: r.current });
});

$('btnAdd').addEventListener('click', () => openEdit(null));
$('btnEmptyAdd').addEventListener('click', () => openEdit(null));
$('btnCopyUrl').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('phoneUrl').textContent);
    toast('Skopiowano adres do schowka.');
  } catch (e) {
    toast('Nie udało się skopiować — zaznacz adres i skopiuj ręcznie (Ctrl+C).');
  }
});
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
    editCovers.add(r.coverFile);
    setCoverPreview(r.coverUrl);
  }
});

$('btnClearCover').addEventListener('click', () => {
  editingItem.coverFile = null;
  editingItem.newCoverUrl = null;
  setCoverPreview(null);
});

$('btnStats').addEventListener('click', () => {
  const s = window.AlbumStats.computeStats(allItems);
  const body = $('statsBody');
  body.textContent = '';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const grid = el('div', 'stat-grid');
  [['Razem', s.total], ['Winyle', s.byFormat.vinyl], ['CD', s.byFormat.cd], ['Kasety', s.byFormat.cassette], ['Z okładką', s.withCover], ['Z listą utworów', s.withTracklist]].forEach(([label, n]) => {
    const c = el('div', 'stat-card');
    c.append(el('div', 'stat-num', String(n)), el('div', 'stat-label', label));
    grid.append(c);
  });
  body.append(grid);
  const section = (title, rows) => {
    if (!rows.length) return;
    const sec = el('div', 'stat-section');
    sec.append(el('h3', null, title));
    const max = Math.max(...rows.map((r) => r.count));
    rows.forEach((r) => {
      const row = el('div', 'stat-row');
      const name = el('span', 'stat-name', r.name);
      name.title = r.name;
      const track = el('div', 'stat-track');
      const bar = el('div', 'stat-bar');
      bar.style.width = Math.max(4, Math.round((r.count / max) * 100)) + '%';
      track.append(bar);
      row.append(name, track, el('b', 'stat-count', String(r.count)));
      sec.append(row);
    });
    body.append(sec);
  };
  section('Dekady', s.byDecade);
  section('Najczęstsi wykonawcy', s.topArtists);
  section('Najczęstsze wytwórnie', s.topLabels);
  if (!s.total) body.append(el('p', 'hint', 'Kolekcja jest pusta — nie ma jeszcze czego policzyć.'));
  openModal('statsModal');
});

$('btnPhoneStop').addEventListener('click', async () => {
  await window.api.phoneStop();
  closeModal('phoneModal');
  toast('Połączenie z telefonem zakończone.');
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
  if (r.ok) toast('Utworzono kopię zapasową (' + r.count + ' pozycji' + (r.tokenIncluded ? ', z tokenem Discogs' : '') + '): ' + r.path, 6000);
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

$('btnOrphans').addEventListener('click', async () => {
  const r = await window.api.coverCleanup();
  if (r.canceled) return;
  if (!r.removed && !r.failed) toast('Nie ma nieużywanych okładek.');
  else toast('Przeniesiono do Kosza: ' + r.removed + ' okładek' + (r.failed ? ' (nie udało się: ' + r.failed + ')' : '') + '.', 6000);
  refreshOrphanInfo();
});

async function refreshOrphanInfo() {
  const o = await window.api.coverOrphans();
  $('orphanInfo').textContent = o.count
    ? 'Nieużywane okładki: ' + o.count + ' (' + (o.bytes / 1048576).toFixed(1) + ' MB).'
    : 'Brak nieużywanych okładek.';
}

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

$('searchInput').addEventListener('input', (e) => {
  searchText = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});
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
    // Zamykamy tylko wierzchnie okno; edycja z niezapisanymi zmianami pyta o potwierdzenie.
    if (!$('statsModal').classList.contains('hidden')) closeModal('statsModal');
    else if (!$('settingsModal').classList.contains('hidden')) closeModal('settingsModal');
    else if (!$('phoneModal').classList.contains('hidden')) closeModal('phoneModal');
    else requestCloseEdit();
  }
});

initI18n().then(refresh);

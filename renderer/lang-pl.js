'use strict';

(function (root) {
  const entries = {
    // --- import ---
    'common.cancel': 'Anuluj',
    'import.section': 'Import kolekcji',
    'import.hint': 'Przenieś swoją kolekcję z Discogs: przez konto (wymaga tokenu) albo z pliku CSV (Discogs → Collection → Export). Pozycje, które już masz, są pomijane.',
    'import.api': 'Importuj z konta Discogs…',
    'import.csv': 'Importuj z pliku CSV…',
    'import.progress': 'Pobieram kolekcję z Discogs… {done}/{total}',
    'import.covers': 'Pobieram okładki… {done}/{total}',
    'import.noToken': 'Najpierw dodaj token Discogs w Ustawieniach.',
    'import.csvBad': 'To nie wygląda na eksport kolekcji z Discogs (brak kolumn Artist i Title).',
    'import.csvOpen': 'Wybierz plik CSV z Discogs',
    'import.csvTooBig': 'Plik jest zbyt duży (limit 20 MB).',
    'import.title': 'Import z Discogs',
    'import.confirm': 'Dodać do kolekcji {n} nowych pozycji?',
    'import.detail': 'Już w kolekcji (pominięte): {dup}. Nieobsługiwane formaty, np. DVD (pominięte): {skipped}. Lista utworów i kody kreskowe nie są importowane — uzupełnisz je w edycji pozycji.',
    'import.add': 'Dodaj {n}',
    'import.done': 'Zaimportowano {added} pozycji (pominięto: {dup} duplikatów, {skipped} nieobsługiwanych).',
    'import.nothing': 'Nie ma nic do dodania (duplikaty: {dup}, nieobsługiwane: {skipped}).',
    'import.error': 'Błąd importu: {message}',
    'import.restored': 'Kolekcja została przywrócona z kopii zapasowej.',
    // --- aktualizacje ---
    'update.available': 'Dostępna nowa wersja Album: {latest} (masz {current}).',
    'update.download': 'Pobierz',
    'update.skip': 'Pomiń tę wersję',
    'update.section': 'Aktualizacje',
    'update.current': 'Zainstalowana wersja: {current}',
    'update.store': 'Ta wersja pochodzi ze Sklepu Microsoft i aktualizuje się automatycznie.',
    'update.auto': 'Sprawdzaj nowe wersje w tle (raz na dobę, zapytanie do GitHuba)',
    'update.checkNow': 'Sprawdź teraz',
    'update.checking': 'Sprawdzam…',
    'update.upToDate': 'Masz najnowszą wersję ({current}).',
    'update.newer': 'Dostępna wersja {latest}.',
    'update.error': 'Nie udało się sprawdzić aktualizacji: {message}'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = entries;
  else root.AlbumI18n.register('pl', entries);
})(typeof window !== 'undefined' ? window : globalThis);

# Album

Aplikacja Windows do kolekcjonowania **winyli, płyt CD i kaset magnetofonowych**.

## Gotowe pliki (folder `dist`)

- **Album-1.0.0-portable.exe** — wersja przenośna, uruchamiasz bezpośrednio, bez instalacji
- **Album-1.0.0-instalator.exe** — klasyczny instalator (skrót w menu Start)

Dane kolekcji są zapisywane w profilu użytkownika (`%APPDATA%\Album\album-data`), więc nie znikają po aktualizacji aplikacji.

## Funkcje

- Dodawanie pozycji ręcznie lub przez **skanowanie telefonem** (kod QR w aplikacji → telefon otwiera stronę skanera w przeglądarce, bez instalowania aplikacji na telefonie)
- Telefon robi zdjęcie **kodu kreskowego** → komputer odczytuje kod i pobiera dane wydania z **MusicBrainz** i **Discogs** (wykonawca, tytuł, rok, wytwórnia, nr katalogowy, okładka)
- Telefon może też wysłać **zdjęcie okładki**, które zostanie przypisane do dodawanej pozycji
- Wyszukiwanie, filtrowanie po formacie, sortowanie, stan nośnika, notatki
- **Kopia zapasowa**: eksport i przywracanie całej kolekcji wraz z okładkami (plik ZIP) — Ustawienia ⚙

## Ważne informacje

- **Token Discogs** (darmowy): zaloguj się na discogs.com → Settings → Developers → *Generate new token*, wklej w Ustawieniach aplikacji. MusicBrainz działa bez tokenu.
- **Skanowanie telefonem**: telefon i komputer muszą być w tej samej sieci Wi‑Fi. Przy pierwszym uruchomieniu Windows zapyta o zezwolenie w zaporze — kliknij „Zezwól".
- Identyfikacja albumu odbywa się po **kodzie kreskowym** lub wyszukiwaniu tekstowym. Rozpoznawanie po samym zdjęciu okładki nie jest udostępniane przez API MusicBrainz/Discogs — zdjęcie okładki z telefonu służy jako grafika pozycji.

## Praca nad kodem

```
npm install        # zależności
npm start          # uruchomienie w trybie deweloperskim
npm run icon       # regeneracja assets/icon.ico z assets/icon.png
npm run dist       # budowa exe (folder dist)
```

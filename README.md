# Album

Aplikacja Windows i Linux do kolekcjonowania **winyli, płyt CD i kaset magnetofonowych**.

## Instalacja

**Windows — Microsoft Store (zalecane):** [pobierz Album ze Sklepu Microsoft](https://apps.microsoft.com/store/detail/9N456B4ZL0WH?cid=DevShareMCLPCS) — automatyczne aktualizacje, bez ręcznego pobierania plików.

Alternatywnie: gotowe pliki `.exe`/`.AppImage`/`.deb` w folderze `dist` (patrz niżej) lub [Releases](https://github.com/zetmar-collab/album/releases).

## Gotowe pliki (folder `dist`)

**Windows**
- **Album-1.0.0-portable.exe** — wersja przenośna, uruchamiasz bezpośrednio, bez instalacji
- **Album-1.0.0-instalator.exe** — klasyczny instalator (skrót w menu Start)

**Linux**
- **Album-1.0.0-x86_64.AppImage** — wersja przenośna, `chmod +x` i uruchom bezpośrednio, działa na większości dystrybucji bez instalacji
- **Album-1.0.0-amd64.deb** — pakiet dla Ubuntu/Debian i pochodnych (`sudo apt install ./Album-1.0.0-amd64.deb`)

Dane kolekcji są zapisywane w profilu użytkownika (Windows: `%APPDATA%\Album\album-data`, Linux: `~/.config/album/album-data`), więc nie znikają po aktualizacji aplikacji.

## Funkcje

- Dodawanie pozycji ręcznie lub przez **skanowanie telefonem** (kod QR w aplikacji → telefon otwiera stronę skanera w przeglądarce, bez instalowania aplikacji na telefonie)
- Telefon robi zdjęcie **kodu kreskowego** → komputer odczytuje kod i pobiera dane wydania z **MusicBrainz** i **Discogs** (wykonawca, tytuł, rok, wytwórnia, nr katalogowy, okładka)
- Telefon może też wysłać **zdjęcie okładki**, które zostanie przypisane do dodawanej pozycji
- Wyszukiwanie, filtrowanie po formacie, sortowanie, stan nośnika, notatki
- **Kopia zapasowa**: eksport i przywracanie całej kolekcji wraz z okładkami (plik ZIP) — Ustawienia ⚙

## Wersja na Androida (APK)

W folderze `android/` jest natywna aplikacja na telefon (Kotlin + Jetpack Compose) z tymi samymi funkcjami: kolekcja winyli/CD/kaset, wyszukiwanie w MusicBrainz i Discogs, okładki, filtry i sortowanie. Zamiast serwera na komputerze telefon **sam skanuje kod kreskowy aparatem** (ML Kit, działa offline).

**Wymiana bazy z wersją na komputer** — to ten sam format kopii zapasowej (ZIP z `collection.json`, `settings.json` i folderem `covers/`):
- komputer → telefon: na komputerze *Ustawienia → Utwórz kopię zapasową*, plik ZIP przenieś na telefon (kabel, Dysk Google, e-mail…), w aplikacji *⚙ → Wczytaj kopię z pliku*;
- telefon → komputer: w aplikacji *⚙ → Wyślij kopię na komputer* (lub *Zapisz kopię do pliku*), a na komputerze *Ustawienia → Przywróć z kopii*;
- przy wczytywaniu na telefonie można **scalić** (dodaje tylko brakujące pozycje) albo **zastąpić** całą kolekcję; komputer zawsze zastępuje.
- Kopia zawiera token Discogs — nie wysyłaj jej osobom trzecim.

```
cd android
./gradlew assembleDebug     # APK testowy:  app/build/outputs/apk/debug/
./gradlew assembleRelease   # APK wydania (wymaga keystore.properties, patrz niżej)
./gradlew testDebugUnitTest # testy zgodności formatu kopii zapasowej
```

Podpis wydania: `android/keystore/` i `android/keystore.properties` są w `.gitignore` — **zrób ich kopię zapasową** (bez tego nie wydasz aktualizacji tej samej aplikacji). Bez `keystore.properties` `assembleRelease` zbuduje niepodpisany APK.

## Ważne informacje

- **Token Discogs** (darmowy): zaloguj się na discogs.com → Settings → Developers → *Generate new token*, wklej w Ustawieniach aplikacji. MusicBrainz działa bez tokenu.
- **Skanowanie telefonem**: telefon i komputer muszą być w tej samej sieci Wi‑Fi. Przy pierwszym uruchomieniu Windows zapyta o zezwolenie w zaporze — kliknij „Zezwól". Na Linuksie odblokuj port 8137/TCP w zaporze (np. `ufw`), jeśli jest aktywna.
- Identyfikacja albumu odbywa się po **kodzie kreskowym** lub wyszukiwaniu tekstowym. Rozpoznawanie po samym zdjęciu okładki nie jest udostępniane przez API MusicBrainz/Discogs — zdjęcie okładki z telefonu służy jako grafika pozycji.

## Praca nad kodem

```
npm install         # zależności
npm start           # uruchomienie w trybie deweloperskim
npm run icon        # regeneracja assets/icon.ico z assets/icon.png
npm run dist        # budowa dla Windows: portable + instalator (folder dist)
npm run dist:store  # budowa pakietu AppX dla Microsoft Store (folder dist)
npm run dist:linux  # budowa dla Linuksa: AppImage + deb (folder dist)
```

Budowa `dist:linux` na Debianie/Ubuntu wymaga pakietu `binutils` (`sudo apt install binutils`) do złożenia `.deb`.

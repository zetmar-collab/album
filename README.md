# Album

Aplikacja Windows i Linux do kolekcjonowania **winyli, płyt CD i kaset magnetofonowych**.

## Instalacja

**Windows — Microsoft Store (zalecane):** [pobierz Album ze Sklepu Microsoft](https://apps.microsoft.com/store/detail/9N456B4ZL0WH?cid=DevShareMCLPCS) — automatyczne aktualizacje, bez ręcznego pobierania plików.

Alternatywnie: gotowe pliki `.exe`/`.AppImage`/`.deb` pobierzesz z [Releases](https://github.com/zetmar-collab/album/releases). Własnoręczna budowa tworzy je w folderze `dist` (patrz niżej).

## Pliki wydania (folder `dist`)

**Windows**
- **Album-1.2.0-portable.exe** — wersja przenośna, uruchamiasz bezpośrednio, bez instalacji
- **Album-1.2.0-instalator.exe** — klasyczny instalator (skrót w menu Start)

**Linux**
- **Album-1.2.0-x86_64.AppImage** — wersja przenośna, `chmod +x` i uruchom bezpośrednio, działa na większości dystrybucji bez instalacji
- **Album-1.2.0-amd64.deb** — pakiet dla Ubuntu/Debian i pochodnych (`sudo apt install ./Album-1.2.0-amd64.deb`)

Dane kolekcji są zapisywane w profilu użytkownika (Windows: `%APPDATA%\Album\album-data`, Linux: `~/.config/album/album-data`), więc nie znikają po aktualizacji aplikacji.

## Funkcje

- Dodawanie pozycji ręcznie lub przez **skanowanie telefonem** (kod QR w aplikacji → telefon otwiera stronę skanera w przeglądarce, bez instalowania aplikacji na telefonie). Serwer dla telefonu działa tylko po otwarciu okna skanowania, jest chroniony jednorazowym kodem z QR i wyłącza się po 15 minutach bezczynności.
- Telefon robi zdjęcie **kodu kreskowego** → komputer odczytuje kod i pobiera dane wydania z **MusicBrainz** i **Discogs** (wykonawca, tytuł, rok, wytwórnia, nr katalogowy, okładka)
- Telefon może też wysłać **zdjęcie okładki**, które zostanie przypisane do dodawanej pozycji
- Wyszukiwanie, filtrowanie po formacie, sortowanie, stan nośnika, notatki
- **Tryb serii** (okno „Skanuj telefonem”): kolejne zeskanowane kody są zapisywane automatycznie (pierwszy wynik, z okładką i listą utworów), duplikaty są pomijane — wygodne przy dodawaniu większej partii płyt
- **Wykrywanie duplikatów** po kodzie kreskowym oraz po wykonawcy, tytule i formacie
- **Statystyki** kolekcji: liczba pozycji wg formatu, dekady, najczęstsi wykonawcy i wytwórnie, a także **orientacyjna wartość** (najniższe oferty na Discogs, w wybranej walucie)
- **Lista życzeń**: osobny widok pozycji, których jeszcze nie masz (komputer i Android); skan lub wyszukiwanie pozycji z listy życzeń oznacza ją jako posiadaną
- **Import z Discogs**: cała kolekcja z konta (API) albo z pliku CSV (Discogs → Collection → Export); duplikaty są pomijane
- **Synchronizacja przez folder** (OneDrive, Dysk Google, Dropbox): plik `Album-sync.zip` z łączeniem zmian z kilku komputerów; token Discogs nigdy tam nie trafia
- **Powiadomienie o nowej wersji** (poza wersją ze Sklepu): raz na dobę sprawdza GitHub; do wyłączenia w Ustawieniach
- **Język interfejsu**: polski i angielski (automatycznie wg systemu albo wybór w Ustawieniach)
- **Konserwacja**: czyszczenie nieużywanych okładek (Ustawienia) — po potwierdzeniu, do Kosza
- **Kopia zapasowa**: eksport i przywracanie całej kolekcji wraz z okładkami (plik ZIP) — Ustawienia ⚙. Przy przywracaniu poprzednia wersja kolekcji zostaje zapisana jako `collection.json.bak`.
- Zapis danych jest atomowy; uszkodzony plik kolekcji nie jest po cichu nadpisywany — aplikacja przywraca ostatnią poprawną wersję i informuje o tym w oknie dialogowym.

## Wersja na Androida (APK)

W folderze `android/` jest natywna aplikacja na telefon (Kotlin + Jetpack Compose) z tymi samymi funkcjami: kolekcja winyli/CD/kaset, wyszukiwanie w MusicBrainz i Discogs, okładki, filtry i sortowanie. Zamiast serwera na komputerze telefon **sam skanuje kod kreskowy aparatem** (ML Kit, działa offline).

**Wymiana bazy z wersją na komputer** — to ten sam format kopii zapasowej (ZIP z `collection.json`, `settings.json` i folderem `covers/`):
- komputer → telefon: na komputerze *Ustawienia → Utwórz kopię zapasową*, plik ZIP przenieś na telefon (kabel, Dysk Google, e-mail…), w aplikacji *⚙ → Wczytaj kopię z pliku*;
- telefon → komputer: w aplikacji *⚙ → Wyślij kopię na komputer* (lub *Zapisz kopię do pliku*), a na komputerze *Ustawienia → Przywróć z kopii*;
- przy wczytywaniu na telefonie można **scalić** (dodaje tylko brakujące pozycje) albo **zastąpić** całą kolekcję; komputer zawsze zastępuje.
- Token Discogs **nie jest** domyślnie dołączany do kopii; możesz go dołączyć świadomie (pytanie na komputerze, przełącznik w Ustawieniach na telefonie).

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
npm test            # testy jednostkowe (zapis danych, kopie zapasowe, wyszukiwarka, serwer telefonu)
npm run icon        # regeneracja assets/icon.ico z assets/icon.png
npm run dist        # budowa dla Windows: portable + instalator (folder dist)
npm run dist:store  # budowa pakietu AppX dla Microsoft Store (folder dist)
npm run dist:linux  # budowa dla Linuksa: AppImage + deb (folder dist)
```

Budowa `dist:linux` na Debianie/Ubuntu wymaga pakietu `binutils` (`sudo apt install binutils`) do złożenia `.deb`.

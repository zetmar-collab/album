# Polityka prywatności — Album

Ostatnia aktualizacja: 2026-11-05

Aplikacja **Album** (kolekcja winyli, CD i kaset) jest tworzona i utrzymywana przez Marka Zettela (zetmar). Poniżej opisano dokładnie, jakie dane aplikacja przetwarza i dlaczego.

## Jakie dane są przetwarzane

- **Twoja kolekcja** (wykonawca, tytuł, rok, wytwórnia, okładki, notatki) — zapisywana wyłącznie **lokalnie** na Twoim komputerze, w folderze profilu użytkownika Windows. Nigdy nie jest wysyłana na żaden serwer należący do dewelopera.
- **Zapytania wyszukiwania** (nazwa wykonawcy, tytuł albumu lub kod kreskowy) — wysyłane do zewnętrznych, publicznych baz danych muzycznych **MusicBrainz** ([polityka prywatności](https://metabrainz.org/privacy)) oraz, jeśli podasz własny token, **Discogs** ([polityka prywatności](https://www.discogs.com/privacy)) — wyłącznie w celu pobrania metadanych i okładki wyszukiwanej płyty. Te zapytania trafiają bezpośrednio z Twojego komputera do serwerów MusicBrainz/Discogs — deweloper aplikacji nie widzi ani nie przechowuje tych zapytań.
- **Token Discogs** (opcjonalny, wklejany ręcznie w Ustawieniach) — zapisywany wyłącznie lokalnie na Twoim komputerze (tam, gdzie system to umożliwia, w postaci zaszyfrowanej magazynem systemowym), używany tylko do autoryzacji zapytań do API Discogs i przesyłany wyłącznie nagłówkiem do serwerów Discogs.
- **Zdjęcia z telefonu** (kod kreskowy, okładka) — gdy używasz funkcji skanowania telefonem, telefon łączy się z aplikacją **bezpośrednio przez lokalną sieć Wi-Fi** (nie przez internet) i przesyła zdjęcie do programu na komputerze. Serwer w sieci lokalnej jest uruchamiany dopiero po otwarciu okna „Skanuj telefonem”, jest chroniony jednorazowym kodem zawartym w kodzie QR i wyłącza się po 15 minutach bezczynności lub na żądanie. Zdjęcie nie opuszcza Twojej sieci lokalnej i nie jest wysyłane do dewelopera ani do żadnej chmury.
- **Kopie zapasowe** — tworzone wyłącznie na żądanie użytkownika i zapisywane jako plik na dysku wskazanym przez użytkownika. Token Discogs jest dołączany do kopii tylko za Twoją wyraźną zgodą.

## Czego aplikacja NIE robi

- Nie zbiera żadnych danych analitycznych ani telemetrii.
- Nie tworzy kont użytkowników i nie wymaga logowania.
- Nie sprzedaje ani nie udostępnia żadnych danych osobom trzecim.
- Nie przechowuje Twoich danych na żadnym serwerze należącym do dewelopera — cała kolekcja pozostaje na Twoim urządzeniu.

## Uprawnienia sieciowe

Aplikacja żąda dostępu do internetu (wyszukiwanie w MusicBrainz/Discogs) oraz do sieci lokalnej (odbieranie zdjęć/kodów kreskowych z telefonu w tej samej sieci Wi-Fi). Oba uprawnienia są wykorzystywane wyłącznie do opisanych wyżej funkcji.

## Wersja na Androida

Aplikacja **Album** na Androida przetwarza dane na tych samych zasadach co wersja na komputer:

- **Kolekcja, okładki i token Discogs** są przechowywane wyłącznie w prywatnej pamięci aplikacji na Twoim telefonie. Nie są wysyłane do dewelopera.
- **Aparat** (uprawnienie CAMERA) służy wyłącznie do skanowania kodów kreskowych i robienia zdjęć okładek. Kody kreskowe są odczytywane **na urządzeniu** (Google ML Kit, bez wysyłania obrazu do sieci); zdjęcia nie są przesyłane.
- **Internet** (uprawnienie INTERNET) służy wyłącznie do zapytań do MusicBrainz i Discogs oraz pobierania okładek z tych serwisów.
- **Kopia zapasowa** to plik ZIP tworzony na Twoje żądanie. Domyślnie **nie zawiera tokenu Discogs**; możesz go dołączyć przełącznikiem w Ustawieniach.
- Brak analityki, reklam, kont użytkowników i telemetrii.

## Kontakt

Pytania dotyczące prywatności: [github.com/zetmar-collab/album](https://github.com/zetmar-collab/album) (zgłoszenie / issue) lub przez profil GitHub [zetmar-collab](https://github.com/zetmar-collab).

---

# Privacy Policy — Album (English)

Last updated: 2026-11-05

**Album** (a vinyl/CD/cassette collection manager) is developed and maintained by Marek Zettel (zetmar).

## What data is processed

- **Your collection data** (artist, title, year, label, cover art, notes) is stored **only locally** on your computer, in your Windows user profile folder. It is never sent to any server operated by the developer.
- **Search queries** (artist/title text or barcode) are sent to the public **MusicBrainz** ([privacy policy](https://metabrainz.org/privacy)) and, if you supply your own token, **Discogs** ([privacy policy](https://www.discogs.com/privacy)) APIs, solely to fetch release metadata and cover art. These requests go directly from your computer to MusicBrainz/Discogs — the app developer never sees or stores them.
- **Your Discogs token** (optional, entered manually in Settings) is stored only locally on your computer (encrypted with the operating system's secure storage where available) and is used only to authorize Discogs API requests, sent only in a request header to Discogs servers.
- **Phone photos** (barcode, cover art) — when using the phone-scan feature, your phone connects to the app **directly over your local Wi-Fi network** (not the internet) and uploads the photo to the app on your PC. The local-network server is started only when you open the "Scan with phone" window, is protected by a one-time code embedded in the QR code, and stops after 15 minutes of inactivity or on request. The photo never leaves your local network and is never sent to the developer or any cloud service.
- **Backups** are created only when you explicitly request one and are saved to a file location you choose. Your Discogs token is included only if you explicitly agree.

## What the app does NOT do

- No analytics or telemetry of any kind.
- No user accounts or sign-in required.
- No data is sold or shared with third parties.
- No user data is stored on any server operated by the developer — your entire collection stays on your device.

## Network capabilities

The app requests internet access (to search MusicBrainz/Discogs) and local-network access (to receive photos/barcodes from your phone on the same Wi-Fi network). Both are used solely for the features described above.

## Android version

The Android app follows the same principles as the desktop version:

- **Collection, cover art and Discogs token** are stored only in the app's private storage on your phone and are never sent to the developer.
- **Camera** (CAMERA permission) is used only to scan barcodes and to take cover photos. Barcodes are decoded **on the device** (Google ML Kit); images are not uploaded.
- **Internet** (INTERNET permission) is used only for MusicBrainz and Discogs requests and for downloading cover art from those services.
- **Backups** are ZIP files created on request. They **do not contain the Discogs token by default**; you can include it with a switch in Settings.
- No analytics, ads, user accounts or telemetry.

## Contact

Privacy questions: open an issue at [github.com/zetmar-collab/album](https://github.com/zetmar-collab/album) or via the GitHub profile [zetmar-collab](https://github.com/zetmar-collab).

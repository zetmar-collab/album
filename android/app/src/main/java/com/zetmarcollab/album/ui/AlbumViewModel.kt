package com.zetmarcollab.album.ui

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zetmarcollab.album.data.BackupInfo
import com.zetmarcollab.album.data.Format
import com.zetmarcollab.album.data.Images
import com.zetmarcollab.album.data.ImportMode
import com.zetmarcollab.album.data.Item
import com.zetmarcollab.album.data.Lookup
import com.zetmarcollab.album.data.RemoteResult
import com.zetmarcollab.album.data.SearchOutcome
import com.zetmarcollab.album.data.KeystoreSecretBox
import com.zetmarcollab.album.data.Store
import com.zetmarcollab.album.data.LoadStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.text.Collator
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class Screen { MAIN, EDIT, SCANNER, SETTINGS }

enum class SortKey(val label: String) {
  ARTIST("Wykonawca"),
  TITLE("Tytuł"),
  YEAR("Rok"),
  ADDED("Ostatnio dodane"),
}

class PendingImport(val file: File, val info: BackupInfo, val currentCount: Int)

sealed interface TokenStatus {
  data object Unknown : TokenStatus
  data object Checking : TokenStatus
  data object Missing : TokenStatus
  data class Valid(val username: String) : TokenStatus
  data class Invalid(val message: String) : TokenStatus
}

class AlbumViewModel(app: Application) : AndroidViewModel(app) {
  private val store = Store(File(app.filesDir, "album-data"), KeystoreSecretBox())
  private val prefs = app.getSharedPreferences("album", Context.MODE_PRIVATE)
  private val lock = Mutex()

  // ---------- stan ogolny ----------

  var screen by mutableStateOf(Screen.MAIN)
    private set
  var items by mutableStateOf(store.items)
    private set
  var token by mutableStateOf(store.discogsToken)
    private set

  /** Informacja o problemie z plikiem kolekcji wykrytym przy starcie (nic nie znika po cichu). */
  var startupNotice by mutableStateOf<String?>(
    when (store.loadStatus) {
      LoadStatus.CORRUPT ->
        "Plik kolekcji był uszkodzony i nie udało się go odzyskać. Aplikacja wystartowała z pustą kolekcją. " +
          "Uszkodzony plik został zachowany w pamięci aplikacji; możesz wczytać kopię zapasową w Ustawieniach."
      LoadStatus.RESTORED -> "Plik kolekcji był uszkodzony — przywrócono ostatnią poprawną wersję."
      else -> if (store.skippedOnLoad > 0) "Pominięto ${store.skippedOnLoad} nieprawidłowych pozycji w pliku kolekcji." else null
    },
  )
    private set

  fun dismissStartupNotice() {
    startupNotice = null
  }

  private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
  val messages: SharedFlow<String> = _messages

  private fun say(msg: String) {
    _messages.tryEmit(msg)
  }

  private suspend fun <T> io(block: () -> T): T = lock.withLock { withContext(Dispatchers.IO) { block() } }

  private fun refresh() {
    items = store.items
    token = store.discogsToken
  }

  fun goTo(s: Screen) {
    screen = s
  }

  private var settingsReturn = Screen.MAIN

  fun openSettings() {
    settingsReturn = screen
    screen = Screen.SETTINGS
    checkToken()
  }

  fun closeSettings() {
    screen = settingsReturn
  }

  // ---------- lista ----------

  var query by mutableStateOf("")
  var formatFilter by mutableStateOf<Format?>(null)
  /** true = widok listy życzeń (pozycje z flagą wishlist); false = tylko posiadane. */
  var wishlistFilter by mutableStateOf(false)
  var sortKey by mutableStateOf(SortKey.ARTIST)
  var gridView by mutableStateOf(prefs.getString("view", "grid") != "list")
    private set

  fun changeView(grid: Boolean) {
    gridView = grid
    prefs.edit().putString("view", if (grid) "grid" else "list").apply()
  }

  private fun norm(s: String): String =
    Normalizer.normalize(s.lowercase().replace('ł', 'l'), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

  /** Wywolywane w `remember(...)` z kluczami stanu - nie przy kazdej rekompozycji. */
  fun visibleItems(): List<Item> {
    val words = norm(query).split(Regex("\\s+")).filter { it.isNotEmpty() }
    val collator = Collator.getInstance(Locale.forLanguageTag("pl"))
    val filtered =
      items.filter { i ->
        i.wishlist == wishlistFilter &&
          (formatFilter == null || i.format == formatFilter) &&
          (words.isEmpty() ||
            norm(listOf(i.artist, i.title, i.label, i.genre, i.year, i.catalogNumber, i.barcode, i.notes).joinToString(" ")).let { hay -> words.all { it in hay } })
      }
    return when (sortKey) {
      SortKey.ADDED -> filtered.sortedByDescending { it.addedAt }
      SortKey.YEAR -> filtered.sortedBy { it.year.ifBlank { "9999" } }
      SortKey.ARTIST -> filtered.sortedWith { a, b -> collator.compare(a.artist.lowercase(), b.artist.lowercase()) }
      SortKey.TITLE -> filtered.sortedWith { a, b -> collator.compare(a.title.lowercase(), b.title.lowercase()) }
    }
  }

  fun coverFile(item: Item): File? = store.coverFileOf(item.coverFile)

  fun coverFile(name: String?): File? = store.coverFileOf(name)

  // ---------- edycja ----------

  var form by mutableStateOf(Item())
    private set
  var isNew by mutableStateOf(true)
    private set
  var newCoverUrl by mutableStateOf<String?>(null)
    private set
  var outcome by mutableStateOf<SearchOutcome?>(null)
    private set
  var searching by mutableStateOf(false)
    private set
  var saving by mutableStateOf(false)
    private set
  var tracksLoading by mutableStateOf(false)
    private set
  var duplicatePrompt by mutableStateOf(false)
    private set

  /** Okladki wgrane w trakcie edycji - przy anulowaniu sprzatamy te nieuzyte. */
  private val sessionCovers = mutableSetOf<String>()
  private var trackSeq = 0

  /** Stan formularza przy otwarciu - do wykrywania niezapisanych zmian. */
  private var formBaseline = Item()
  var discardPrompt by mutableStateOf(false)
    private set

  fun isFormDirty(): Boolean = form != formBaseline || newCoverUrl != null

  /** Wyjscie z edycji: przy niezapisanych zmianach najpierw pytamy. */
  fun requestCloseEdit() {
    if (isFormDirty()) discardPrompt = true else closeEdit()
  }

  fun dismissDiscardPrompt() {
    discardPrompt = false
  }

  private fun resetEditState(item: Item, new: Boolean) {
    trackSeq++ // unieważnia trwające pobieranie listy utworów z poprzedniej pozycji
    tracksLoading = false
    discardPrompt = false
    form = item
    formBaseline = if (new && item.barcode.isNotEmpty()) Item() else item // zeskanowana pozycja liczy sie jako niezapisana
    isNew = new
    newCoverUrl = null
    outcome = null
    searching = false
    saving = false
    duplicatePrompt = false
    sessionCovers.clear()
  }

  fun openNew() {
    resetEditState(Item(format = formatFilter ?: Format.VINYL, wishlist = wishlistFilter), true)
    screen = Screen.EDIT
  }

  fun openEdit(item: Item) {
    resetEditState(item, false)
    screen = Screen.EDIT
  }

  fun updateForm(transform: (Item) -> Item) {
    form = transform(form)
  }

  fun closeEdit() {
    trackSeq++
    tracksLoading = false
    discardPrompt = false
    val unused = sessionCovers.toList()
    sessionCovers.clear()
    viewModelScope.launch { io { unused.forEach { store.deleteCover(it) } } }
    screen = Screen.MAIN
  }

  fun clearCover() {
    form = form.copy(coverFile = null)
    newCoverUrl = null
  }

  /** Okladka z galerii lub aparatu (uri) - zmniejszamy i zapisujemy w katalogu okladek. */
  fun setCoverFromUri(uri: Uri) {
    viewModelScope.launch {
      val target = store.newCoverFile(".jpg")
      val ok = io { Images.saveCover(getApplication<Application>().contentResolver, uri, target) }
      if (ok) {
        sessionCovers += target.name
        form = form.copy(coverFile = target.name)
        newCoverUrl = null
      } else {
        say("Nie udało się wczytać zdjęcia.")
      }
    }
  }

  private fun guessFormat(text: String): Format? {
    val f = text.lowercase()
    return when {
      "vinyl" in f || "lp" in f || "7\"" in f || "12\"" in f -> Format.VINYL
      "cassette" in f -> Format.CASSETTE
      "cd" in f -> Format.CD
      else -> null
    }
  }

  private fun applyResult(r: RemoteResult, fallbackBarcode: String = "") {
    form =
      form.copy(
        format = guessFormat(r.formatText) ?: form.format,
        artist = r.artist,
        title = r.title,
        year = r.year,
        label = r.label,
        catalogNumber = r.catalogNumber,
        barcode = r.barcode.ifBlank { fallbackBarcode.ifBlank { form.barcode } },
        genre = r.genre,
        country = r.country,
        source = r.source,
        sourceId = r.sourceId,
      )
    if (r.coverUrl.isNotBlank()) newCoverUrl = r.coverUrl
    if (r.sourceId.isNotBlank()) {
      val seq = ++trackSeq
      tracksLoading = true
      viewModelScope.launch {
        val res = Lookup.fetchTracklist(token, r.source, r.sourceId)
        if (seq != trackSeq) return@launch
        tracksLoading = false
        if (res.error != null) say("Nie udało się pobrać listy utworów: ${res.error}")
        else if (res.text.isNotBlank()) form = form.copy(tracklist = res.text)
      }
    }
  }

  fun chooseResult(r: RemoteResult) {
    applyResult(r)
    outcome = null
  }

  private var searchJob: Job? = null
  private var searchCounter = 0

  fun searchOnline(text: String) {
    val q = text.trim()
    if (q.isEmpty()) return
    searchJob?.cancel()
    val mySearch = ++searchCounter
    searchJob =
      viewModelScope.launch {
        searching = true
        try {
          val isBarcode = Regex("^[0-9\\s-]{7,16}$").matches(q)
          outcome = if (isBarcode) Lookup.search(token, barcode = q.filter { it.isDigit() }) else Lookup.search(token, query = q)
        } catch (e: CancellationException) {
          throw e // zastąpione nowszym wyszukiwaniem - to nie jest błąd
        } catch (e: Exception) {
          say("Błąd wyszukiwania: ${e.message}")
        } finally {
          // spinner należy do najnowszego wyszukiwania (anulowane stare nie może go wyłączyć)
          if (mySearch == searchCounter) searching = false
        }
      }
  }

  fun saveForm(force: Boolean = false) {
    if (saving) return
    val trimmed =
      form.copy(
        artist = form.artist.trim(),
        title = form.title.trim(),
        year = form.year.trim(),
        label = form.label.trim(),
        catalogNumber = form.catalogNumber.trim(),
        barcode = form.barcode.trim(),
        genre = form.genre.trim(),
        country = form.country.trim(),
        tracklist = form.tracklist.trim(),
        notes = form.notes.trim(),
      )
    if (trimmed.artist.isEmpty() && trimmed.title.isEmpty()) {
      say("Podaj przynajmniej wykonawcę lub tytuł.")
      return
    }
    if (!force && isNew && trimmed.barcode.isNotEmpty() && items.any { it.barcode == trimmed.barcode }) {
      duplicatePrompt = true
      return
    }
    duplicatePrompt = false
    saving = true
    viewModelScope.launch {
      try {
        var item = trimmed
        val url = newCoverUrl
        var coverFailed = false
        if (url != null) {
          val target = store.newCoverFile(if (url.lowercase().contains(".png")) ".png" else ".jpg")
          if (Lookup.downloadCover(url, target)) {
            sessionCovers += target.name
            item = item.copy(coverFile = target.name)
          } else {
            target.delete()
            coverFailed = true
          }
        }
        val keep = item.coverFile
        io {
          store.upsert(item)
          sessionCovers.filter { it != keep }.forEach { store.deleteCover(it) }
        }
        sessionCovers.clear()
        refresh()
        screen = Screen.MAIN
        say(
          when {
            coverFailed -> "Zapisano, ale nie udało się pobrać okładki (sprawdź połączenie lub wybierz zdjęcie ręcznie)."
            isNew -> "Dodano do kolekcji: ${item.artist.ifBlank { item.title }}"
            else -> "Zapisano zmiany."
          },
        )
      } catch (e: Exception) {
        say("Błąd zapisu: ${e.message}")
      } finally {
        saving = false
      }
    }
  }

  fun dismissDuplicatePrompt() {
    duplicatePrompt = false
  }

  fun deleteCurrent() {
    if (isNew) return
    val id = form.id
    viewModelScope.launch {
      io { store.delete(id) }
      sessionCovers.clear()
      refresh()
      screen = Screen.MAIN
      say("Usunięto z kolekcji.")
    }
  }

  // ---------- skaner ----------

  var scanBusy by mutableStateOf(false)
    private set

  fun onBarcode(code: String) {
    if (scanBusy) return
    scanBusy = true
    viewModelScope.launch {
      try {
        val res = Lookup.search(token, barcode = code)
        resetEditState(Item(format = formatFilter ?: Format.VINYL, barcode = code), true)
        outcome = res
        val first = res.results.firstOrNull()
        if (first != null) {
          applyResult(first, code)
          say("Zeskanowano kod $code. Wybierz właściwe wydanie z listy lub zapisz.")
        } else {
          val err = res.errors.joinToString(" · ")
          say("Kod $code — brak wyników w bazach." + if (err.isNotEmpty()) " ($err)" else "")
        }
        screen = Screen.EDIT
      } catch (e: Exception) {
        say("Błąd wyszukiwania: ${e.message}")
      } finally {
        scanBusy = false
      }
    }
  }

  // ---------- ustawienia ----------

  var tokenStatus by mutableStateOf<TokenStatus>(TokenStatus.Unknown)
    private set

  fun checkToken() {
    val t = store.discogsToken
    if (t.isBlank()) {
      tokenStatus = TokenStatus.Missing
      return
    }
    tokenStatus = TokenStatus.Checking
    viewModelScope.launch {
      val r = Lookup.verifyToken(t)
      tokenStatus = if (r.ok) TokenStatus.Valid(r.username.orEmpty()) else TokenStatus.Invalid(r.message.orEmpty())
    }
  }

  fun saveToken(text: String) {
    val t = text.trim()
    viewModelScope.launch {
      val r = Lookup.verifyToken(t)
      if (!r.ok) {
        say("⚠ ${r.message}")
        return@launch
      }
      io { store.saveToken(t) }
      refresh()
      say(if (r.username != null) "Token poprawny — połączono z Discogs jako „${r.username}”. Zapisano." else "Zapisano ustawienia (bez tokenu Discogs).")
      checkToken()
    }
  }

  // ---------- kopia zapasowa / wymiana z komputerem ----------

  var pendingImport by mutableStateOf<PendingImport?>(null)
    private set
  var backupBusy by mutableStateOf(false)
    private set

  /** Token Discogs to sekret - do kopii trafia tylko, gdy uzytkownik sam to wlaczy (domyslnie nie). */
  var backupWithToken by mutableStateOf(false)

  private fun backupName(): String = "Album-kopia-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) + ".zip"

  fun suggestedBackupName(): String = backupName()

  fun exportTo(uri: Uri) {
    viewModelScope.launch {
      backupBusy = true
      try {
        val count = items.size
        val includeToken = backupWithToken
        io {
          val out = getApplication<Application>().contentResolver.openOutputStream(uri, "wt") ?: error("Nie można zapisać pliku.")
          out.use { store.exportBackup(it, includeToken) }
        }
        say("Utworzono kopię zapasową ($count pozycji).")
      } catch (e: Exception) {
        say("Błąd kopii zapasowej: ${e.message}")
      } finally {
        backupBusy = false
      }
    }
  }

  /** Tworzy ZIP w pamieci podrecznej, do wyslania przez menu Udostepnij. */
  suspend fun makeShareFile(): File? =
    try {
      backupBusy = true
      val includeToken = backupWithToken
      io {
        val dir = File(getApplication<Application>().cacheDir, "share").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, backupName())
        f.outputStream().use { store.exportBackup(it, includeToken) }
        f
      }
    } catch (e: Exception) {
      say("Błąd kopii zapasowej: ${e.message}")
      null
    } finally {
      backupBusy = false
    }

  fun prepareImport(uri: Uri) {
    viewModelScope.launch {
      backupBusy = true
      try {
        val pending =
          io {
            val app = getApplication<Application>()
            val inp = app.contentResolver.openInputStream(uri) ?: error("Nie można otworzyć pliku.")
            val tmp = inp.use { store.spoolToTemp(it, File(app.cacheDir, "import")) }
            try {
              PendingImport(tmp, store.inspectBackup(tmp), store.items.size)
            } catch (e: Exception) {
              tmp.delete()
              throw e
            }
          }
        pendingImport?.file?.delete()
        pendingImport = pending
      } catch (e: Exception) {
        say("Błąd przywracania: ${e.message ?: "nieprawidłowy plik"}")
      } finally {
        backupBusy = false
      }
    }
  }

  fun cancelImport() {
    pendingImport?.file?.delete()
    pendingImport = null
  }

  fun confirmImport(mode: ImportMode) {
    val p = pendingImport ?: return
    pendingImport = null
    viewModelScope.launch {
      backupBusy = true
      try {
        val r = io { store.importBackup(p.file, mode) }
        refresh()
        say(
          when (mode) {
            ImportMode.REPLACE -> "Przywrócono kolekcję: ${r.total} pozycji."
            ImportMode.MERGE -> "Scalono: dodano ${r.added}, pominięto ${r.skipped} istniejących. Razem: ${r.total}."
          }
        )
      } catch (e: Exception) {
        say("Błąd przywracania: ${e.message}")
      } finally {
        p.file.delete()
        backupBusy = false
      }
    }
  }
}

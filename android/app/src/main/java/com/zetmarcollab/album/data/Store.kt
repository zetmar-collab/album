package com.zetmarcollab.album.data

import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

enum class ImportMode { REPLACE, MERGE }

/** Szyfrowanie sekretow w spoczynku. Na Androidzie realizuje je Keystore; w testach mozna podstawic atrape. */
interface SecretBox {
  fun encrypt(plain: String): String

  fun decrypt(cipher: String): String
}

/** Wynik wczytania pliku kolekcji przy starcie - pozwala pokazac uzytkownikowi, ze cos poszlo nie tak. */
enum class LoadStatus { OK, MISSING, RESTORED, CORRUPT }

data class BackupInfo(val itemCount: Int, val newItemCount: Int, val hasToken: Boolean)

data class ImportResult(val added: Int, val skipped: Int, val total: Int)

/**
 * Magazyn danych w tym samym ukladzie co aplikacja desktopowa:
 *   album-data/collection.json   - tablica pozycji
 *   album-data/settings.json     - { "discogsToken": "..." }
 *   album-data/covers/<plik>     - okladki
 * Kopia zapasowa to ZIP z `collection.json`, `settings.json` i folderem `covers/` - dokladnie ten
 * sam format, ktory tworzy i wczytuje wersja na komputer.
 *
 * Zapis jest atomowy (plik tymczasowy + zmiana nazwy), a poprzednia wersja kolekcji zostaje jako
 * `collection.json.bak`. Uszkodzony plik nie jest po cichu zastepowany pusta lista: trafia do
 * `collection.json.corrupt-<czas>`, a dane odzyskujemy z `.bak`.
 */
class Store(private val dataDir: File, private val secretBox: SecretBox? = null) {
  private val coversDir = File(dataDir, "covers")
  private val dataFile = File(dataDir, "collection.json")
  private val backupFile = File(dataDir, "collection.json.bak")
  private val settingsFile = File(dataDir, "settings.json")

  var items: List<Item> = emptyList()
    private set

  var discogsToken: String = ""
    private set

  var loadStatus: LoadStatus = LoadStatus.OK
    private set

  /** Ile elementow pliku kolekcji pominieto jako nieprawidlowe. */
  var skippedOnLoad: Int = 0
    private set

  init {
    dataDir.mkdirs()
    coversDir.mkdirs()
    load()
  }

  private fun load() {
    if (!dataFile.exists()) {
      loadStatus = LoadStatus.MISSING
    } else {
      val primary = runCatching { Item.parseList(dataFile.readText()) }.getOrNull()
      if (primary != null) {
        items = primary.items
        skippedOnLoad = primary.skipped
        loadStatus = LoadStatus.OK
      } else {
        // Plik uszkodzony: zachowujemy go do recznego odzyskania i probujemy ostatniej dobrej wersji.
        runCatching { dataFile.renameTo(File(dataDir, "collection.json.corrupt-" + System.currentTimeMillis())) }
        val restored = runCatching { Item.parseList(backupFile.readText()) }.getOrNull()
        if (restored != null) {
          items = restored.items
          skippedOnLoad = restored.skipped
          loadStatus = LoadStatus.RESTORED
          runCatching { persistItems() }
        } else {
          items = emptyList()
          loadStatus = LoadStatus.CORRUPT
        }
      }
    }
    loadToken()
  }

  /**
   * Token Discogs: przy dostepnym `secretBox` (Android Keystore) zapisywany jest tylko w postaci zaszyfrowanej
   * (`discogsTokenEnc`); stary jawny zapis jest przy okazji migrowany. Bez `secretBox` (testy, desktopowy format)
   * zostaje `discogsToken` jak dotad.
   */
  private fun loadToken() {
    val o = runCatching { JSONObject(settingsFile.readText()) }.getOrNull()
    if (o == null) {
      discogsToken = ""
      return
    }
    val enc = o.optString("discogsTokenEnc", "")
    val box = secretBox
    discogsToken =
      if (enc.isNotEmpty() && box != null) runCatching { box.decrypt(enc) }.getOrDefault("")
      else o.optString("discogsToken", "")
    if (box != null && o.has("discogsToken") && discogsToken.isNotBlank()) runCatching { saveToken(discogsToken) }
  }

  private fun writeAtomic(target: File, text: String, keepPrevious: File? = null) {
    val tmp = File(target.parentFile, target.name + ".tmp")
    tmp.writeText(text)
    if (keepPrevious != null && target.exists()) runCatching { target.copyTo(keepPrevious, overwrite = true) }
    if (!tmp.renameTo(target)) {
      target.delete()
      check(tmp.renameTo(target)) { "Nie udało się zapisać pliku ${target.name}" }
    }
  }

  private fun persistItems() = writeAtomic(dataFile, Item.listToJson(items), keepPrevious = backupFile)

  fun saveToken(token: String) {
    discogsToken = token.trim()
    val json = JSONObject()
    val box = secretBox
    when {
      box == null -> json.put("discogsToken", discogsToken)
      discogsToken.isNotEmpty() -> json.put("discogsTokenEnc", box.encrypt(discogsToken))
    }
    writeAtomic(settingsFile, json.toString(2))
  }

  // ---------- pozycje ----------

  fun upsert(item: Item) {
    val idx = items.indexOfFirst { it.id == item.id }
    val old = if (idx > -1) items[idx].coverFile else null
    val next = if (idx > -1) items.toMutableList().also { it[idx] = item } else items + item
    persistNext(next)
    // Starą okładkę usuwamy dopiero po udanym zapisie i tylko, gdy nie używa jej inna pozycja.
    if (old != null && old != item.coverFile && next.none { it.coverFile == old }) deleteCover(old)
  }

  /** Zapisuje nowa liste; `items` zmienia sie dopiero po udanym zapisie. */
  private fun persistNext(next: List<Item>) {
    val prev = items
    items = next
    try {
      persistItems()
    } catch (e: Exception) {
      items = prev
      throw e
    }
  }

  fun delete(id: String) {
    val item = items.firstOrNull { it.id == id } ?: return
    val next = items.filterNot { it.id == id }
    persistNext(next)
    if (next.none { it.coverFile == item.coverFile }) deleteCover(item.coverFile)
  }

  // ---------- okladki ----------

  fun coverFileOf(name: String?): File? = name?.let { File(coversDir, File(it).name) }?.takeIf { it.exists() }

  fun newCoverFile(ext: String = ".jpg"): File = File(coversDir, UUID.randomUUID().toString() + ext)

  fun deleteCover(name: String?) {
    if (name == null) return
    runCatching { File(coversDir, File(name).name).delete() }
  }

  // ---------- kopia zapasowa ----------

  /**
   * Zapisuje kopie zapasowa (ZIP). Token Discogs jest sekretem, wiec do pliku trafia tylko na wyrazne
   * zadanie (`includeToken`); `settings.json` zawsze jest obecny, zeby format zgadzal sie z desktopem.
   */
  fun exportBackup(out: OutputStream, includeToken: Boolean = false) {
    val zip = ZipOutputStream(out)
    zip.putNextEntry(ZipEntry("collection.json"))
    zip.write(Item.listToJson(items).toByteArray(Charsets.UTF_8))
    zip.closeEntry()
    zip.putNextEntry(ZipEntry("settings.json"))
    zip.write(JSONObject().put("discogsToken", if (includeToken) discogsToken else "").toString(2).toByteArray(Charsets.UTF_8))
    zip.closeEntry()
    // Tylko okladki, do ktorych odwoluja sie pozycje (bez osieroconych plikow i bez duplikatow).
    val written = mutableSetOf<String>()
    for (item in items) {
      val f = coverFileOf(item.coverFile) ?: continue
      if (!written.add(f.name)) continue
      zip.putNextEntry(ZipEntry("covers/" + f.name))
      f.inputStream().use { it.copyTo(zip) }
      zip.closeEntry()
    }
    zip.finish()
    zip.flush()
  }

  /** Zapisuje strumien do pliku tymczasowego (z limitem rozmiaru), bo ZipFile wymaga swobodnego dostepu. */
  fun spoolToTemp(input: InputStream, tmpDir: File, maxBytes: Long = MAX_BACKUP_BYTES): File {
    tmpDir.mkdirs()
    val tmp = File(tmpDir, "import-" + UUID.randomUUID() + ".zip")
    try {
      tmp.outputStream().use { out ->
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          total += n
          check(total <= maxBytes) { "Plik kopii jest zbyt duży." }
          out.write(buf, 0, n)
        }
      }
    } catch (e: Exception) {
      tmp.delete()
      throw e
    }
    return tmp
  }

  private fun readIncoming(zip: ZipFile): List<Item> {
    val entry = zip.getEntry("collection.json") ?: error("To nie jest kopia zapasowa aplikacji Album (brak collection.json).")
    check(entry.size in 0..MAX_COLLECTION_BYTES) { "Plik kolekcji w kopii jest zbyt duży." }
    val text = zip.getInputStream(entry).use { readLimited(it, MAX_COLLECTION_BYTES).toString(Charsets.UTF_8) }
    return try {
      Item.parseList(text).items
    } catch (e: Exception) {
      error("Uszkodzony plik kopii zapasowej.")
    }
  }

  fun inspectBackup(file: File): BackupInfo =
    ZipFile(file).use { zip ->
      val incoming = readIncoming(zip)
      val known = items.map { it.id }.toSet()
      val tokenInZip =
        zip.getEntry("settings.json")?.let { e ->
          runCatching { JSONObject(zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) }).optString("discogsToken") }
            .getOrDefault("")
        } ?: ""
      BackupInfo(incoming.size, incoming.count { it.id !in known }, tokenInZip.isNotBlank())
    }

  fun importBackup(file: File, mode: ImportMode): ImportResult =
    ZipFile(file).use { zip ->
      val incoming = readIncoming(zip)

      /** Kopiuje okladke z ZIP-a tylko wtedy, gdy wpis jest rozsadnego rozmiaru i naprawde wyglada na obraz. */
      fun copyCover(name: String, to: File): Boolean {
        val e = zip.getEntry("covers/$name") ?: return false
        if (e.isDirectory || e.size !in 1..MAX_COVER_BYTES) return false
        val bytes = zip.getInputStream(e).use { runCatching { readLimited(it, MAX_COVER_BYTES) }.getOrNull() } ?: return false
        if (!looksLikeImage(bytes)) return false
        to.writeBytes(bytes)
        return true
      }

      val result =
        when (mode) {
          ImportMode.REPLACE -> {
            // Rozpakowujemy do katalogu obok i podmieniamy dopiero po sukcesie (z mozliwoscia cofniecia),
            // zeby blad w polowie nie zniszczyl biezacej kolekcji.
            val staging = File(dataDir, "covers.new")
            val old = File(dataDir, "covers.old")
            staging.deleteRecursively()
            old.deleteRecursively()
            staging.mkdirs()
            val names = incoming.mapNotNull { it.coverFile }.toSet()
            val kept = names.filter { n -> copyCover(n, File(staging, n)) }.toSet()
            val prevItems = items
            check(coversDir.renameTo(old)) { "Nie udało się podmienić okładek." }
            try {
              check(staging.renameTo(coversDir)) { "Nie udało się podmienić okładek." }
              items = incoming.map { if (it.coverFile != null && it.coverFile !in kept) it.copy(coverFile = null) else it }
              persistItems()
            } catch (e: Exception) {
              // Cofamy: stare okladki i stara lista pozycji.
              coversDir.deleteRecursively()
              old.renameTo(coversDir)
              items = prevItems
              throw e
            }
            old.deleteRecursively()
            ImportResult(incoming.size, 0, incoming.size)
          }
          ImportMode.MERGE -> {
            val known = items.map { it.id }.toMutableSet()
            val added = mutableListOf<Item>()
            val copied = mutableListOf<File>()
            for (inc in incoming) {
              if (!known.add(inc.id)) continue
              val keep =
                inc.coverFile?.takeIf { n ->
                  val target = File(coversDir, n)
                  // Nie nadpisujemy istniejacej okladki o tej samej nazwie.
                  (!target.exists() && copyCover(n, target)).also { if (it) copied += target }
                }
              added += inc.copy(coverFile = keep ?: inc.coverFile?.takeIf { File(coversDir, it).exists() })
            }
            val prevItems = items
            items = items + added
            try {
              persistItems()
            } catch (e: Exception) {
              items = prevItems
              copied.forEach { it.delete() }
              throw e
            }
            ImportResult(added.size, incoming.size - added.size, items.size)
          }
        }

      // Jak w desktopie: token z kopii przejmujemy tylko wtedy, gdy nie mamy wlasnego.
      zip.getEntry("settings.json")?.let { e ->
        runCatching {
          val t = JSONObject(zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) }).optString("discogsToken", "")
          if (t.isNotBlank() && discogsToken.isBlank()) saveToken(t)
        }
      }
      result
    }

  companion object {
    const val MAX_BACKUP_BYTES = 512L * 1024 * 1024
    const val MAX_COLLECTION_BYTES = 64L * 1024 * 1024
    const val MAX_COVER_BYTES = 20L * 1024 * 1024

    /**
     * Czyta strumien z twardym limitem rzeczywistych bajtow. Rozmiar zadeklarowany w naglowku ZIP-a
     * pochodzi z pliku i moze klamac (zip bomb), wiec nie wolno mu ufac.
     */
    fun readLimited(input: InputStream, limit: Long): ByteArray {
      val out = java.io.ByteArrayOutputStream()
      val buf = ByteArray(64 * 1024)
      var total = 0L
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        total += n
        check(total <= limit) { "Plik w kopii zapasowej jest zbyt duży." }
        out.write(buf, 0, n)
      }
      return out.toByteArray()
    }

    /** Sygnatury JPEG, PNG, WebP, GIF i BMP - ZIP z obcego zrodla nie moze wstrzyknac innych plikow do okladek. */
    fun looksLikeImage(b: ByteArray): Boolean {
      fun at(i: Int, vararg v: Int) = b.size > i + v.size && v.indices.all { b[i + it] == v[it].toByte() }
      return at(0, 0xFF, 0xD8, 0xFF) ||
        at(0, 0x89, 0x50, 0x4E, 0x47) ||
        at(0, 0x47, 0x49, 0x46, 0x38) ||
        at(0, 0x42, 0x4D) ||
        (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    }
  }
}

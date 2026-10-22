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

data class BackupInfo(val itemCount: Int, val newItemCount: Int, val hasToken: Boolean)

data class ImportResult(val added: Int, val skipped: Int, val total: Int)

/**
 * Magazyn danych w tym samym ukladzie co aplikacja desktopowa:
 *   album-data/collection.json   - tablica pozycji
 *   album-data/settings.json     - { "discogsToken": "..." }
 *   album-data/covers/<plik>     - okladki
 * Kopia zapasowa to ZIP z `collection.json`, `settings.json` i folderem `covers/` - dokladnie ten
 * sam format, ktory tworzy i wczytuje wersja na komputer.
 */
class Store(private val dataDir: File) {
  private val coversDir = File(dataDir, "covers")
  private val dataFile = File(dataDir, "collection.json")
  private val settingsFile = File(dataDir, "settings.json")

  var items: List<Item> = emptyList()
    private set

  var discogsToken: String = ""
    private set

  init {
    coversDir.mkdirs()
    load()
  }

  private fun load() {
    items = runCatching { Item.listFromJson(dataFile.readText()) }.getOrDefault(emptyList())
    discogsToken = runCatching { JSONObject(settingsFile.readText()).optString("discogsToken", "") }.getOrDefault("")
  }

  private fun writeAtomic(target: File, text: String) {
    val tmp = File(target.parentFile, target.name + ".tmp")
    tmp.writeText(text)
    if (!tmp.renameTo(target)) {
      target.delete()
      check(tmp.renameTo(target)) { "Nie udało się zapisać pliku ${target.name}" }
    }
  }

  private fun persistItems() = writeAtomic(dataFile, Item.listToJson(items))

  fun saveToken(token: String) {
    discogsToken = token.trim()
    writeAtomic(settingsFile, JSONObject().put("discogsToken", discogsToken).toString(2))
  }

  // ---------- pozycje ----------

  fun upsert(item: Item) {
    val idx = items.indexOfFirst { it.id == item.id }
    items =
      if (idx > -1) {
        val old = items[idx].coverFile
        if (old != null && old != item.coverFile) deleteCover(old)
        items.toMutableList().also { it[idx] = item }
      } else {
        items + item
      }
    persistItems()
  }

  fun delete(id: String) {
    val item = items.firstOrNull { it.id == id } ?: return
    deleteCover(item.coverFile)
    items = items.filterNot { it.id == id }
    persistItems()
  }

  // ---------- okladki ----------

  fun coverFileOf(name: String?): File? = name?.let { File(coversDir, File(it).name) }?.takeIf { it.exists() }

  fun newCoverFile(ext: String = ".jpg"): File = File(coversDir, UUID.randomUUID().toString() + ext)

  fun deleteCover(name: String?) {
    if (name == null) return
    runCatching { File(coversDir, File(name).name).delete() }
  }

  // ---------- kopia zapasowa ----------

  fun exportBackup(out: OutputStream) {
    val zip = ZipOutputStream(out)
    zip.putNextEntry(ZipEntry("collection.json"))
    zip.write(Item.listToJson(items).toByteArray(Charsets.UTF_8))
    zip.closeEntry()
    zip.putNextEntry(ZipEntry("settings.json"))
    zip.write(JSONObject().put("discogsToken", discogsToken).toString(2).toByteArray(Charsets.UTF_8))
    zip.closeEntry()
    // Tylko okladki, do ktorych odwoluja sie pozycje (bez osieroconych plikow).
    for (item in items) {
      val f = coverFileOf(item.coverFile) ?: continue
      zip.putNextEntry(ZipEntry("covers/" + f.name))
      f.inputStream().use { it.copyTo(zip) }
      zip.closeEntry()
    }
    zip.finish()
    zip.flush()
  }

  /** Zapisuje strumien do pliku tymczasowego, bo ZipFile wymaga swobodnego dostepu. */
  fun spoolToTemp(input: InputStream, tmpDir: File): File {
    tmpDir.mkdirs()
    val tmp = File(tmpDir, "import-" + UUID.randomUUID() + ".zip")
    tmp.outputStream().use { input.copyTo(it) }
    return tmp
  }

  private fun readIncoming(zip: ZipFile): List<Item> {
    val entry = zip.getEntry("collection.json") ?: error("To nie jest kopia zapasowa aplikacji Album (brak collection.json).")
    val text = zip.getInputStream(entry).use { it.readBytes().toString(Charsets.UTF_8) }
    return try {
      Item.listFromJson(text)
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

      fun copyCover(name: String, to: File): Boolean {
        val e = zip.getEntry("covers/$name") ?: return false
        zip.getInputStream(e).use { inp -> to.outputStream().use { inp.copyTo(it) } }
        return true
      }

      val result =
        when (mode) {
          ImportMode.REPLACE -> {
            // Najpierw rozpakowujemy do katalogu obok, zeby blad w polowie nie zniszczyl biezacej kolekcji.
            val staging = File(dataDir, "covers.new")
            staging.deleteRecursively()
            staging.mkdirs()
            val names = incoming.mapNotNull { it.coverFile }.toSet()
            for (n in names) copyCover(n, File(staging, n))
            coversDir.deleteRecursively()
            check(staging.renameTo(coversDir)) { "Nie udało się podmienić okładek." }
            items = incoming
            ImportResult(incoming.size, 0, incoming.size)
          }
          ImportMode.MERGE -> {
            val known = items.map { it.id }.toMutableSet()
            val added = mutableListOf<Item>()
            for (inc in incoming) {
              if (!known.add(inc.id)) continue
              val keep = inc.coverFile?.takeIf { n -> copyCover(n, File(coversDir, n)) }
              added += inc.copy(coverFile = keep)
            }
            items = items + added
            ImportResult(added.size, incoming.size - added.size, items.size)
          }
        }
      persistItems()

      // Jak w desktopie: token z kopii przejmujemy tylko wtedy, gdy nie mamy wlasnego.
      zip.getEntry("settings.json")?.let { e ->
        runCatching {
          val t = JSONObject(zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) }).optString("discogsToken", "")
          if (t.isNotBlank() && discogsToken.isBlank()) saveToken(t)
        }
      }
      result
    }
}

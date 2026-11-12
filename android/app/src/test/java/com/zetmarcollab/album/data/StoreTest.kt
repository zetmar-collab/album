package com.zetmarcollab.album.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/** Sprawdza wymiane kopii zapasowej z aplikacja desktopowa (ZIP: collection.json + settings.json + covers/). */
class StoreTest {
  private lateinit var root: File
  private lateinit var fixture: File

  @Before
  fun setUp() {
    root = Files.createTempDirectory("album-test").toFile()
    fixture = File(root, "desktop-backup.zip")
    javaClass.getResourceAsStream("/desktop-backup.zip")!!.use { i -> fixture.outputStream().use { i.copyTo(it) } }
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
  }

  private fun newStore(name: String = "data") = Store(File(root, name))

  @Test
  fun importsBackupMadeByDesktopApp() {
    val store = newStore()
    val info = store.inspectBackup(fixture)
    assertEquals(3, info.itemCount)
    assertEquals(3, info.newItemCount)
    assertTrue(info.hasToken)

    val r = store.importBackup(fixture, ImportMode.REPLACE)
    assertEquals(3, r.total)
    val first = store.items.first { it.id.endsWith("1") }
    assertEquals("Zażółć gęślą jaźń", first.title)
    assertEquals(Format.VINYL, first.format)
    assertEquals("Uwaga \"cytat\"\ni nowa linia", first.notes)
    assertEquals("Discogs", first.source)
    assertNotNull(store.coverFileOf(first.coverFile))
    assertEquals(Format.CASSETTE, store.items.first { it.id.endsWith("2") }.format)
    assertNull(store.items.first { it.id.endsWith("2") }.coverFile)
    // token z kopii przejmowany tylko gdy brak wlasnego
    assertEquals("TEST-TOKEN-NOT-REAL", store.discogsToken)
  }

  @Test
  fun mergeAddsOnlyMissingItems() {
    val store = newStore()
    store.upsert(Item(id = "aaaaaaaa-0000-4000-8000-000000000001", artist = "Lokalna wersja", title = "T"))
    store.upsert(Item(id = "local-only", artist = "A", title = "B"))
    val r = store.importBackup(fixture, ImportMode.MERGE)
    assertEquals(2, r.added)
    assertEquals(1, r.skipped)
    assertEquals(4, store.items.size)
    // istniejaca pozycja zostaje nietknieta
    assertEquals("Lokalna wersja", store.items.first { it.id.endsWith("1") }.artist)
  }

  @Test
  fun keepsOwnTokenOnImport() {
    val store = newStore()
    store.saveToken("MOJ-TOKEN")
    store.importBackup(fixture, ImportMode.REPLACE)
    assertEquals("MOJ-TOKEN", store.discogsToken)
  }

  @Test
  fun exportedZipHasDesktopLayoutAndRoundTrips() {
    val a = newStore("a")
    a.importBackup(fixture, ImportMode.REPLACE)
    val out = File(root, "android-export.zip")
    out.outputStream().use { a.exportBackup(it) }

    ZipFile(out).use { z ->
      val names = z.entries().asSequence().map { it.name }.toSet()
      assertTrue(names.containsAll(setOf("collection.json", "settings.json", "covers/cover-1.jpg")))
      // `coverFile: missing.jpg` nie ma pliku na dysku, wiec nie trafia do ZIP-a
      assertFalse("covers/missing.jpg" in names)
      // klucze pozycji identyczne jak w desktopie
      val arr = JSONArray(z.getInputStream(z.getEntry("collection.json")).readBytes().toString(Charsets.UTF_8))
      val keys = arr.getJSONObject(0).keys().asSequence().toSet()
      assertEquals(
        setOf("id", "format", "artist", "title", "year", "label", "catalogNumber", "barcode", "genre", "country", "condition", "tracklist", "notes", "coverFile", "source", "sourceId", "addedAt"),
        keys,
      )
      // domyslnie token NIE trafia do kopii (jest sekretem), ale settings.json zostaje dla zgodnosci z desktopem
      assertEquals("", JSONObject(z.getInputStream(z.getEntry("settings.json")).readBytes().toString(Charsets.UTF_8)).getString("discogsToken"))
    }

    val b = newStore("b")
    b.importBackup(out, ImportMode.REPLACE)
    assertEquals(a.items, b.items)
    // zapis do katalogu build dla sprawdzenia przez Node (adm-zip z desktopu)
    File("build/test-output").mkdirs()
    out.copyTo(File("build/test-output/android-export.zip"), overwrite = true)
  }

  @Test
  fun exportIncludesTokenOnlyWhenAsked() {
    val a = newStore("a")
    a.importBackup(fixture, ImportMode.REPLACE)
    val out = File(root, "with-token.zip")
    out.outputStream().use { a.exportBackup(it, includeToken = true) }
    ZipFile(out).use { z ->
      assertEquals("TEST-TOKEN-NOT-REAL", JSONObject(z.getInputStream(z.getEntry("settings.json")).readBytes().toString(Charsets.UTF_8)).getString("discogsToken"))
    }
  }

  @Test
  fun corruptCollectionIsKeptAndRestoredFromBak() {
    val dir = File(root, "data").apply { mkdirs() }
    val s1 = Store(dir)
    s1.upsert(Item(id = "1", artist = "A", title = "Pierwsza"))
    s1.upsert(Item(id = "2", artist = "B", title = "Druga")) // przy drugim zapisie poprzednia wersja trafia do .bak
    File(dir, "collection.json").writeText("[{\"id\":\"1\",") // symulacja urwanego zapisu

    val s2 = Store(dir)
    assertEquals(LoadStatus.RESTORED, s2.loadStatus)
    assertEquals(1, s2.items.size) // wersja z .bak (przed drugim zapisem)
    assertTrue(dir.listFiles()!!.any { it.name.startsWith("collection.json.corrupt-") })
  }

  @Test
  fun corruptCollectionWithoutBakIsReportedNotSilentlyReplaced() {
    val dir = File(root, "data").apply { mkdirs() }
    File(dir, "collection.json").writeText("to nie jest json")
    val s = Store(dir)
    assertEquals(LoadStatus.CORRUPT, s.loadStatus)
    assertTrue(s.items.isEmpty())
    assertTrue(dir.listFiles()!!.any { it.name.startsWith("collection.json.corrupt-") })
  }

  @Test
  fun nonObjectElementsAreSkippedAndDuplicateIdsFixed() {
    val dir = File(root, "data").apply { mkdirs() }
    File(dir, "collection.json").writeText("""[null, 7, {"id":"x","format":"cd","title":"A"}, {"id":"x","format":"cd","title":"B"}]""")
    val s = Store(dir)
    assertEquals(LoadStatus.OK, s.loadStatus)
    assertEquals(2, s.items.size)
    assertEquals(2, s.skippedOnLoad)
    assertEquals(2, s.items.map { it.id }.toSet().size)
  }

  @Test
  fun importDropsCoverEntriesThatAreNotImages() {
    val zip = File(root, "evil.zip")
    ZipOutputStream(zip.outputStream()).use { z ->
      z.putNextEntry(ZipEntry("collection.json"))
      z.write("""[{"id":"1","format":"cd","title":"T","coverFile":"skrypt.jpg"}]""".toByteArray())
      z.closeEntry()
      z.putNextEntry(ZipEntry("covers/skrypt.jpg"))
      z.write("#!/bin/sh\nrm -rf /".toByteArray())
      z.closeEntry()
    }
    val store = newStore()
    store.importBackup(zip, ImportMode.REPLACE)
    assertEquals(1, store.items.size)
    assertNull(store.items[0].coverFile) // tresc nie jest obrazem, wiec okladka odrzucona
    assertNull(store.coverFileOf("skrypt.jpg"))
  }

  @Test
  fun readLimitedStopsAtActualByteLimit() {
    assertEquals(5, Store.readLimited(ByteArray(5).inputStream(), 10).size)
    val e = runCatching { Store.readLimited(ByteArray(100).inputStream(), 10) }.exceptionOrNull()
    assertNotNull(e)
  }

  @Test
  fun looksLikeImageRecognisesCommonFormats() {
    assertTrue(Store.looksLikeImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2)))
    assertTrue(Store.looksLikeImage(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A)))
    assertFalse(Store.looksLikeImage("<html>".toByteArray()))
    assertFalse(Store.looksLikeImage(ByteArray(0)))
  }

  /** Atrapa szyfru: odwraca tekst i dodaje prefiks, zeby jawny token nie trafil do pliku. */
  private class FakeBox : SecretBox {
    override fun encrypt(plain: String) = "enc:" + plain.reversed()

    override fun decrypt(cipher: String) = cipher.removePrefix("enc:").reversed()
  }

  @Test
  fun tokenIsEncryptedAtRestWhenSecretBoxIsPresent() {
    val dir = File(root, "enc").apply { mkdirs() }
    val s1 = Store(dir, FakeBox())
    s1.saveToken("SEKRETNY-TOKEN")
    val text = File(dir, "settings.json").readText()
    assertFalse(text.contains("SEKRETNY-TOKEN"))
    assertTrue(text.contains("discogsTokenEnc"))
    assertEquals("SEKRETNY-TOKEN", Store(dir, FakeBox()).discogsToken)
  }

  @Test
  fun plaintextTokenIsMigratedToEncrypted() {
    val dir = File(root, "mig").apply { mkdirs() }
    File(dir, "settings.json").writeText("""{"discogsToken":"STARY-JAWNY"}""")
    val s = Store(dir, FakeBox())
    assertEquals("STARY-JAWNY", s.discogsToken)
    val text = File(dir, "settings.json").readText()
    assertFalse(text.contains("STARY-JAWNY"))
    assertTrue(text.contains("discogsTokenEnc"))
  }

  @Test
  fun undecryptableTokenFallsBackToEmpty() {
    val dir = File(root, "bad").apply { mkdirs() }
    File(dir, "settings.json").writeText("""{"discogsTokenEnc":"cokolwiek"}""")
    val broken =
      object : SecretBox {
        override fun encrypt(plain: String) = plain

        override fun decrypt(cipher: String): String = error("klucz utracony")
      }
    assertEquals("", Store(dir, broken).discogsToken)
  }

  @Test
  fun rejectsNonBackupZip() {
    val bad = File(root, "bad.zip")
    ZipOutputStream(bad.outputStream()).use {
      it.putNextEntry(ZipEntry("x.txt"))
      it.write(1)
    }
    val e = runCatching { newStore().inspectBackup(bad) }.exceptionOrNull()
    assertNotNull(e)
    assertTrue(e!!.message!!.contains("collection.json"))
  }

  @Test
  fun coverNamesCannotEscapeCoversDir() {
    val item = Item.fromJson(JSONObject("""{"id":"x","format":"cd","coverFile":"../../evil.jpg"}"""))
    assertEquals("evil.jpg", item.coverFile)
  }

  @Test
  fun survivesRestart() {
    val s1 = newStore()
    s1.upsert(Item(artist = "A", title = "B", year = "1999"))
    val s2 = newStore()
    assertEquals(1, s2.items.size)
    assertEquals("1999", s2.items[0].year)
  }

  @Test
  fun coverHostsAreRestricted() {
    assertTrue(Lookup.coverHostAllowed("https://coverartarchive.org/release/1/front-500"))
    assertTrue(Lookup.coverHostAllowed("https://i.discogs.com/a.jpg"))
    assertFalse(Lookup.coverHostAllowed("http://coverartarchive.org/x.jpg"))
    assertFalse(Lookup.coverHostAllowed("https://notdiscogs.com/x.jpg"))
    assertFalse(Lookup.coverHostAllowed("https://192.168.0.1/x.jpg"))
    assertFalse(Lookup.coverHostAllowed("nie url"))
  }

  @Test
  fun barcodeVariants() {
    assertEquals(listOf("724384260958", "0724384260958"), Lookup.barcodeVariants("724384260958"))
    assertEquals(listOf("0724384260958", "724384260958"), Lookup.barcodeVariants("0724384260958"))
  }
}

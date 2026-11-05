package com.zetmarcollab.album.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class Format(val key: String, val label: String, val badge: String) {
  VINYL("vinyl", "Winyl", "WINYL"),
  CD("cd", "CD", "CD"),
  CASSETTE("cassette", "Kaseta", "KASETA");

  companion object {
    fun fromKey(key: String?): Format = entries.firstOrNull { it.key == key } ?: VINYL
  }
}

/**
 * Pozycja kolekcji. Pola i ich nazwy sa identyczne z collection.json aplikacji desktopowej,
 * dzieki czemu kopia zapasowa (ZIP) jest wymienna w obie strony.
 */
data class Item(
  val id: String = UUID.randomUUID().toString(),
  val format: Format = Format.VINYL,
  val artist: String = "",
  val title: String = "",
  val year: String = "",
  val label: String = "",
  val catalogNumber: String = "",
  val barcode: String = "",
  val genre: String = "",
  val country: String = "",
  val condition: String = "",
  val tracklist: String = "",
  val notes: String = "",
  val coverFile: String? = null,
  val source: String? = null,
  val sourceId: String? = null,
  val addedAt: String = nowIso(),
) {
  fun toJson(): JSONObject =
    JSONObject().apply {
      put("id", id)
      put("format", format.key)
      put("artist", artist)
      put("title", title)
      put("year", year)
      put("label", label)
      put("catalogNumber", catalogNumber)
      put("barcode", barcode)
      put("genre", genre)
      put("country", country)
      put("condition", condition)
      put("tracklist", tracklist)
      put("notes", notes)
      put("coverFile", coverFile ?: JSONObject.NULL)
      put("source", source ?: JSONObject.NULL)
      put("sourceId", sourceId ?: JSONObject.NULL)
      put("addedAt", addedAt)
    }

  val displayArtist get() = artist.ifBlank { "(nieznany)" }
  val displayTitle get() = title.ifBlank { "(bez tytułu)" }

  companion object {
    fun fromJson(o: JSONObject): Item {
      // Desktop zapisuje rok jako tekst, ale dla pewnosci akceptujemy tez liczbe.
      fun str(key: String): String = if (o.isNull(key)) "" else o.get(key).toString().trim()
      fun strOrNull(key: String): String? = str(key).ifEmpty { null }
      return Item(
        id = strOrNull("id") ?: UUID.randomUUID().toString(),
        format = Format.fromKey(strOrNull("format")),
        artist = str("artist"),
        title = str("title"),
        year = str("year"),
        label = str("label"),
        catalogNumber = str("catalogNumber"),
        barcode = str("barcode"),
        genre = str("genre"),
        country = str("country"),
        condition = str("condition"),
        tracklist = str("tracklist"),
        notes = str("notes"),
        // tylko nazwa pliku - chroni przed sciezkami typu ../ z obcego pliku
        coverFile = strOrNull("coverFile")?.let { java.io.File(it).name }?.ifEmpty { null },
        source = strOrNull("source"),
        sourceId = strOrNull("sourceId"),
        addedAt = strOrNull("addedAt") ?: nowIso(),
      )
    }

    fun listFromJson(text: String): List<Item> = parseList(text).items

    /** Wynik tolerancyjnego wczytania: elementy, ktore nie sa obiektami (np. null), sa pomijane i liczone. */
    class Parsed(val items: List<Item>, val skipped: Int)

    fun parseList(text: String): Parsed {
      val arr = JSONArray(text)
      val seen = mutableSetOf<String>()
      val out = mutableListOf<Item>()
      var skipped = 0
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i)
        if (o == null) {
          skipped++
          continue
        }
        var item = fromJson(o)
        // Zduplikowane id psulyby edycje i usuwanie - nadajemy nowe.
        if (!seen.add(item.id)) item = item.copy(id = UUID.randomUUID().toString()).also { seen.add(it.id) }
        out += item
      }
      return Parsed(out, skipped)
    }

    fun listToJson(items: List<Item>): String {
      val arr = JSONArray()
      items.forEach { arr.put(it.toJson()) }
      return arr.toString(2)
    }
  }
}

/** ISO-8601 w UTC, tak jak `new Date().toISOString()` w Node (z milisekundami). */
fun nowIso(): String {
  val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
  f.timeZone = java.util.TimeZone.getTimeZone("UTC")
  return f.format(java.util.Date())
}

package com.zetmarcollab.album.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Wynik wyszukiwania w MusicBrainz / Discogs (te same pola co w wersji desktopowej). */
data class RemoteResult(
  val source: String,
  val sourceId: String,
  val artist: String,
  val title: String,
  val year: String,
  val label: String,
  val catalogNumber: String,
  val country: String,
  val formatText: String,
  val barcode: String,
  val genre: String,
  val coverUrl: String,
)

data class SearchOutcome(
  val results: List<RemoteResult>,
  val errors: List<String>,
  val discogsCount: Int,
  val musicBrainzCount: Int,
)

data class TokenCheck(val ok: Boolean, val username: String? = null, val message: String? = null)

/**
 * Port logiki wyszukiwania z main.js (aplikacja desktopowa): MusicBrainz bez tokenu,
 * Discogs z osobistym tokenem, warianty kodu kreskowego, przeplot wynikow.
 */
object Lookup {
  private const val UA = "AlbumApp/1.0 (kolekcja muzyczna; https://github.com/zetmar-collab/album)"

  private class HttpFailure(val code: Int) : Exception("HTTP $code")

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

  private fun open(url: String, headers: Map<String, String> = emptyMap()): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 20_000
      instanceFollowRedirects = true
      setRequestProperty("User-Agent", UA)
      headers.forEach { (k, v) -> setRequestProperty(k, v) }
    }

  private fun getJson(url: String, headers: Map<String, String> = emptyMap(), retry: Boolean = true): JSONObject {
    val c = open(url, headers)
    try {
      val code = c.responseCode
      // MusicBrainz limituje do ok. 1 zapytania/s i odpowiada 503 - jedna ponowna proba zwykle wystarcza.
      if (code == 503 && retry) {
        c.disconnect()
        Thread.sleep(1500)
        return getJson(url, headers, retry = false)
      }
      if (code !in 200..299) throw HttpFailure(code)
      return JSONObject(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) })
    } finally {
      c.disconnect()
    }
  }

  /** Ten sam kod bywa zapisany z zerem wiodacym lub bez (UPC-A 12 cyfr vs EAN-13). */
  fun barcodeVariants(barcode: String): List<String> {
    val b = barcode.filter { it.isDigit() }
    val out = linkedSetOf<String>()
    if (b.isNotEmpty()) out += b
    val noZeros = b.trimStart('0')
    if (noZeros.isNotEmpty()) out += noZeros
    if (b.length == 12) out += "0$b"
    return out.toList()
  }

  private fun searchMusicBrainz(query: String): List<RemoteResult> {
    val data = getJson("https://musicbrainz.org/ws/2/release/?query=${enc(query)}&fmt=json&limit=8", mapOf("Accept" to "application/json"))
    val arr = data.optJSONArray("releases") ?: return emptyList()
    return List(arr.length()) { i ->
      val r = arr.getJSONObject(i)
      val li = r.optJSONArray("label-info")?.optJSONObject(0)
      val credits = r.optJSONArray("artist-credit")
      val artist =
        if (credits == null) ""
        else (0 until credits.length()).joinToString("") { credits.getJSONObject(it).let { a -> a.optString("name") + a.optString("joinphrase") } }
      val id = r.optString("id")
      RemoteResult(
        source = "MusicBrainz",
        sourceId = id,
        artist = artist,
        title = r.optString("title"),
        year = r.optString("date").take(4),
        label = li?.optJSONObject("label")?.optString("name").orEmpty(),
        catalogNumber = li?.optString("catalog-number").orEmpty(),
        country = r.optString("country"),
        formatText = r.optJSONArray("media")?.optJSONObject(0)?.optString("format").orEmpty(),
        barcode = r.optString("barcode"),
        genre = "",
        coverUrl = "https://coverartarchive.org/release/$id/front-500",
      )
    }
  }

  /** Zwraca (wyniki, blad). Blad dotyczy np. braku/nieprawidlowego tokenu. */
  private fun searchDiscogs(token: String, params: Map<String, String>): Pair<List<RemoteResult>, String?> {
    if (token.isBlank()) return emptyList<RemoteResult>() to "Brak tokenu Discogs — dodaj go w Ustawieniach, aby przeszukiwać Discogs."
    val qs = (params + mapOf("type" to "release", "per_page" to "8", "token" to token.trim())).entries.joinToString("&") { "${it.key}=${enc(it.value)}" }
    val data =
      try {
        getJson("https://api.discogs.com/database/search?$qs")
      } catch (e: HttpFailure) {
        return emptyList<RemoteResult>() to if (e.code == 401) "Discogs: nieprawidłowy token (sprawdź Ustawienia)." else "Discogs: HTTP ${e.code}"
      }
    val arr = data.optJSONArray("results") ?: return emptyList<RemoteResult>() to null
    val list =
      List(arr.length()) { i ->
        val r = arr.getJSONObject(i)
        val t = r.optString("title")
        val sep = t.indexOf(" - ")
        fun first(key: String) = r.optJSONArray(key)?.optString(0).orEmpty()
        fun joined(key: String) = r.optJSONArray(key)?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } }.orEmpty()
        val catno = r.optString("catno")
        RemoteResult(
          source = "Discogs",
          sourceId = r.opt("id")?.toString().orEmpty(),
          artist = if (sep > -1) t.take(sep) else "",
          title = if (sep > -1) t.substring(sep + 3) else t,
          year = r.optString("year"),
          label = first("label"),
          catalogNumber = if (catno != "none") catno else "",
          country = r.optString("country"),
          formatText = joined("format"),
          barcode = first("barcode"),
          genre = joined("genre"),
          coverUrl = r.optString("cover_image").ifBlank { r.optString("thumb") },
        )
      }
    return list to null
  }

  private fun searchDiscogsBarcode(token: String, variants: List<String>): Pair<List<RemoteResult>, String?> {
    for (v in variants) {
      val r = searchDiscogs(token, mapOf("barcode" to v))
      if (r.second != null || r.first.isNotEmpty()) return r
    }
    // Discogs czesto trzyma kody ze spacjami ("7 24384 26095 8") - wtedy pomaga wyszukiwanie pelnotekstowe.
    var error: String? = null
    for (v in variants) {
      val r = searchDiscogs(token, mapOf("q" to v))
      if (r.second != null) {
        error = r.second
        break
      }
      if (r.first.isNotEmpty()) return r
    }
    return emptyList<RemoteResult>() to error
  }

  /** Wyszukiwanie po kodzie kreskowym (gdy `barcode` niepuste) albo po tekscie. */
  suspend fun search(token: String, barcode: String? = null, query: String? = null): SearchOutcome =
    withContext(Dispatchers.IO) {
      coroutineScope {
        val mb = async { runCatching { if (barcode != null) searchMusicBrainz(barcodeVariants(barcode).joinToString(" OR ") { "barcode:\"$it\"" }) else searchMusicBrainz(query.orEmpty()) } }
        val dc = async { runCatching { if (barcode != null) searchDiscogsBarcode(token, barcodeVariants(barcode)) else searchDiscogs(token, mapOf("q" to query.orEmpty())) } }
        val errors = mutableListOf<String>()
        val mbRes = mb.await().getOrElse { errors += "MusicBrainz: ${it.message}"; emptyList() }
        val dcPair = dc.await().getOrElse { errors += "Discogs: ${it.message}"; emptyList<RemoteResult>() to null }
        dcPair.second?.let { errors += it }
        val dcRes = dcPair.first
        // Przeplot, zeby oba serwisy byly widoczne od razu na gorze listy.
        val merged = mutableListOf<RemoteResult>()
        for (i in 0 until maxOf(mbRes.size, dcRes.size)) {
          dcRes.getOrNull(i)?.let { merged += it }
          mbRes.getOrNull(i)?.let { merged += it }
        }
        SearchOutcome(merged, errors, dcRes.size, mbRes.size)
      }
    }

  private fun msToMinSec(ms: Long): String {
    if (ms <= 0) return ""
    val s = Math.round(ms / 1000.0)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
  }

  /** Lista utworow jako tekst, po jednym w wierszu: "1. Tytul (3:45)". */
  suspend fun fetchTracklist(token: String, source: String, sourceId: String): String =
    withContext(Dispatchers.IO) {
      runCatching {
        when (source) {
          "MusicBrainz" -> {
            val data = getJson("https://musicbrainz.org/ws/2/release/${enc(sourceId)}?inc=recordings&fmt=json", mapOf("Accept" to "application/json"))
            val media = data.optJSONArray("media") ?: return@runCatching ""
            val multi = media.length() > 1
            val lines = mutableListOf<String>()
            for (mi in 0 until media.length()) {
              val m = media.getJSONObject(mi)
              val tracks = m.optJSONArray("tracks") ?: continue
              for (ti in 0 until tracks.length()) {
                val t = tracks.getJSONObject(ti)
                val rec = t.optJSONObject("recording")
                val title = t.optString("title").ifBlank { rec?.optString("title").orEmpty() }
                val len = if (t.has("length") && !t.isNull("length")) t.optLong("length") else rec?.optLong("length") ?: 0L
                val dur = msToMinSec(len)
                lines += (if (multi) "${m.optInt("position")}-" else "") + "${t.opt("position")}. $title" + if (dur.isNotEmpty()) " ($dur)" else ""
              }
            }
            lines.joinToString("\n")
          }
          "Discogs" -> {
            if (token.isBlank()) return@runCatching ""
            val data = getJson("https://api.discogs.com/releases/${enc(sourceId)}?token=${enc(token.trim())}")
            val arr = data.optJSONArray("tracklist") ?: return@runCatching ""
            (0 until arr.length())
              .map { arr.getJSONObject(it) }
              .filter { it.optString("type_") != "heading" }
              .joinToString("\n") {
                val pos = it.optString("position")
                val dur = it.optString("duration")
                (if (pos.isNotEmpty()) "$pos. " else "") + it.optString("title") + if (dur.isNotEmpty()) " ($dur)" else ""
              }
          }
          else -> ""
        }
      }.getOrDefault("")
    }

  suspend fun verifyToken(token: String): TokenCheck =
    withContext(Dispatchers.IO) {
      if (token.isBlank()) return@withContext TokenCheck(ok = true)
      try {
        val d = getJson("https://api.discogs.com/oauth/identity", mapOf("Authorization" to "Discogs token=${token.trim()}"))
        TokenCheck(ok = true, username = d.optString("username"))
      } catch (e: HttpFailure) {
        if (e.code == 401) TokenCheck(false, message = "Discogs odrzucił ten token. Skopiuj token ponownie z discogs.com → Settings → Developers.")
        else TokenCheck(false, message = "Nie udało się sprawdzić tokenu (Discogs: HTTP ${e.code}).")
      } catch (e: Exception) {
        TokenCheck(false, message = "Brak połączenia z Discogs (${e.message}).")
      }
    }

  /** Pobiera okladke do `target`; zwraca true przy sukcesie. */
  suspend fun downloadCover(url: String, target: File): Boolean =
    withContext(Dispatchers.IO) {
      runCatching {
        val c = open(url)
        try {
          if (c.responseCode !in 200..299) return@runCatching false
          val bytes = c.inputStream.use { it.readBytes() }
          if (bytes.size < 100) return@runCatching false
          target.writeBytes(bytes)
          true
        } finally {
          c.disconnect()
        }
      }.getOrDefault(false)
    }

  /** Do podgladu miniatur z internetu. */
  fun fetchBytes(url: String): ByteArray? =
    runCatching {
      val c = open(url)
      try {
        if (c.responseCode !in 200..299) null else c.inputStream.use { it.readBytes() }
      } finally {
        c.disconnect()
      }
    }.getOrNull()
}

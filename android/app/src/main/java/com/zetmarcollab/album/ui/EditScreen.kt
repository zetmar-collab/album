package com.zetmarcollab.album.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zetmarcollab.album.data.Format
import com.zetmarcollab.album.data.Item
import com.zetmarcollab.album.theme.AlbumDanger
import com.zetmarcollab.album.theme.AlbumPanel

private val CONDITIONS = listOf("—", "Nowy (M)", "Prawie nowy (NM)", "Bardzo dobry+ (VG+)", "Bardzo dobry (VG)", "Dobry (G)", "Słaby (F/P)")

@Composable
fun EditScreen(vm: AlbumViewModel, onPickGallery: () -> Unit, onTakePhoto: () -> Unit) {
  val form = vm.form
  var onlineQuery by remember { mutableStateOf("") }
  var confirmDelete by remember { mutableStateOf(false) }
  BackHandler { vm.requestCloseEdit() }

  Scaffold(
    containerColor = MaterialTheme.colorScheme.background,
    topBar = {
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { vm.requestCloseEdit() }) { Text("✕ Anuluj", color = MaterialTheme.colorScheme.onSurface) }
        Text(
          if (vm.isNew) "Dodaj pozycję" else "Edytuj pozycję",
          fontWeight = FontWeight.Bold,
          fontSize = 18.sp,
          modifier = Modifier.weight(1f),
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Button(onClick = { vm.saveForm() }, enabled = !vm.saving) { Text(if (vm.saving) "Zapisuję…" else "Zapisz") }
      }
    },
  ) { pad ->
    Column(
      Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      // ----- okladka -----
      Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        CoverImage(
          Modifier.size(132.dp),
          file = if (vm.newCoverUrl == null) vm.coverFile(form.coverFile) else null,
          url = vm.newCoverUrl,
          format = form.format,
          maxDim = 600,
          corner = 12,
        )
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          OutlinedButton(onClick = onPickGallery) { Text("🖼 Z galerii") }
          OutlinedButton(onClick = onTakePhoto) { Text("📷 Zrób zdjęcie") }
          if (form.coverFile != null || vm.newCoverUrl != null) TextButton(onClick = { vm.clearCover() }) { Text("Usuń okładkę") }
        }
      }

      // ----- wyszukiwanie online -----
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
          value = onlineQuery,
          onValueChange = { onlineQuery = it },
          placeholder = { Text("Szukaj: wykonawca, tytuł lub kod kreskowy") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
          keyboardActions = KeyboardActions(onSearch = { vm.searchOnline(onlineQuery) }),
          modifier = Modifier.weight(1f),
        )
        Button(onClick = { vm.searchOnline(onlineQuery) }, enabled = !vm.searching) { Text(if (vm.searching) "…" else "🔍") }
      }
      vm.outcome?.let { OnlineResults(vm, it) }

      HorizontalDivider(color = MaterialTheme.colorScheme.outline)

      // ----- formularz -----
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Format.entries.forEach { f ->
          FilterChip(selected = form.format == f, onClick = { vm.updateForm { it.copy(format = f) } }, label = { Text(f.label) })
        }
      }
      Field("Wykonawca", form.artist, capitalize = true) { v -> vm.updateForm { it.copy(artist = v) } }
      Field("Tytuł", form.title, capitalize = true) { v -> vm.updateForm { it.copy(title = v) } }
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Field("Rok", form.year, Modifier.weight(1f), KeyboardType.Number) { v -> vm.updateForm { it.copy(year = v) } }
        Field("Kraj", form.country, Modifier.weight(1f)) { v -> vm.updateForm { it.copy(country = v) } }
      }
      Field("Wytwórnia", form.label, capitalize = true) { v -> vm.updateForm { it.copy(label = v) } }
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Field("Nr katalogowy", form.catalogNumber, Modifier.weight(1f)) { v -> vm.updateForm { it.copy(catalogNumber = v) } }
        Field("Kod kreskowy", form.barcode, Modifier.weight(1f), KeyboardType.Number) { v -> vm.updateForm { it.copy(barcode = v) } }
      }
      Field("Gatunek", form.genre, capitalize = true) { v -> vm.updateForm { it.copy(genre = v) } }
      Dropdown("Stan: ", CONDITIONS, form.condition.ifBlank { "—" }, { c -> vm.updateForm { it.copy(condition = if (c == "—") "" else c) } })
      Field(
        "Lista utworów",
        form.tracklist,
        minLines = 4,
        singleLine = false,
        hint = if (vm.tracksLoading) "⏳ Pobieram listę utworów…" else null,
      ) { v -> vm.updateForm { it.copy(tracklist = v) } }
      Field("Notatki", form.notes, minLines = 2, singleLine = false, capitalize = true) { v -> vm.updateForm { it.copy(notes = v) } }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Switch(checked = form.wishlist, onCheckedChange = { v -> vm.updateForm { it.copy(wishlist = v) } })
        Text("Na liście życzeń (jeszcze jej nie mam)", Modifier.weight(1f))
      }

      if (!vm.isNew) {
        Button(
          onClick = { confirmDelete = true },
          colors = ButtonDefaults.buttonColors(containerColor = AlbumDanger),
          modifier = Modifier.fillMaxWidth(),
        ) { Text("Usuń z kolekcji") }
      }
      Spacer(Modifier.height(24.dp))
    }
  }

  if (confirmDelete) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text("Usunąć z kolekcji?") },
      text = { Text("„${form.displayArtist} — ${form.displayTitle}”") },
      confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteCurrent() }) { Text("Usuń", color = AlbumDanger) } },
      dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Anuluj") } },
    )
  }
  if (vm.discardPrompt) {
    AlertDialog(
      onDismissRequest = { vm.dismissDiscardPrompt() },
      title = { Text("Odrzucić zmiany?") },
      text = { Text("Masz niezapisane zmiany. Zamknąć bez zapisywania?") },
      confirmButton = { TextButton(onClick = { vm.closeEdit() }) { Text("Odrzuć", color = AlbumDanger) } },
      dismissButton = { TextButton(onClick = { vm.dismissDiscardPrompt() }) { Text("Wróć do edycji") } },
    )
  }
  if (vm.duplicatePrompt) {
    AlertDialog(
      onDismissRequest = { vm.dismissDuplicatePrompt() },
      title = { Text("Taki kod już jest w kolekcji") },
      text = { Text("Pozycja z tym kodem kreskowym już istnieje. Dodać mimo to?") },
      confirmButton = { TextButton(onClick = { vm.saveForm(force = true) }) { Text("Dodaj mimo to") } },
      dismissButton = { TextButton(onClick = { vm.dismissDuplicatePrompt() }) { Text("Anuluj") } },
    )
  }
}

@Composable
private fun Field(
  label: String,
  value: String,
  modifier: Modifier = Modifier,
  keyboardType: KeyboardType = KeyboardType.Text,
  singleLine: Boolean = true,
  minLines: Int = 1,
  capitalize: Boolean = false,
  hint: String? = null,
  onChange: (String) -> Unit,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    label = { Text(label) },
    placeholder = hint?.let { { Text(it) } },
    singleLine = singleLine,
    minLines = minLines,
    keyboardOptions =
      KeyboardOptions(
        keyboardType = keyboardType,
        capitalization = if (capitalize) androidx.compose.ui.text.input.KeyboardCapitalization.Sentences else androidx.compose.ui.text.input.KeyboardCapitalization.None,
      ),
    modifier = modifier.fillMaxWidth(),
  )
}

@Composable
private fun OnlineResults(vm: AlbumViewModel, o: com.zetmarcollab.album.data.SearchOutcome) {
  Text("Znaleziono — Discogs: ${o.discogsCount} · MusicBrainz: ${o.musicBrainzCount}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
  if (o.errors.isNotEmpty()) {
    val text = o.errors.joinToString(" · ")
    Text(text, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
    if (text.contains("token", ignoreCase = true)) TextButton(onClick = { vm.openSettings() }) { Text("Otwórz Ustawienia") }
  }
  if (o.results.isEmpty()) {
    Text("Brak wyników.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    return
  }
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    o.results.forEach { r ->
      Row(
        Modifier.fillMaxWidth().clickable { vm.chooseResult(r) }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        CoverImage(Modifier.size(48.dp), url = r.coverUrl, maxDim = 120, corner = 6)
        Column(Modifier.weight(1f)) {
          Text(if (r.artist.isNotBlank()) "${r.artist} — ${r.title}" else r.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text(listOf(r.year, r.formatText, r.label, r.country).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(r.source, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

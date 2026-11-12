package com.zetmarcollab.album.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zetmarcollab.album.data.ImportMode
import com.zetmarcollab.album.theme.AlbumDanger
import com.zetmarcollab.album.theme.AlbumOk

@Composable
fun SettingsScreen(vm: AlbumViewModel, onExportFile: () -> Unit, onShare: () -> Unit, onImportFile: () -> Unit) {
  val ctx = LocalContext.current
  var tokenText by remember(vm.token) { mutableStateOf(vm.token) }
  BackHandler { vm.closeSettings() }

  Scaffold(
    containerColor = MaterialTheme.colorScheme.background,
    topBar = {
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { vm.closeSettings() }) { Text("← Wróć", color = MaterialTheme.colorScheme.onSurface) }
        Text("Ustawienia", fontWeight = FontWeight.Bold, fontSize = 18.sp)
      }
    },
  ) { pad ->
    Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      // ----- Discogs -----
      Text("Discogs", fontWeight = FontWeight.Bold, fontSize = 16.sp)
      when (val st = vm.tokenStatus) {
        TokenStatus.Unknown, TokenStatus.Checking -> Text("Sprawdzam połączenie z Discogs…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        TokenStatus.Missing -> Text("✖ Brak tokenu Discogs — wyszukiwanie działa tylko w MusicBrainz.", color = AlbumDanger)
        is TokenStatus.Valid -> Text("✔ Discogs połączony — zalogowano jako „${st.username}”.", color = AlbumOk)
        is TokenStatus.Invalid -> Text("✖ Zapisany token jest nieprawidłowy. ${st.message}", color = AlbumDanger)
      }
      OutlinedTextField(
        value = tokenText,
        onValueChange = { tokenText = it },
        label = { Text("Token Discogs") },
        placeholder = { Text("Wklej osobisty token z discogs.com") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
      )
      Text(
        "Bez tokenu działa tylko MusicBrainz, w którym brakuje większości polskich wydań (zwłaszcza kodów kreskowych). " +
          "Darmowy token: zaloguj się na discogs.com, a potem skopiuj osobisty token (Generate new token) — nie „Consumer Key/Secret”.",
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.discogs.com/settings/developers"))) }) { Text("🌐 Strona tokenu") }
        Button(onClick = { vm.saveToken(tokenText) }) { Text("Zapisz token") }
      }

      HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outline)

      // ----- kopia zapasowa -----
      Text("Kopia zapasowa i wymiana z komputerem", fontWeight = FontWeight.Bold, fontSize = 16.sp)
      Text(
        "Kopia to plik ZIP z całą kolekcją i okładkami — w tym samym formacie co w aplikacji Album na komputer. " +
          "Plik utworzony tutaj możesz wczytać na komputerze (Ustawienia → Przywróć z kopii), a kopię z komputera — tutaj.",
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Text("Pozycji w kolekcji: ${vm.items.size}", fontSize = 13.sp)
      Button(onClick = onShare, enabled = !vm.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("📤 Wyślij kopię na komputer (udostępnij)…") }
      OutlinedButton(onClick = onExportFile, enabled = !vm.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("⬇ Zapisz kopię do pliku…") }
      OutlinedButton(onClick = onImportFile, enabled = !vm.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("⬆ Wczytaj kopię z pliku…") }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Switch(checked = vm.backupWithToken, onCheckedChange = { vm.backupWithToken = it })
        Text("Dołącz token Discogs do kopii", Modifier.weight(1f))
      }
      Text(
        if (vm.backupWithToken) "Kopia będzie zawierać Twój token Discogs — nie wysyłaj jej osobom trzecim."
        else "Domyślnie token NIE trafia do kopii (bezpieczniej przy wysyłaniu pliku). Na komputerze wpisz go ponownie w Ustawieniach.",
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outline)
      Text("Album 1.2.0 · dane są przechowywane tylko na tym urządzeniu.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }

  vm.pendingImport?.let { p ->
    AlertDialog(
      onDismissRequest = { vm.cancelImport() },
      title = { Text("Wczytać kopię zapasową?") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text("Kopia zawiera ${p.info.itemCount} pozycji, z czego ${p.info.newItemCount} nie ma jeszcze w tej kolekcji (${p.currentCount} pozycji).")
          Text("Scal — dodaje tylko brakujące pozycje, nic nie usuwa.", fontSize = 13.sp)
          Text("Zastąp — wymienia całą kolekcję na zawartość kopii.", fontSize = 13.sp, color = AlbumDanger)
          TextButton(onClick = { vm.confirmImport(ImportMode.REPLACE) }) { Text("Zastąp całą kolekcję", color = AlbumDanger) }
        }
      },
      confirmButton = { TextButton(onClick = { vm.confirmImport(ImportMode.MERGE) }) { Text("Scal") } },
      dismissButton = { TextButton(onClick = { vm.cancelImport() }) { Text("Anuluj") } },
    )
  }
}

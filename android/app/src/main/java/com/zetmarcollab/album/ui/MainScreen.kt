package com.zetmarcollab.album.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zetmarcollab.album.data.Format
import com.zetmarcollab.album.data.Item
import com.zetmarcollab.album.theme.AlbumAccent
import com.zetmarcollab.album.theme.AlbumPanel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(vm: AlbumViewModel) {
  val visible = remember(vm.items, vm.query, vm.formatFilter, vm.sortKey) { vm.visibleItems() }
  val all = vm.items

  Scaffold(
    containerColor = MaterialTheme.colorScheme.background,
    floatingActionButton = {
      Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SmallFloatingActionButton(onClick = { vm.openNew() }, containerColor = MaterialTheme.colorScheme.surfaceVariant) {
          Text("＋", fontSize = 22.sp)
        }
        ExtendedFloatingActionButton(onClick = { vm.goTo(Screen.SCANNER) }, containerColor = AlbumAccent, contentColor = androidx.compose.ui.graphics.Color.White) {
          Text("📷  Skanuj kod", fontWeight = FontWeight.SemiBold)
        }
      }
    },
  ) { pad ->
    Column(Modifier.padding(pad).fillMaxSize()) {
      Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("💿 Album", fontSize = 22.sp, fontWeight = FontWeight.Bold)
          Text(
            "${all.size} pozycji · ${all.count { it.format == Format.VINYL }} winyli · ${all.count { it.format == Format.CD }} CD · ${all.count { it.format == Format.CASSETTE }} kaset",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        TextButton(onClick = { vm.openSettings() }) { Text("⚙", fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurface) }
      }

      OutlinedTextField(
        value = vm.query,
        onValueChange = { vm.query = it },
        placeholder = { Text("Szukaj w kolekcji…") },
        singleLine = true,
        trailingIcon = if (vm.query.isNotEmpty()) ({ TextButton(onClick = { vm.query = "" }) { Text("✕") } }) else null,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
      )

      LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item { FilterChip(selected = vm.formatFilter == null, onClick = { vm.formatFilter = null }, label = { Text("Wszystkie") }) }
        item { FilterChip(selected = vm.formatFilter == Format.VINYL, onClick = { vm.formatFilter = Format.VINYL }, label = { Text("Winyle") }) }
        item { FilterChip(selected = vm.formatFilter == Format.CD, onClick = { vm.formatFilter = Format.CD }, label = { Text("CD") }) }
        item { FilterChip(selected = vm.formatFilter == Format.CASSETTE, onClick = { vm.formatFilter = Format.CASSETTE }, label = { Text("Kasety") }) }
      }

      Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Dropdown("Sortuj: ", SortKey.entries.map { it.label }, vm.sortKey.label, { l -> vm.sortKey = SortKey.entries.first { it.label == l } })
        Spacer(Modifier.weight(1f))
        FilterChip(selected = vm.gridView, onClick = { vm.changeView(true) }, label = { Text("⊞") })
        Spacer(Modifier.width(8.dp))
        FilterChip(selected = !vm.gridView, onClick = { vm.changeView(false) }, label = { Text("☰") })
      }

      if (all.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
          Text("Twoja kolekcja jest pusta", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
          Spacer(Modifier.size(8.dp))
          Text(
            "Zeskanuj kod kreskowy płyty, dodaj pozycję ręcznie albo wczytaj kopię zapasową z aplikacji na komputer (⚙ → Kopia zapasowa).",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      } else if (visible.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
          Text("Brak pozycji pasujących do filtra.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      } else if (vm.gridView) {
        LazyVerticalGrid(
          columns = GridCells.Adaptive(150.dp),
          contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 170.dp),
          horizontalArrangement = Arrangement.spacedBy(12.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          items(visible, key = { it.id }) { item -> GridCard(vm, item) }
        }
      } else {
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          items(visible, key = { it.id }) { item -> ListRow(vm, item) }
        }
      }
    }
  }
}

@Composable
private fun GridCard(vm: AlbumViewModel, item: Item) {
  Card(
    onClick = { vm.openEdit(item) },
    colors = CardDefaults.cardColors(containerColor = AlbumPanel),
    shape = RoundedCornerShape(12.dp),
  ) {
    CoverImage(Modifier.fillMaxWidth().aspectRatio(1f), file = vm.coverFile(item), format = item.format, corner = 0)
    Column(Modifier.padding(10.dp)) {
      Text(item.displayArtist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(item.displayTitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FormatBadge(item.format)
        if (item.year.isNotBlank()) Text(item.year, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun ListRow(vm: AlbumViewModel, item: Item) {
  Row(
    Modifier.fillMaxWidth().clickable { vm.openEdit(item) }.padding(vertical = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    CoverImage(Modifier.size(56.dp), file = vm.coverFile(item), format = item.format, maxDim = 160)
    Column(Modifier.weight(1f)) {
      Text(item.displayArtist, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(item.displayTitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(listOf(item.year, item.label).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    FormatBadge(item.format)
  }
}

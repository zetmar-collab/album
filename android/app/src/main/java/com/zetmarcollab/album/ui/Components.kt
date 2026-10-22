package com.zetmarcollab.album.ui

import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zetmarcollab.album.data.Format
import com.zetmarcollab.album.data.Images
import com.zetmarcollab.album.data.Lookup
import com.zetmarcollab.album.theme.AlbumPanel2
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

private object BitmapCache : LruCache<String, ImageBitmap>(24 * 1024 * 1024) {
  override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
}

/** Okladka z pliku lokalnego albo z internetu; bez obrazu pokazuje ikone formatu. */
@Composable
fun CoverImage(
  modifier: Modifier,
  file: File? = null,
  url: String? = null,
  format: Format? = null,
  maxDim: Int = 400,
  corner: Int = 8,
) {
  val key = file?.let { "f:${it.path}:${it.lastModified()}:$maxDim" } ?: url?.takeIf { it.isNotBlank() }?.let { "u:$it:$maxDim" }
  val image by produceState<ImageBitmap?>(initialValue = key?.let { BitmapCache.get(it) }, key) {
    if (key == null) {
      value = null
      return@produceState
    }
    BitmapCache.get(key)?.let {
      value = it
      return@produceState
    }
    val bmp =
      withContext(Dispatchers.IO) {
        when {
          file != null -> Images.decodeFile(file, maxDim)
          url != null -> Lookup.fetchBytes(url)?.let { Images.decodeBytes(it, maxDim) }
          else -> null
        }
      }
    value = bmp?.asImageBitmap()?.also { BitmapCache.put(key, it) }
  }
  Box(modifier.clip(RoundedCornerShape(corner.dp)).background(AlbumPanel2), contentAlignment = Alignment.Center) {
    val img = image
    if (img != null) {
      Image(img, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    } else {
      Text(if (format == Format.CASSETTE) "📼" else if (format != null) "💿" else "♪", fontSize = 28.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

fun formatColor(f: Format): Color =
  when (f) {
    Format.VINYL -> Color(0xFFE05A3A)
    Format.CD -> Color(0xFF3A8EE0)
    Format.CASSETTE -> Color(0xFF8E5AE0)
  }

@Composable
fun FormatBadge(f: Format) {
  Text(
    f.badge,
    fontSize = 10.sp,
    fontWeight = FontWeight.Bold,
    color = Color.White,
    modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(formatColor(f)).padding(horizontal = 6.dp, vertical = 2.dp),
  )
}

/** Prosta lista rozwijana (przycisk + menu). */
@Composable
fun Dropdown(label: String, options: List<String>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    OutlinedButton(onClick = { open = true }) { Text("$label$selected ▾", maxLines = 1) }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      options.forEach { o ->
        DropdownMenuItem(text = { Text(o) }, onClick = { open = false; onSelect(o) })
      }
    }
  }
}

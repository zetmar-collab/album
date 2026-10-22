package com.zetmarcollab.album.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val AlbumColors =
  darkColorScheme(
    primary = AlbumAccent,
    onPrimary = AlbumText,
    secondary = AlbumAccent,
    background = AlbumBg,
    onBackground = AlbumText,
    surface = AlbumPanel,
    onSurface = AlbumText,
    surfaceVariant = AlbumPanel2,
    onSurfaceVariant = AlbumMuted,
    surfaceContainer = AlbumPanel,
    surfaceContainerHigh = AlbumPanel2,
    surfaceContainerHighest = AlbumPanel2,
    outline = AlbumBorder,
    outlineVariant = AlbumBorder,
    error = AlbumDanger,
  )

/** Aplikacja jest zawsze ciemna - tak jak wersja desktopowa. */
@Composable
fun AlbumTheme(content: @Composable () -> Unit) {
  MaterialTheme(colorScheme = AlbumColors, typography = Typography, content = content)
}

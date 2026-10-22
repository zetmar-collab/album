package com.zetmarcollab.album.data

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.File
import java.io.InputStream

object Images {
  private fun sampleSize(w: Int, h: Int, maxDim: Int): Int {
    var s = 1
    while (w / (s * 2) >= maxDim || h / (s * 2) >= maxDim) s *= 2
    return s
  }

  private fun decode(open: () -> InputStream?, maxDim: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open()?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxDim) }
    val bmp = open()?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
    val rotation =
      runCatching {
        open()?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
      }.getOrNull()
    val degrees =
      when (rotation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    if (degrees == 0f) return bmp
    return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(degrees) }, true)
  }

  fun decodeFile(file: File, maxDim: Int): Bitmap? = runCatching { decode({ file.inputStream() }, maxDim) }.getOrNull()

  fun decodeBytes(bytes: ByteArray, maxDim: Int): Bitmap? = runCatching { decode({ bytes.inputStream() }, maxDim) }.getOrNull()

  /** Wczytuje obraz z galerii/aparatu, zmniejsza do `maxDim` i zapisuje jako JPEG. */
  fun saveCover(resolver: ContentResolver, uri: Uri, target: File, maxDim: Int = 1200): Boolean =
    runCatching {
      val bmp = decode({ resolver.openInputStream(uri) }, maxDim) ?: return false
      target.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
      true
    }.getOrDefault(false)
}

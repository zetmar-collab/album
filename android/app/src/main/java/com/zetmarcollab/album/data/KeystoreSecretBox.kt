package com.zetmarcollab.album.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Szyfruje sekrety kluczem AES-256/GCM przechowywanym w Android Keystore (klucza nie da sie wyeksportowac
 * z urzadzenia). Format: Base64(IV[12] + szyfrogram z tagiem).
 */
class KeystoreSecretBox : SecretBox {
  private fun key(): SecretKey {
    val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  override fun encrypt(plain: String): String {
    val c = Cipher.getInstance(TRANSFORM)
    c.init(Cipher.ENCRYPT_MODE, key())
    val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(out, Base64.NO_WRAP)
  }

  override fun decrypt(cipher: String): String {
    val raw = Base64.decode(cipher, Base64.NO_WRAP)
    require(raw.size > IV_BYTES) { "Nieprawidłowe dane" }
    val c = Cipher.getInstance(TRANSFORM)
    c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_BYTES))
    return String(c.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8)
  }

  private companion object {
    const val PROVIDER = "AndroidKeyStore"
    const val ALIAS = "album_discogs_token"
    const val TRANSFORM = "AES/GCM/NoPadding"
    const val IV_BYTES = 12
  }
}

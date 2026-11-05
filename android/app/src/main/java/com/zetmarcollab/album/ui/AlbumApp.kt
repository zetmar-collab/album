package com.zetmarcollab.album.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun AlbumApp(vm: AlbumViewModel = viewModel()) {
  val ctx = LocalContext.current
  val scope = rememberCoroutineScope()
  val snackbar = remember { SnackbarHostState() }

  LaunchedEffect(Unit) {
    coroutineScope {
      vm.messages.collect { msg ->
        launch {
          snackbar.currentSnackbarData?.dismiss()
          snackbar.showSnackbar(msg)
        }
      }
    }
  }

  fun fileUri(file: File): Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)

  // ----- okladka: galeria / aparat -----
  val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.setCoverFromUri(uri) }
  val cameraFile = remember { File(File(ctx.cacheDir, "camera").apply { mkdirs() }, "cover.jpg") }
  val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) vm.setCoverFromUri(fileUri(cameraFile)) }
  val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) takePicture.launch(fileUri(cameraFile))
  }

  // ----- kopia zapasowa -----
  val exportFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> if (uri != null) vm.exportTo(uri) }
  val importFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.prepareImport(uri) }

  Box(Modifier.fillMaxSize()) {
    when (vm.screen) {
      Screen.MAIN -> MainScreen(vm)
      Screen.EDIT ->
        EditScreen(
          vm,
          onPickGallery = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
          onTakePhoto = {
            // Skoro aplikacja deklaruje uprawnienie CAMERA, ACTION_IMAGE_CAPTURE wymaga jego przyznania.
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) takePicture.launch(fileUri(cameraFile))
            else cameraPermission.launch(Manifest.permission.CAMERA)
          },
        )
      Screen.SCANNER -> ScannerScreen(vm)
      Screen.SETTINGS ->
        SettingsScreen(
          vm,
          onExportFile = { exportFile.launch(vm.suggestedBackupName()) },
          onShare = {
            scope.launch {
              val f = vm.makeShareFile() ?: return@launch
              val send =
                Intent(Intent.ACTION_SEND).apply {
                  type = "application/zip"
                  putExtra(Intent.EXTRA_STREAM, fileUri(f))
                  putExtra(Intent.EXTRA_SUBJECT, f.name)
                  addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
              ctx.startActivity(Intent.createChooser(send, "Wyślij kopię zapasową"))
            }
          },
          onImportFile = { importFile.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
        )
    }
    SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding())
    vm.startupNotice?.let { notice ->
      AlertDialog(
        onDismissRequest = { vm.dismissStartupNotice() },
        title = { Text("Problem z danymi kolekcji") },
        text = { Text(notice) },
        confirmButton = { TextButton(onClick = { vm.dismissStartupNotice() }) { Text("OK") } },
      )
    }
  }
}

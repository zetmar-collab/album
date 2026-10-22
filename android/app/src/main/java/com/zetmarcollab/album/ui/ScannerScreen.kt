package com.zetmarcollab.album.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.zetmarcollab.album.theme.AlbumAccent
import java.util.concurrent.Executors

@Composable
fun ScannerScreen(vm: AlbumViewModel) {
  val ctx = LocalContext.current
  BackHandler { vm.goTo(Screen.MAIN) }

  var hasPermission by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
  var denied by remember { mutableStateOf(false) }
  val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
    hasPermission = it
    denied = !it
  }
  LaunchedEffect(Unit) { if (!hasPermission) launcher.launch(Manifest.permission.CAMERA) }

  var torch by remember { mutableStateOf(false) }
  var manual by remember { mutableStateOf("") }

  Box(Modifier.fillMaxSize().background(Color.Black)) {
    if (hasPermission) {
      CameraPreview(torchOn = torch, active = !vm.scanBusy, onCode = vm::onBarcode)
      // ramka celownika
      Box(
        Modifier.align(Alignment.Center).fillMaxWidth(0.8f).height(150.dp).border(3.dp, AlbumAccent, RoundedCornerShape(16.dp)),
      )
    } else {
      Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
          if (denied) "Bez zgody na aparat nie zeskanujesz kodu. Możesz go wpisać ręcznie poniżej albo nadać zgodę w ustawieniach systemu." else "Potrzebna zgoda na użycie aparatu.",
          color = Color.White,
        )
        Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Zezwól na aparat") }
      }
    }

    Row(Modifier.safeDrawingPadding().padding(12.dp).align(Alignment.TopStart), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onClick = { vm.goTo(Screen.MAIN) }, colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = Color.White, containerColor = Color(0x99000000))) { Text("← Wróć") }
      if (hasPermission) {
        OutlinedButton(onClick = { torch = !torch }, colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = Color.White, containerColor = Color(0x99000000))) {
          Text(if (torch) "💡 Latarka: wł." else "💡 Latarka")
        }
      }
    }

    Column(
      Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(12.dp).background(Color(0xCC000000), RoundedCornerShape(16.dp)).padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text("Skieruj aparat na kod kreskowy z tyłu płyty, kasety lub pudełka.", color = Color.White)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
          value = manual,
          onValueChange = { manual = it.filter { c -> c.isDigit() || c == ' ' } },
          placeholder = { Text("…albo wpisz kod ręcznie") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
          keyboardActions = KeyboardActions(onSearch = { if (manual.filter(Char::isDigit).length >= 7) vm.onBarcode(manual.filter(Char::isDigit)) }),
          modifier = Modifier.weight(1f),
        )
        Button(onClick = { vm.onBarcode(manual.filter(Char::isDigit)) }, enabled = manual.filter(Char::isDigit).length >= 7 && !vm.scanBusy) { Text("Szukaj") }
      }
    }

    if (vm.scanBusy) {
      Box(Modifier.fillMaxSize().background(Color(0xAA000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
          CircularProgressIndicator(color = AlbumAccent)
          Text("Szukam wydania w Discogs i MusicBrainz…", color = MaterialTheme.colorScheme.onSurface)
        }
      }
    }
  }
}

@OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraPreview(torchOn: Boolean, active: Boolean, onCode: (String) -> Unit) {
  val lifecycleOwner = LocalLifecycleOwner.current
  val currentOnCode by rememberUpdatedState(onCode)
  val currentActive by rememberUpdatedState(active)
  var camera by remember { mutableStateOf<Camera?>(null) }
  val providerRef = remember { arrayOfNulls<ProcessCameraProvider>(1) }
  val executor = remember { Executors.newSingleThreadExecutor() }
  val main = remember { Handler(Looper.getMainLooper()) }
  val scanner = remember {
    BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
        .build()
    )
  }

  DisposableEffect(Unit) {
    onDispose {
      providerRef[0]?.unbindAll()
      executor.shutdown()
      scanner.close()
    }
  }

  AndroidView(
    modifier = Modifier.fillMaxSize(),
    factory = { c ->
      val previewView = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
      val future = ProcessCameraProvider.getInstance(c)
      future.addListener(
        {
          val provider = future.get()
          providerRef[0] = provider
          val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
          val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
          analysis.setAnalyzer(executor) { proxy ->
            val media = proxy.image
            if (media == null || !currentActive) {
              proxy.close()
              return@setAnalyzer
            }
            scanner
              .process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
              .addOnSuccessListener { codes ->
                val value = codes.firstNotNullOfOrNull { it.rawValue }
                if (value != null && currentActive) main.post { if (currentActive) currentOnCode(value) }
              }
              .addOnCompleteListener { proxy.close() }
          }
          provider.unbindAll()
          camera = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        },
        ContextCompat.getMainExecutor(c),
      )
      previewView
    },
  )

  LaunchedEffect(camera, torchOn) {
    val cam = camera ?: return@LaunchedEffect
    if (cam.cameraInfo.hasFlashUnit()) cam.cameraControl.enableTorch(torchOn)
  }
}

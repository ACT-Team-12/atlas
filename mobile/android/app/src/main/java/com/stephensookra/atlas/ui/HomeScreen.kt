package com.stephensookra.atlas.ui

import android.app.Activity
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.TextSource
import com.stephensookra.atlas.data.Sample
import java.text.DateFormat
import java.util.Date

@Composable
fun HomeScreen(model: AppModel, onAbout: () -> Unit) {
    val context = LocalContext.current
    var confirmClear by remember { mutableStateOf(false) }

    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) model.recognize(listOf(uri), TextSource.Photo)
    }
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK) {
            val pages = GmsDocumentScanningResult.fromActivityResultIntent(res.data)?.pages.orEmpty().map { it.imageUri }
            model.recognize(pages, TextSource.Scan)
        }
    }
    fun pickPhoto() = photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

    /** ML Kit Document Scanner runs fully on the phone; its models come from Google Play services.
     *  If this phone cannot run it (no Play services, or the module is missing), fall back to the photo picker. */
    fun startScan() {
        val activity = context as? Activity ?: return pickPhoto()
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(10)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        fun fallBack(reason: String, e: Exception? = null) {
            Log.w("AtlasScan", "Document scanner unavailable ($reason), using the photo picker", e)
            Toast.makeText(context, "The scanner is not ready on this phone. Choose a photo instead.", Toast.LENGTH_LONG).show()
            pickPhoto()
        }
        try {
            val client = GmsDocumentScanning.getClient(options)
            val modules = ModuleInstall.getClient(context)
            // Only open the scanner when its Play services module is already on the phone. Otherwise
            // Play services shows a download screen that can fail ("Try again later") and returns nothing.
            modules.areModulesAvailable(client)
                .addOnSuccessListener { status ->
                    if (status.areModulesAvailable()) {
                        client.getStartScanIntent(activity)
                            .addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }
                            .addOnFailureListener { e -> fallBack("start failed", e) }
                    } else {
                        // Ask Play services to fetch it quietly for next time.
                        modules.deferredInstall(client)
                        fallBack("module not installed")
                    }
                }
                .addOnFailureListener { e -> fallBack("availability check failed", e) }
        } catch (e: Exception) {
            Log.w("AtlasScan", "Document scanner failed to start", e)
            pickPhoto()
        }
    }

    ScreenBody {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.clearAndSetSemantics { contentDescription = "ATLAS" }) {
            AppMark(52.dp)
            Text("ATLAS", style = Type.screenTitle.copy(fontSize = 30.sp))
        }
        ScreenTitle("Your visit paper", "Turn it into steps you can finish, with help near you.")
        MedicalNote()

        model.restoredAt?.let { at ->
            AtlasCard(border = Palette.teal) {
                val whenText = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at))
                Text("Welcome back. Your last plan is saved on this phone ($whenText).", style = Type.sub.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinePill("Open it", onClick = { model.openSaved() }, fill = Palette.mint)
                    OutlinePill("Clear from this phone", onClick = { confirmClear = true })
                }
            }
        }

        AtlasCard {
            Text("How do you want to share it?", style = Type.headline)
            PillButton("Scan my paper", onClick = { startScan() }, icon = Icons.Filled.Search)
            PillButton("Choose a photo", onClick = { pickPhoto() }, fill = Palette.paper, textColor = Palette.ink, icon = Icons.Filled.Add)
            PillButton("Type or paste the text", onClick = { model.startTyping() }, fill = Palette.paper, textColor = Palette.ink, icon = Icons.Filled.Edit)
            PillButton("Use the sample paper", onClick = { model.useSample() }, fill = Palette.sun, textColor = Palette.ink)
            Text("${Sample.LABEL}.", style = Type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal))
        }

        AtlasCard(background = Palette.peach) {
            Text("Lab results full of jargon?", style = Type.headline)
            Text("See only what your report marks outside its range, in plain words, with questions for your clinic.", style = Type.sub)
            PillButton("Explain my lab results", onClick = { model.push(com.stephensookra.atlas.Route.Labs) }, fill = Palette.ink, textColor = Palette.paper)
        }

        AtlasCard(background = Palette.mint) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.Lock, contentDescription = null, tint = Palette.ink)
                Text("Your photo never leaves this phone.", style = Type.sub.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold))
            }
            Text(
                "ATLAS reads the words on your phone. You check them, and only the text you confirm is sent to make your steps.",
                style = Type.sub,
            )
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            TextLink("Privacy", onClick = { Links.openInApp(context, PRIVACY_URL) })
            TextLink("About ATLAS", onClick = onAbout)
        }
    }

    if (confirmClear) ConfirmClearDialog(onConfirm = { confirmClear = false; model.clearFromPhone() }, onDismiss = { confirmClear = false })
}

@Composable
fun ConfirmClearDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Clear your saved plan and ATLAS reminders from this phone?") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Clear from this phone") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        containerColor = Palette.paper,
    )
}

package com.stephensookra.atlas.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.stephensookra.atlas.AppModel

@Composable
fun AboutDialog(model: AppModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var confirmClear by remember { mutableStateOf(false) }
    val version = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty()
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Palette.mintSoft).safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("About", style = Type.headline, modifier = Modifier.padding(start = 12.dp).weight(1f))
                TextButton(onClick = onDismiss) { Text("Done", color = Palette.tealDeep, fontWeight = FontWeight.Bold) }
            }
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                AtlasCard {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppMark(44.dp)
                        Column {
                            Text("ATLAS", style = Type.headline.copy(fontWeight = FontWeight.Black))
                            Text("ATL Innovation Cup 2026, Team 12", style = Type.caption.copy(fontWeight = FontWeight.Normal))
                        }
                    }
                    Text(
                        "ATLAS reads your after-visit paper, turns it into steps that quote your paper word for word, and builds a plan with verified clinics and programs: richest in metro Atlanta, and the nearest federally funded health centers anywhere in the US.",
                        style = Type.sub.copy(fontWeight = FontWeight.Normal),
                    )
                    MedicalNote()
                }
                AtlasCard {
                    Text("Your privacy", style = Type.headline)
                    TextLink("Privacy", onClick = { Links.openInApp(context, PRIVACY_URL) })
                    listOf(
                        "Photos are read on this phone and never sent.",
                        "Only the text you check is sent to make your steps.",
                        "Your plan and reminders are saved on this phone only.",
                        "No tracking and no ads.",
                    ).forEach { Text("• $it", style = Type.sub.copy(fontWeight = FontWeight.Normal)) }
                    // Red is kept for warning signs only.
                    OutlinePill("Clear from this phone", onClick = { confirmClear = true })
                }
                AtlasCard {
                    TextLink("ATLAS on the web", onClick = { Links.openInApp(context, WEBSITE_URL) })
                    Text("Version $version", style = Type.sub.copy(fontWeight = FontWeight.Normal))
                }
                Spacer(Modifier.padding(8.dp))
            }
        }
    }
    if (confirmClear) {
        ConfirmClearDialog(onConfirm = { confirmClear = false; model.clearFromPhone(); onDismiss() }, onDismiss = { confirmClear = false })
    }
}

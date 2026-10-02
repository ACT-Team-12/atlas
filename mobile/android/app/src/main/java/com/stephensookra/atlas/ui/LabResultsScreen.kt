package com.stephensookra.atlas.ui

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.data.ApiClient
import com.stephensookra.atlas.data.ApiException
import com.stephensookra.atlas.data.LabSample
import com.stephensookra.atlas.data.ResultRow
import com.stephensookra.atlas.data.ResultsResponse
import com.stephensookra.atlas.services.TextReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * "Explain my lab results": paste, or pick a screenshot or photo. The picture is read on this phone with ML Kit;
 * the person checks the words and only that text is sent. The server's code (not the AI) decides what is outside
 * the printed range.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LabResultsScreen(model: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var fromPhoto by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<ResultsResponse?>(null) }
    var showAll by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        problem = null; result = null; reading = true
        scope.launch {
            try {
                val words = TextReader.read(context, listOf(uri))
                if (words.isBlank()) problem = "We could not find any words in that picture. Try again in good light, or paste the text."
                else { text = words; fromPhoto = true }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("AtlasLabs", "OCR failed", e)
                problem = "We could not read that picture. Try again, or paste the text."
            } finally {
                reading = false
            }
        }
    }

    fun explain() {
        problem = null; result = null; showAll = false; busy = true
        val body = text
        val language = model.language
        scope.launch {
            try {
                result = ApiClient().results(body, language)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                problem = e.message
            } finally {
                busy = false
            }
        }
    }

    ScreenBody {
        ScreenTitle("Explain my lab results", "a patient asked us for this")
        Text(
            "See only the lines your report itself marks High or Low, or where the number is outside the range printed on that line. " +
                "The AI explains each test in plain words. Our code decides what is outside the range. No advice, only questions for your clinic.",
            style = Type.sub.copy(color = Palette.inkSoft),
        )
        AtlasCard {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinePill("Screenshot or photo", onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, fill = Palette.mint, icon = Icons.Filled.Add, contentDescription = "Choose a screenshot or photo of your lab report. It is read on this phone.")
                OutlinePill("Use the sample", onClick = { text = LabSample.TEXT; fromPhoto = false; result = null }, fill = Palette.sun)
            }
            if (fromPhoto) {
                Text("This is how we read your photo on this phone. Check the numbers against your report before you continue.",
                    style = Type.sub.copy(fontWeight = FontWeight.Bold, color = Palette.peachDeep))
            }
            val shape = RoundedCornerShape(14.dp)
            Box(Modifier.fillMaxWidth().background(Palette.paper, shape).border(2.dp, Palette.ink.copy(alpha = 0.6f), shape).padding(10.dp)) {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = Type.foot.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Normal, fontSize = 12.sp),
                    cursorBrush = SolidColor(Palette.teal),
                    // Fixed height that scrolls, so a long report never pushes the button off screen.
                    modifier = Modifier.fillMaxWidth().height(220.dp).semantics { contentDescription = "Lab report text" },
                )
                if (text.isEmpty()) Text("Paste the lab report here...", style = Type.body.copy(color = Palette.inkSoft.copy(alpha = 0.6f)))
            }
            Text("${LabSample.LABEL}. Nothing you paste here is stored.", style = Type.caption.copy(fontWeight = FontWeight.Normal))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Explain it in", style = Type.sub.copy(fontWeight = FontWeight.Bold))
                Spacer(Modifier.weight(1f))
                LanguagePicker(model.language) { model.updateLanguage(it) }
            }
            PillButton(if (busy) "Reading..." else "Show what's flagged", onClick = { explain() },
                enabled = !busy && !reading && text.trim().length >= 20)
            if (busy || reading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    CircularProgressIndicator(color = Palette.teal)
                    Text(if (reading) "Reading your photo on this phone..." else "Checking each line against your report...", style = Type.sub)
                }
            }
        }

        problem?.let {
            Text(it, style = Type.sub.copy(fontWeight = FontWeight.Bold, color = Palette.peachDeep),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }

        result?.let { r ->
            Text(r.headline, style = Type.title3, modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite })
            r.coverage?.let { c ->
                if (r.rows.isNotEmpty() && c.unchecked.isNotEmpty()) {
                    AtlasCard(background = Palette.peach, border = Palette.peachDeep) {
                        Text("We checked ${c.checked} of ${c.candidates} result lines. These lines were not checked, so look at them yourself:",
                            style = Type.sub.copy(fontWeight = FontWeight.Bold))
                        c.unchecked.forEach { ReportLine(it) }
                    }
                }
            }
            val flagged = r.rows.filter { it.status == "outside" }
            val others = r.rows.filter { it.status != "outside" }
            flagged.forEach { ResultRowCard(it) }
            if (others.isNotEmpty()) {
                OutlinePill(if (showAll) "Hide the others" else "Show the other ${others.size}", onClick = { showAll = !showAll })
                if (showAll) others.forEach { ResultRowCard(it) }
            }
            Text("Ranges differ between labs and people. Only your clinic can say what a result means for you.", style = Type.caption)
        }
    }
}

@Composable
private fun ResultRowCard(row: ResultRow) {
    val badge = when (row.status) {
        "outside" -> when (row.direction) { "high" -> "Above range"; "low" -> "Below range"; else -> "Flagged" }
        "inside" -> "In range"
        else -> "No range"
    }
    val outside = row.status == "outside"
    AtlasCard(background = if (outside) Palette.peach else Palette.paper,
        border = if (outside) Palette.peachDeep else Palette.ink.copy(alpha = 0.3f), lineWidth = 2.dp,
        modifier = Modifier.semantics(mergeDescendants = true) {}) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${row.test}: ${row.value} ${row.unit}".trim(), style = Type.headline, modifier = Modifier.weight(1f))
            Chip(badge, Palette.ink, Palette.paper)
        }
        if (row.plain_name.isNotBlank()) Text(row.plain_name, style = Type.sub.copy(fontWeight = FontWeight.Normal))
        if (row.reason.isNotBlank()) Text(row.reason, style = Type.sub)
        ReportLine(row.quote)
        if (row.ask.isNotBlank()) Text("Ask your clinic: ${row.ask}", style = Type.sub.copy(fontWeight = FontWeight.Normal))
    }
}

/** One line copied from the report, shown as printed. */
@Composable
private fun ReportLine(line: String) {
    Text(line, style = Type.foot.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Normal, fontSize = 12.sp),
        modifier = Modifier.sunRule().semantics { contentDescription = "From your report: $line" })
}

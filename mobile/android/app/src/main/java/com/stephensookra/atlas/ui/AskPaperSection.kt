package com.stephensookra.atlas.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.data.ApiClient
import com.stephensookra.atlas.data.ApiException
import com.stephensookra.atlas.data.AskPaper
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.Language
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private sealed interface AskPhase {
    data object Idle : AskPhase
    data object Loading : AskPhase
    data class Error(val message: String) : AskPhase
    data class Done(val question: String, val res: AskPaper.Response) : AskPhase
}

/**
 * "Ask my paper" (web/src/ui/AskPaper.tsx): a question answered only with the paper's own words, checked on the server
 * word for word (POST /api/ask). Paper first: the quotes lead, labelled "Copied word for word from your paper"; the
 * one-line lead-in comes after, smaller, under "not double-checked yet". Nothing survives: the fixed refusal and a ready
 * question built from the person's own words. An urgent question gets 911 / 211 guidance and the paper's own warning
 * lines, never an AI answer, and is caught here before anything is sent. The caller keys this on the reading and the
 * language, which clears it.
 */
@Composable
fun AskPaperSection(model: AppModel, care: CarePlanResponse, language: Language) {
    val t = AskPaper.strings(language)
    fun lt(s: String) = tagged(s, language)
    var question by remember { mutableStateOf("") }
    var phase by remember { mutableStateOf<AskPhase>(AskPhase.Idle) }
    var job by remember { mutableStateOf<Job?>(null) }
    var said by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    DisposableEffect(Unit) { onDispose { job?.cancel() } }

    fun ask() {
        val q = AskPaper.cleanQuestion(question)
        if (q.length < 3 || phase == AskPhase.Loading) return
        job?.cancel()
        // An emergency question is never sent: 911 / 211 guidance instead.
        if (AskPaper.isUrgentQuestion(q)) {
            phase = AskPhase.Done(q, AskPaper.Response.Urgent)
            said = t.urgentTitle
            return
        }
        phase = AskPhase.Loading
        said = t.asking
        val source = care.source_text
        job = scope.launch {
            val next: AskPhase = try {
                when (val out = model.askPaper(source, language, q)) {
                    is ApiClient.AskOutcome.Refused -> AskPhase.Error(AskPaper.errorMessage(out.status, out.limit, language))
                    is ApiClient.AskOutcome.Answer -> AskPhase.Done(q, AskPaper.onThisPaper(out.response, source))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                AskPhase.Error(t.error)
            }
            phase = next
            said = when (next) {
                is AskPhase.Error -> next.message
                is AskPhase.Done -> when (val r = next.res) {
                    AskPaper.Response.Urgent -> t.urgentTitle
                    is AskPaper.Response.NotInPaper -> t.refusal
                    is AskPaper.Response.Answer -> "${t.paperLabel}: ${r.quotes.joinToString(" ") { it.text }}"
                }
                else -> ""
            }
        }
    }

    AtlasCard(border = Palette.teal) {
        Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = said })
        Text(lt(t.title), style = Type.title3, modifier = Modifier.semantics { heading() })
        Text(lt(t.intro), style = Type.sub.copy(color = Palette.inkSoft))
        OutlinedTextField(
            value = question,
            onValueChange = { v ->
                question = v.take(AskPaper.MAX_QUESTION)
                // A new question: the one in flight is cancelled and an answer on screen is cleared, so an answer is never
                // shown under a question it wasn't for.
                job?.cancel(); job = null
                if (phase != AskPhase.Idle) phase = AskPhase.Idle
            },
            placeholder = { Text(t.placeholder) },
            label = { Text(lt(t.label)) },
            modifier = Modifier.fillMaxWidth(),
            // One line, as on the website, so the keyboard's Send key sends instead of starting a new line.
            singleLine = true,
            // Medicine names must stay as typed ("metformin", not "met form in").
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { ask() }),
            colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Palette.paper, unfocusedContainerColor = Palette.paper),
        )
        PillButton(t.button, onClick = { ask() }, enabled = phase != AskPhase.Loading && AskPaper.cleanQuestion(question).length >= 3)
        when (val p = phase) {
            AskPhase.Idle -> {}
            AskPhase.Loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(color = Palette.teal, modifier = Modifier.size(20.dp))
                Text(lt(t.asking), style = Type.sub.copy(color = Palette.inkSoft))
            }
            is AskPhase.Error -> Text(lt(p.message), style = Type.sub.copy(color = Palette.red),
                modifier = Modifier.fillMaxWidth().background(Palette.redSoft, RoundedCornerShape(12.dp)).padding(10.dp))
            is AskPhase.Done -> {
                Text("“${p.question}”", style = Type.sub)
                AskResult(model, p.question, p.res, language)
            }
        }
    }
}

@Composable
private fun AskResult(model: AppModel, asked: String, res: AskPaper.Response, language: Language) {
    val t = AskPaper.strings(language)
    fun lt(s: String) = tagged(s, language)
    val context = LocalContext.current
    when (res) {
        AskPaper.Response.Urgent -> {
            val warnings = AskPaper.warningLines(model.items)
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().background(Palette.redSoft, RoundedCornerShape(16.dp))
                    .border(2.dp, Palette.red, RoundedCornerShape(16.dp)).padding(12.dp),
            ) {
                Text(lt(t.urgentTitle), style = Type.headline.copy(color = Palette.red))
                Text(lt(t.urgentBody), style = Type.sub)
                if (warnings.isNotEmpty()) {
                    Text(lt(t.urgentPaper), style = Type.sub.copy(fontWeight = FontWeight.Bold))
                    warnings.forEach { w -> Text("“${w.source_quote}”", style = Type.sub, modifier = Modifier.fillMaxWidth().sunRule()) }
                }
                // The dialer opens with 911 typed in; nothing is dialed for the person.
                OutlinePill("911", onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:911"))) }, icon = Icons.Filled.Call)
            }
        }
        is AskPaper.Response.NotInPaper -> {
            val ready = AskPaper.askAboutQuestion(asked, language.name)
            var copied by remember(asked) { mutableStateOf(false) }
            val clipboard = LocalClipboardManager.current
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(16.dp)).padding(12.dp),
            ) {
                Text(lt(t.refusal), style = Type.headline)
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth().background(Palette.paper, RoundedCornerShape(12.dp))
                        .border(2.dp, Palette.ink.copy(alpha = 0.4f), RoundedCornerShape(12.dp)).padding(10.dp),
                ) {
                    Text(lt("${t.readyLabel}. ${t.readyHint}"), style = Type.caption)
                    Text(lt(ready.question), style = Type.sub)
                    OutlinePill(if (copied) t.copied else t.copy, onClick = { clipboard.setText(AnnotatedString(ready.question)); copied = true })
                }
            }
            HeldLine(res, language)
        }
        is AskPaper.Response.Answer -> {
            Column(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth().sunRule().semantics(mergeDescendants = true) {},
            ) {
                Text(lt(t.paperLabel.uppercase()), style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.teal))
                res.quotes.forEach { q -> Text("“${q.text}”", style = Type.body.copy(fontWeight = FontWeight.SemiBold)) }
            }
            res.topic?.let { topic ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.semantics(mergeDescendants = true) {}) {
                    Text(lt(t.leadNote), style = Type.caption.copy(fontWeight = FontWeight.Bold))
                    Text(lt(t.about(topic)), style = Type.sub.copy(fontWeight = FontWeight.Normal, color = Palette.inkSoft))
                }
            }
            HeldLine(res, language)
        }
    }
}

@Composable
private fun HeldLine(res: AskPaper.Response, language: Language) {
    val n = AskPaper.held(res)
    if (n > 0) Text(tagged(AskPaper.strings(language).held(n), language), style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
}

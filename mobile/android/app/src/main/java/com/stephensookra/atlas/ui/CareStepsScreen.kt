package com.stephensookra.atlas.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.Route
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.ItemKind
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.MeaningResult
import com.stephensookra.atlas.data.MeaningStatus
import com.stephensookra.atlas.data.PaperFirst
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.services.Speaker
import java.util.Locale

/** What a "Remind me" button is about. */
data class ReminderTarget(val title: String, val quote: String, val detail: String = "")

/** The care steps found in the paper, each one quoting the paper word for word. */
@Composable
fun CareStepsScreen(model: AppModel) {
    val speaker = rememberSpeaker()
    var reminder by remember { mutableStateOf<ReminderTarget?>(null) }
    val care = model.care
    if (care == null) {
        ScreenBody { Text("No steps yet. Go back and read your paper.", style = Type.body) }
        return
    }
    ScreenBody {
        ScreenTitle("Your steps", "Each one is quoted from your paper.")
        if (model.careProvenanceUnknown) OutdatedNote("These steps were saved by an older version of ATLAS, which did not keep what they were read from. Read your paper again to update them.")
        else if (model.careOutdated) OutdatedNote("You changed the text, language or reading level since this was read. Read your paper again to update these steps.")
        if (care.has_warning_signs) WarningBanner()
        Text(
            "${care.stats.grounded} steps found in your paper · ${care.stats.refused} held back because we couldn't show their words from your paper · " +
                String.format(Locale.US, "%.1f", care.stats.ms / 1000.0) + "s",
            style = Type.foot.copy(fontWeight = FontWeight.Bold),
        )
        val items = model.items
        when (model.meaning.status) {
            MeaningStatus.loading -> Text("Double-checking each explanation against your paper...", style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
            MeaningStatus.error -> Text("The double-check is not available right now, so each step shows your paper's own words first.",
                style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
            else -> {}
        }
        // Paper first: read aloud carries an explanation only when it was certified; otherwise the paper's words.
        // Not offered when the steps' language is unknown (an older saved file): never a guessed voice.
        model.stepsLanguage?.let { stepsLanguage ->
            ReadAloudBar(speaker, stepsLanguage, items.flatMapIndexed { i, it ->
                listOf("${i + 1}.") + PaperFirst.lines(PaperFirst.careStep(it, model.checkFor(it.id)))
            })
        }

        // Keyed by id, so a step's open "Why?" and "Ask your pharmacist" state never moves to the next step on Remove.
        items.forEach { item -> key(item.id) {
            val check = model.checkFor(item.id)
            CareItemCard(
                item = item,
                check = check,
                result = if (model.meaning.status == MeaningStatus.done) model.meaning.byId[item.id] else null,
                checking = model.meaning.status == MeaningStatus.loading,
                done = model.done[item.id] == true,
                onToggleDone = { model.setDone(item.id, model.done[item.id] != true) },
                // A reminder never carries the AI's title; its "when" only when certified (bookSafe in paperFirst.ts).
                onRemind = { reminder = ReminderTarget(PaperFirst.bookTitle(item.kind), item.source_quote, PaperFirst.bookWhen(item, check)) },
                onRemove = { model.remove(item.id) },
            )
        } }

        val removed = model.removedItems
        if (removed.isNotEmpty()) {
            AtlasCard(border = Palette.ink.copy(alpha = 0.3f)) {
                Text("You removed ${removed.size}", style = Type.headline)
                removed.forEach { r ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${KindStyle.of(r.kind).label}: your paper says “${r.source_quote}”", style = Type.sub.copy(fontWeight = FontWeight.Normal), modifier = Modifier.weight(1f))
                        TextLink("Undo", onClick = { model.undoRemove(r.id) },
                            modifier = Modifier.semantics { contentDescription = "Undo removing ${KindStyle.of(r.kind).label}: ${r.source_quote}" })
                    }
                }
            }
        }

        if (care.not_in_document.isNotEmpty()) {
            AtlasCard {
                Text("What your paper does not say", style = Type.headline)
                Text("Worth asking your clinic about.", style = Type.caption.copy(fontWeight = FontWeight.Normal))
                care.not_in_document.forEach { q -> Text("? $q", style = Type.sub.copy(fontWeight = FontWeight.Normal)) }
            }
        }

        if (care.refused.isNotEmpty()) {
            AtlasCard(border = Palette.ink.copy(alpha = 0.3f)) {
                Text("Held back to protect you (${care.refused.size})", style = Type.headline)
                Text("The AI suggested these, but the words aren't in your paper.", style = Type.caption.copy(fontWeight = FontWeight.Normal))
                care.refused.forEach { r -> Text("• ${r.title}", style = Type.sub.copy(fontWeight = FontWeight.Normal)) }
            }
        }

        // Where the website puts it: after the steps and the removed, not-in-paper and held-back lists, before moving on.
        MissedLinesSection(model.missedLines)

        if (model.careOutdated) {
            PillButton("Read my paper again", onClick = { speaker.stop(); model.readPaper() },
                fill = Palette.ink, textColor = Palette.paper, shadow = Palette.mint)
        } else {
            PillButton("Next: what gets in the way?", onClick = { speaker.stop(); model.push(Route.Barriers) },
                fill = Palette.ink, textColor = Palette.paper, shadow = Palette.mint)
        }
    }
    reminder?.let { ReminderDialog(it) { reminder = null } }
}

@Composable
fun CareItemCard(item: VerifiedItem, check: Check, result: MeaningResult?, checking: Boolean, done: Boolean,
                 onToggleDone: () -> Unit, onRemind: () -> Unit, onRemove: () -> Unit) {
    val style = KindStyle.of(item.kind)
    val warning = item.itemKind == ItemKind.warning_sign
    val certified = check == Check.certified
    // The AI's title is only a label once it is certified; otherwise the card is named by its kind.
    val name = if (certified) item.title else style.label
    AtlasCard(
        background = if (warning) Palette.redSoft.copy(alpha = 0.6f) else Palette.paper,
        border = if (warning) Palette.red else Palette.ink.copy(alpha = 0.75f),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(
                onClick = onToggleDone,
                modifier = Modifier.semantics {
                    contentDescription = if (done) "Done: $name" else "Mark $name done"
                    selected = done
                },
            ) {
                if (done) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Palette.teal, modifier = Modifier.size(28.dp))
                } else {
                    val ring = Palette.ink.copy(alpha = 0.6f)
                    Spacer(Modifier.size(24.dp).drawBehind {
                        drawCircle(ring, radius = size.minDimension / 2 - 1.dp.toPx(), center = Offset(size.width / 2, size.height / 2), style = Stroke(2.dp.toPx()))
                    })
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(style.label, style.background, style.foreground)
                    if (certified && item.`when`.isNotEmpty()) Text(item.`when`, style = Type.caption)
                }
                if (certified) Text(item.title, style = Type.headline.copy(textDecoration = if (done) TextDecoration.LineThrough else null))
                PaperFirstBlock(PaperFirst.careStep(item, check), done = done && !certified)
                if (item.needs_clarification && item.question_for_clinic.isNotEmpty()) {
                    Text(
                        "Ask your clinic: ${item.question_for_clinic}",
                        style = Type.sub.copy(color = Palette.peachDeep),
                        modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(12.dp)).padding(8.dp),
                    )
                }
                CheckStatus(result, checking)
                PaperFirst.askPerson(item.kind, item.source_quote, check)?.let { AskPersonBox(it) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinePill("Remind me", onClick = onRemind, fill = Palette.mint, icon = Icons.Filled.Notifications,
                        contentDescription = "Remind me about $name")
                    Spacer(Modifier.weight(1f))
                    TextLink("Remove", onClick = onRemove, color = Palette.inkSoft,
                        modifier = Modifier.semantics { contentDescription = "Remove $name" })
                }
            }
        }
    }
}

/** The second check's verdict for one step, in the same words as the website. */
@Composable
private fun CheckStatus(result: MeaningResult?, checking: Boolean) {
    when {
        checking -> Text("Double-checking this against your paper...", style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
        result == null -> {}
        result.flagged -> {
            val what = result.what_differs.trim().replaceFirstChar { it.uppercase() }
            val numbers = if (result.unexpected_numbers.isNotEmpty()) " (Number not in your paper: ${result.unexpected_numbers.joinToString(", ")}.)" else ""
            Text(
                "Double-check this one with your clinic: our second check says the explanation may not match your paper." +
                    (if (what.isNotEmpty()) " $what" else "") + numbers,
                style = Type.sub.copy(color = Palette.peachDeep),
                modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(12.dp)).padding(8.dp),
            )
        }
        // SEAL_TEXT.twice in web/src/lib/stepsView.ts, as on iOS.
        result.certified -> Text("✓ Checked twice: the words are on your paper, and a second check agrees with the explanation.", style = Type.caption.copy(color = Palette.teal))
        else -> {
            // Checked once: the long reason waits behind "Why?" (the website's details element).
            var why by remember { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TextLink(if (why) "Checked once · Hide why" else "Checked once · Why?", onClick = { why = !why }, color = Palette.inkSoft)
                if (why) Text("${PaperFirst.CHECKED_ONCE} Our second check couldn't confirm this one.",
                    style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
            }
        }
    }
}

/** "Ask your pharmacist" / "Ask your clinic" (askPerson in web/src/lib/askPerson.ts): the paper's own words, to show or copy. */
@Composable
private fun AskPersonBox(ask: PaperFirst.AskPerson) {
    var open by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinePill(ask.label, onClick = { open = !open }, fill = Palette.sun, icon = Icons.Filled.Person,
            contentDescription = ask.label)
        if (open) {
            Column(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth().background(Palette.paper, RoundedCornerShape(12.dp)).padding(10.dp),
            ) {
                Text(
                    if (ask.who == "pharmacist") "Show or read this to your pharmacist. It uses only your paper's words."
                    else "Show or read this to your clinic. It uses only your paper's words.",
                    style = Type.caption.copy(fontWeight = FontWeight.Bold),
                )
                Text(ask.question, style = Type.sub)
                TextLink(if (copied) "Copied" else "Copy question", onClick = { clipboard.setText(AnnotatedString(ask.question)); copied = true })
            }
        }
    }
}

/**
 * Paper first (web/src/ui/PaperFirst.tsx). Certified: the explanation leads and the quote follows. Otherwise the
 * paper's words lead, labelled, and the explanation is secondary with its note.
 */
@Composable
fun PaperFirstBlock(v: PaperFirst.View, done: Boolean = false) {
    if (v.quote.isEmpty()) return
    if (v.explanationLeads) {
        v.explanation?.let { Text(it, style = Type.body) }
        PaperQuote(v.quote)
        return
    }
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxWidth().sunRule().semantics(mergeDescendants = true) { contentDescription = "${v.screenLabel}: ${v.quote}" },
    ) {
        Text(v.screenLabel.uppercase(), style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.teal))
        Text(
            "“${v.quote}”",
            style = Type.body.copy(fontWeight = FontWeight.SemiBold, textDecoration = if (done) TextDecoration.LineThrough else null),
        )
    }
    if (v.explanation != null) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            v.note?.let { Text(it, style = Type.caption.copy(fontWeight = FontWeight.Bold, color = Palette.inkSoft)) }
            Text(v.explanation, style = Type.sub.copy(fontWeight = FontWeight.Normal, color = Palette.inkSoft))
        }
    }
}

/** Shown when what is on screen no longer matches what was entered (StaleGuard). */
@Composable
fun OutdatedNote(text: String) {
    Text(
        text,
        style = Type.sub.copy(color = Palette.peachDeep),
        modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(12.dp)).padding(10.dp),
    )
}

@Composable
fun rememberSpeaker(): Speaker {
    val context = LocalContext.current
    val speaker = remember { Speaker(context) }
    DisposableEffect(speaker) { onDispose { speaker.shutdown() } }
    return speaker
}

/** Read aloud with a visible Stop button. */
@Composable
fun ReadAloudBar(speaker: Speaker, language: Language, lines: List<String>) {
    val speaking by speaker.speaking.collectAsState()
    val note by speaker.note.collectAsState()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (speaking) {
            OutlinePill("Stop reading", onClick = { speaker.stop() }, fill = Palette.peach, icon = Icons.Filled.Close,
                contentDescription = "Stop reading out loud")
        } else {
            OutlinePill("Read it out loud", onClick = { speaker.speak(lines, language) }, fill = Palette.sun, icon = Icons.Filled.PlayArrow,
                contentDescription = "Read it out loud in ${language.name}")
        }
        note?.let { Text(it, style = Type.caption.copy(fontWeight = FontWeight.SemiBold)) }
    }
}

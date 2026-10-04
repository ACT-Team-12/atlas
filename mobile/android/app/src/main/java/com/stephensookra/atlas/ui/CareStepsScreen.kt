package com.stephensookra.atlas.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.Route
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.MeaningResult
import com.stephensookra.atlas.data.MeaningStatus
import com.stephensookra.atlas.data.PaperFirst
import com.stephensookra.atlas.data.Pip
import com.stephensookra.atlas.data.StepsWhen
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.data.WarningPin
import com.stephensookra.atlas.services.Speaker
import java.util.Locale
import kotlinx.coroutines.delay

/** What a "Remind me" button is about. */
data class ReminderTarget(val title: String, val quote: String, val detail: String = "")

/** The care steps found in the paper, each one quoting the paper word for word. */
@Composable
fun CareStepsScreen(model: AppModel) {
    val speaker = rememberSpeaker()
    var reminder by remember { mutableStateOf<ReminderTarget?>(null) }
    // Pip (data/Pip.kt): the step just marked done, cheered for a moment, and whether the first-view heading greeting is
    // over (for good once a step is marked done here).
    val pipCalm = rememberPipCalm()
    var cheering by remember { mutableStateOf<String?>(null) }
    var greetOver by remember { mutableStateOf(false) }
    LaunchedEffect(cheering) {
        if (cheering != null) { delay(Pip.CHEER_MILLIS); cheering = null }
    }
    var pipSaid by remember { mutableStateOf("") }
    val care = model.care
    if (care == null) {
        ScreenBody { Text("No steps yet. Go back and read your paper.", style = Type.body) }
        return
    }
    ScreenBody {
        ScreenTitle("Your steps", "Each one is quoted from your paper.")
        if (model.careProvenanceUnknown) OutdatedNote("These steps were saved by an older version of ATLAS, which did not keep what they were read from. Read your paper again to update them.")
        else if (model.careOutdated) OutdatedNote("You changed the text, language or reading level since this was read. Read your paper again to update these steps.")
        // One warning section, as on the website: the pinned steps' own heading below when there are any; this banner only
        // when the reading flags warnings but no shown step is pinned.
        if (model.hasWarnings && model.warningItems.isEmpty()) WarningBanner()
        Text(
            "${care.stats.grounded} steps found in your paper · ${care.stats.refused} held back because we couldn't show their words from your paper · " +
                String.format(Locale.US, "%.1f", care.stats.ms / 1000.0) + "s",
            style = Type.foot.copy(fontWeight = FontWeight.Bold),
        )
        // As on the website (CareSteps.tsx): warning signs pinned on top, then every other step in a time group read
        // from the paper's own words (StepsWhen), "Right away" first. Numbered and read in the order shown, so "step 3"
        // is the third card a person sees.
        val (warnings, groups) = StepsWhen.grouped(model.items, { model.checkFor(it) }, care.source_text)
        val items = warnings + groups.flatMap { it.items }
        // Pip: on the first step not done in the order shown, earliest group first; warning signs are never his spot.
        val pipOrder = groups.flatMap { it.items }.map { Pip.Step(it.id, it.kind) }
        val doneMap = model.done.toMap()
        val spot = Pip.spot(pipOrder, doneMap, { model.checkFor(it) }, cheering, Pip.greetAllowed(greetOver, doneMap))
        val drawn = Pip.drawn(spot)
        val pipText = spot.line?.let { Pip.line(model.language, it) } ?: ""
        val calm = pipCalm.calm
        // What Pip says is read once through a polite live region. Keyed on where he is too, so a second "Nice, that's
        // done" on another step is still read; cleared first so the repeated words are a fresh change.
        LaunchedEffect(Pip.announceKey(spot), pipText) { pipSaid = ""; delay(300); pipSaid = pipText }
        Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = pipSaid })
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
        // `warning`: a pinned warning sign, which has no Pip slot at all (Pip is never on or beside them).
        val card: @Composable (VerifiedItem, Boolean) -> Unit = { item, warning -> key(item.id) {
            val check = model.checkFor(item.id)
            val here = drawn.card?.takeIf { it.id == item.id }
            CareItemCard(
                item = item,
                check = check,
                result = if (model.meaning.status == MeaningStatus.done) model.meaning.byId[item.id] else null,
                checking = model.meaning.status == MeaningStatus.loading,
                errored = model.meaning.status == MeaningStatus.error,
                done = model.done[item.id] == true,
                onToggleDone = {
                    val v = model.done[item.id] != true
                    model.setDone(item.id, v)
                    // A done step gets Pip's short cheer (only a non-quiet one, Pip.spot decides) and ends the greeting.
                    cheering = if (v) item.id else null
                    if (v) greetOver = true
                },
                // A reminder never carries the AI's title; its "when" only when certified (bookSafe in paperFirst.ts).
                onRemind = { reminder = ReminderTarget(PaperFirst.bookTitle(item.kind), item.source_quote, PaperFirst.bookWhen(item, check)) },
                onRemove = { model.remove(item.id) },
                pipSlot = !warning, pip = here, pipText = if (here?.line != null) pipText else "", calm = calm,
            )
        } }
        if (warnings.isNotEmpty()) {
            StepGroupHeader("Warning signs from your paper", warnings.size,
                "If you have any of them right now, do what your paper says: call your clinic, or call 911.", warning = true)
            warnings.forEach { card(it, true) }
        }
        // Pip's heading spot: the first-view greeting, or every step done. Reserved either way, beside the Calm mode
        // switch, so nothing shifts when he comes or goes. Never beside the warning signs.
        if (pipOrder.isNotEmpty()) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CalmToggle(pipCalm)
                    PipSlot { drawn.heading?.let { mood -> key(Pip.announceKey(spot)) { PipMarker(mood, calm) } } }
                }
                if (drawn.heading != null && pipText.isNotEmpty()) PipBubble(pipText, pointDown = spot is Pip.Spot.Greet)
            }
        }
        groups.forEach { g ->
            StepGroupHeader(g.group.label, g.items.size, g.group.note)
            g.items.forEach { card(it, false) }
        }

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

/** A time group's heading (CareSteps.tsx): its label, how many steps, and its note when it has one. */
@Composable
fun StepGroupHeader(title: String, count: Int, note: String?, warning: Boolean = false) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp).semantics(mergeDescendants = true) { heading() },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Type.headline.copy(color = if (warning) Palette.red else Palette.ink), modifier = Modifier.weight(1f))
            Text("$count ${if (count == 1) "step" else "steps"}", style = Type.caption.copy(fontWeight = FontWeight.Bold))
        }
        note?.let { Text(it, style = Type.caption.copy(fontWeight = FontWeight.SemiBold, color = if (warning) Palette.red else Palette.inkSoft)) }
    }
}

@Composable
fun CareItemCard(item: VerifiedItem, check: Check, result: MeaningResult?, checking: Boolean, done: Boolean,
                 onToggleDone: () -> Unit, onRemind: () -> Unit, onRemove: () -> Unit, errored: Boolean = false,
                 // Pip's reserved spot on the trailing edge (every step card but a warning sign keeps it, so text never moves
                 // when he hops), Pip himself when he is on this card, what he says here, and calm mode.
                 pipSlot: Boolean = false, pip: Pip.Drawn.Card? = null, pipText: String = "", calm: Boolean = false) {
    val style = KindStyle.of(item.kind)
    // Styled as a warning exactly when it is pinned as one: the model's kind or the paper's own words.
    val warning = WarningPin.isWarning(item)
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
                // Not certified: the AI's question stays off the card; AskPersonBox below offers the paper's words instead.
                if (certified && item.needs_clarification && item.question_for_clinic.isNotEmpty()) {
                    Text(
                        "Ask your clinic: ${item.question_for_clinic}",
                        style = Type.sub.copy(color = Palette.peachDeep),
                        modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(12.dp)).padding(8.dp),
                    )
                }
                CheckStatus(result, checking, errored)
                PaperFirst.askPerson(item.kind, item.source_quote, check)?.let { AskPersonBox(it) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinePill("Remind me", onClick = onRemind, fill = Palette.mint, icon = Icons.Filled.Notifications,
                        contentDescription = "Remind me about $name")
                    Spacer(Modifier.weight(1f))
                    TextLink("Remove", onClick = onRemove, color = Palette.inkSoft,
                        modifier = Modifier.semantics { contentDescription = "Remove $name" })
                }
            }
            if (pipSlot) PipSlot { pip?.let { key("${it.id}:${it.mood}") { PipMarker(it.mood, calm) } } }
        }
        if (pip?.line != null && pipText.isNotEmpty()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { PipBubble(pipText) }
        }
    }
}

/** The second check's verdict for one step, in the same words as the website. */
@Composable
private fun CheckStatus(result: MeaningResult?, checking: Boolean, errored: Boolean = false) {
    when {
        checking -> Text("Double-checking this against your paper...", style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
        // The check failed: still "Checked once", as on the website (SEAL_TEXT.once, with no result to add to it).
        result == null && errored -> CheckedOnce(PaperFirst.CHECKED_ONCE)
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
        else -> CheckedOnce("${PaperFirst.CHECKED_ONCE} Our second check couldn't confirm this one.")
    }
}

/** Checked once: the long reason waits behind "Why?" (the website's details element). */
@Composable
private fun CheckedOnce(why: String) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TextLink(if (open) "Checked once · Hide why" else "Checked once · Why?", onClick = { open = !open }, color = Palette.inkSoft)
        if (open) Text(why, style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
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

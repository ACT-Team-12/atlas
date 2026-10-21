package com.stephensookra.atlas.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.PaperFirst
import com.stephensookra.atlas.data.Pip
import com.stephensookra.atlas.data.StepsWhen
import com.stephensookra.atlas.data.WalkThrough
import com.stephensookra.atlas.data.WarningPin
import com.stephensookra.atlas.services.Speaker
import kotlinx.coroutines.delay

/**
 * Where the walk-through is: a step (by id, so a check that lands and regroups the list never swaps the step under the
 * person) or the closing screen (`at` null). The order is fixed when the walk starts (`ids`): a late check can move a step
 * to another time group, and the walk must neither skip it nor show it twice.
 */
data class WalkState(val ids: List<String>, val at: String?)

/** Text tagged with a language, so TalkBack reads it in that voice (the paper's words around it keep their own). */
fun tagged(text: String, language: Language): AnnotatedString =
    AnnotatedString(text, SpanStyle(localeList = LocaleList(Speaker.code(language))))

/** SEAL_SHORT in web/src/lib/stepsView.ts. */
fun sealShort(check: Check): String = when (check) {
    Check.certified -> "Checked twice"
    Check.flagged -> "Double-check this"
    Check.unchecked -> "Checked once"
}

/**
 * "Walk me through it" (web/src/ui/CareSteps.tsx, WalkThrough and WalkCard): one step per screen, big type. The step's
 * own words follow the paper-first rule exactly as the list does (PaperFirstBlock). Done marks the step done the same way
 * the list's tick does; Not yet moves on and leaves it open; Ask a person opens the step's own "Ask your pharmacist /
 * clinic" help. Focus moves to the step's heading on every change, and Done or undo is said through a polite live
 * region. The system Back gesture goes back to the list.
 */
@Composable
fun WalkThroughScreen(
    model: AppModel,
    state: WalkState,
    onState: (WalkState?) -> Unit,
    spot: Pip.Spot,
    calm: Boolean,
    markDone: (String, Boolean) -> Unit,
) {
    val care = model.care ?: return
    val speaker = rememberSpeaker()
    val language = model.language
    fun t(line: WalkThrough.Line, values: Map<String, Int> = emptyMap()) = tagged(WalkThrough.line(language, line, values), language)
    val walk = WalkThrough.steps(model.items, { WarningPin.isWarning(it) }, { StepsWhen.step(it, model.checkFor(it.id), care.source_text).group })
    // The walk's own order, each step with its current group. A step removed meanwhile drops out.
    val seq = state.ids.mapNotNull { id -> walk.firstOrNull { it.it.id == id } }
    val index = state.at?.let { at -> seq.indexOfFirst { it.it.id == at } } ?: -1
    val step = seq.getOrNull(index)
    val shownPip = step?.let { WalkThrough.pip(spot, it.it.id, it.it.kind, model.checkFor(it.it.id), it.warning) }
    var said by remember { mutableStateOf("") }
    var saying by remember { mutableStateOf(0 to "") }
    LaunchedEffect(saying) { said = ""; delay(50); said = saying.second }
    var asking by remember(state.at) { mutableStateOf(false) }
    val heading = remember { FocusRequester() }
    val scroll = rememberScrollState()
    fun go(at: String?) { speaker.stop(); onState(state.copy(at = at)) }
    fun exit() { speaker.stop(); onState(null) }
    fun announce(line: WalkThrough.Line) { saying = (saying.first + 1) to WalkThrough.line(language, line) }

    BackHandler { exit() }
    // Each new step starts at the top, with focus on its heading. No animation.
    LaunchedEffect(state.at) {
        scroll.scrollTo(0)
        delay(50)
        runCatching { heading.requestFocus() }
    }
    // The step's check changed while it was read: the queued lines no longer match.
    val shownCheck = step?.let { model.checkFor(it.it.id) }
    LaunchedEffect(shownCheck) { speaker.stop() }
    // While walking, Pip speaks only about the step on screen, by the same quiet rules, politely.
    var pipSaid by remember { mutableStateOf("") }
    LaunchedEffect(state.at, shownPip?.mood) {
        pipSaid = ""
        delay(300)
        pipSaid = shownPip?.line?.let { Pip.line(language, it) } ?: ""
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(scroll).padding(16.dp).semantics { paneTitle = WalkThrough.line(language, WalkThrough.Line.region) },
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = said })
        Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = pipSaid })
        OutlinePillText("← ", t(WalkThrough.Line.back), onClick = { exit() })
        if (step != null) {
            val item = step.it
            val warn = step.warning
            val check = model.checkFor(item.id)
            val done = model.done[item.id] == true
            val style = KindStyle.of(item.kind)
            val next = seq.getOrNull(index + 1)?.it?.id
            Column(
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = if (warn) Modifier.fillMaxWidth().border(4.dp, Palette.red, RoundedCornerShape(18.dp)).padding(12.dp) else Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(
                        Modifier.weight(1f).focusRequester(heading).focusable().semantics(mergeDescendants = true) { heading() },
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(t(WalkThrough.Line.progress, mapOf("n" to index + 1, "total" to seq.size)),
                            style = Type.headline.copy(color = Palette.inkSoft))
                        val groupLabel = step.group?.label?.let { AnnotatedString(it) } ?: t(WalkThrough.Line.warningLabel)
                        Text(groupLabel, style = Type.screenTitle.copy(fontSize = 28.sp, lineHeight = 32.sp, color = if (warn) Palette.red else Palette.ink))
                    }
                    // Pip's reserved spot, as on a list card; never on a warning sign.
                    if (!warn) PipSlot { shownPip?.let { p -> key("walk:${item.id}:${p.mood}") { PipMarker(p.mood, calm) } } }
                }
                shownPip?.line?.let { l -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { PipBubble(Pip.line(language, l)) } }
                LinearProgressIndicator(
                    progress = { (index + 1f) / seq.size.coerceAtLeast(1) },
                    color = Palette.teal, trackColor = Palette.ink.copy(alpha = 0.1f),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "" },
                )
                step.group?.note?.let { Text(it, style = Type.body.copy(fontWeight = FontWeight.SemiBold, color = Palette.inkSoft)) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(style.label, style.background, style.foreground)
                    Text(sealShort(check), style = Type.sub.copy(color = if (check == Check.flagged) Palette.peachDeep else Palette.inkSoft))
                }
                // The paper's words, by the same rule as the list, only bigger.
                BigPaperFirst(PaperFirst.careStep(item, check))
                // After the paper's words, never before them: the paper says what to do; this line only points back to it.
                if (warn) Text(t(WalkThrough.Line.warningDo), style = Type.title3.copy(fontWeight = FontWeight.Bold, color = Palette.red),
                    modifier = Modifier.fillMaxWidth().background(Palette.redSoft, RoundedCornerShape(14.dp)).padding(12.dp))
                if (check == Check.certified) PaperFirst.stepVisitQuestion(item, check)?.let { q ->
                    Text("On your questions list: $q", style = Type.body.copy(fontWeight = FontWeight.SemiBold, color = Palette.peachDeep),
                        modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(14.dp)).padding(12.dp))
                }
                if (done) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(AnnotatedString("✓ ") + t(WalkThrough.Line.doneAlready), style = Type.title3.copy(color = Palette.tealDeep))
                        OutlinePillText("", t(WalkThrough.Line.undoDone), onClick = {
                            markDone(item.id, false)
                            announce(WalkThrough.Line.undoDone)
                            runCatching { heading.requestFocus() }
                        })
                    }
                }
                // Read aloud by the paper-first rule, in the steps' own language; not offered when that is unknown.
                model.stepsLanguage?.let { voice ->
                    val speaking by speaker.speaking.collectAsState()
                    val note by speaker.note.collectAsState()
                    if (speaking) OutlinePill(WalkThrough.line(language, WalkThrough.Line.stop), onClick = { speaker.stop() }, fill = Palette.peach, icon = Icons.Filled.Close)
                    else OutlinePill(WalkThrough.line(language, WalkThrough.Line.readAloud),
                        onClick = { speaker.speak(PaperFirst.lines(PaperFirst.careStep(item, check)), voice) }, icon = Icons.Filled.PlayArrow)
                    note?.let { n -> Text(n, style = Type.caption.copy(fontWeight = FontWeight.SemiBold)) }
                }
                BigButton(AnnotatedString("✓ ") + t(WalkThrough.Line.done), Palette.teal, Palette.paper) {
                    markDone(item.id, true)
                    announce(WalkThrough.Line.doneAlready)
                    go(next)
                }
                BigButton(t(WalkThrough.Line.notYet) + AnnotatedString(" →"), Palette.paper) { go(next) }
                BigButton(t(WalkThrough.Line.askPerson), Palette.sun) { asking = !asking }
                if (asking) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth().border(2.dp, Palette.ink.copy(alpha = 0.4f), RoundedCornerShape(14.dp)).padding(12.dp),
                    ) {
                        Text(t(WalkThrough.Line.askTitle), style = Type.headline)
                        if (warn) {
                            Text(t(WalkThrough.Line.warningDo), style = Type.body.copy(fontWeight = FontWeight.Bold, color = Palette.red))
                        } else {
                            val ask = PaperFirst.askPerson(item.kind, item.source_quote, check)
                            if (ask != null) AskPersonBody(ask) else Text(t(WalkThrough.Line.askClinicCall), style = Type.body.copy(fontWeight = FontWeight.SemiBold))
                            Text(t(WalkThrough.Line.ask211), style = Type.sub.copy(color = Palette.inkSoft))
                        }
                    }
                }
                if (index > 0) TextLink("← " + WalkThrough.line(language, WalkThrough.Line.previous), onClick = { go(seq[index - 1].it.id) }, color = Palette.ink)
            }
        } else {
            val ids = seq.map { it.it.id }
            val doneCount = ids.count { model.done[it] == true }
            val firstOpen = WalkThrough.nextOpen(ids, model.done.toMap(), 0)
            Text(t(WalkThrough.Line.finished), style = Type.screenTitle,
                modifier = Modifier.focusRequester(heading).focusable().semantics { heading() })
            Text(t(WalkThrough.Line.finishedCount, mapOf("done" to doneCount, "total" to seq.size)), style = Type.title3)
            if (firstOpen >= 0) BigButton(t(WalkThrough.Line.startOver), Palette.sun) { go(ids[firstOpen]) }
            BigButton(t(WalkThrough.Line.back), Palette.teal, Palette.paper) { exit() }
        }
    }
}

/** The walk-through's big buttons: at least 56dp tall, full width, ink border. */
@Composable
private fun BigButton(text: AnnotatedString, fill: Color, textColor: Color = Palette.ink, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Box(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).background(fill, shape).border(2.5.dp, Palette.ink, shape)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Type.title3.copy(color = textColor), textAlign = TextAlign.Center)
    }
}

/** An outlined pill whose label may carry a language tag. */
@Composable
private fun OutlinePillText(prefix: String, text: AnnotatedString, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier.heightIn(min = 48.dp).background(Palette.paper, shape).border(2.dp, Palette.ink, shape)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(AnnotatedString(prefix) + text, style = Type.sub.copy(fontWeight = FontWeight.Bold))
    }
}

/** PaperFirstBlock in big type. */
@Composable
private fun BigPaperFirst(v: PaperFirst.View) {
    if (v.quote.isEmpty()) return
    val big = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, color = Palette.ink)
    if (v.explanationLeads) {
        v.explanation?.let { Text(it, style = big) }
        Text("From your paper: “${v.quote}”", style = big.copy(fontSize = 19.sp, lineHeight = 25.sp, color = Palette.ink.copy(alpha = 0.8f)),
            modifier = Modifier.fillMaxWidth().sunRule())
        return
    }
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxWidth().sunRule().semantics(mergeDescendants = true) { contentDescription = "${v.screenLabel}: ${v.quote}" },
    ) {
        Text(v.screenLabel.uppercase(), style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.teal))
        Text("“${v.quote}”", style = big.copy(fontWeight = FontWeight.SemiBold))
    }
    v.explanation?.let { e ->
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            v.note?.let { Text(it, style = Type.sub.copy(fontWeight = FontWeight.Bold, color = Palette.inkSoft)) }
            Text(e, style = big.copy(fontSize = 19.sp, lineHeight = 25.sp, color = Palette.inkSoft))
        }
    }
}

/** What "Ask your pharmacist" / "Ask your clinic" shows: who to show it to, the paper-words question, and copy. */
@Composable
fun AskPersonBody(ask: PaperFirst.AskPerson) {
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            if (ask.who == "pharmacist") "Show or read this to your pharmacist. It uses only your paper's words."
            else "Show or read this to your clinic. It uses only your paper's words.",
            style = Type.sub.copy(color = Palette.inkSoft),
        )
        Text(ask.question, style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        OutlinePill(if (copied) "Copied" else "Copy question", onClick = { clipboard.setText(AnnotatedString(ask.question)); copied = true })
    }
}

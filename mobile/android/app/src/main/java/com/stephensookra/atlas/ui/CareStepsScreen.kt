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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.Route
import com.stephensookra.atlas.data.ItemKind
import com.stephensookra.atlas.data.Language
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
        if (care.has_warning_signs) WarningBanner()
        Text(
            "${care.stats.grounded} steps found in your paper · ${care.stats.refused} held back because we couldn't find the words · " +
                String.format(Locale.US, "%.1f", care.stats.ms / 1000.0) + "s",
            style = Type.foot.copy(fontWeight = FontWeight.Bold),
        )
        val items = model.items
        ReadAloudBar(speaker, model.language, items.mapIndexed { i, it -> "${i + 1}. ${it.title}. ${it.plain_language}" })

        items.forEach { item ->
            CareItemCard(
                item = item,
                done = model.done[item.id] == true,
                onToggleDone = { model.setDone(item.id, model.done[item.id] != true) },
                onRemind = { reminder = ReminderTarget(item.title, item.source_quote) },
                onRemove = { model.remove(item.id) },
            )
        }

        val removed = model.removedItems
        if (removed.isNotEmpty()) {
            AtlasCard(border = Palette.ink.copy(alpha = 0.3f)) {
                Text("You removed ${removed.size}", style = Type.headline)
                removed.forEach { r ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(r.title, style = Type.sub.copy(fontWeight = FontWeight.Normal), modifier = Modifier.weight(1f))
                        TextLink("Undo", onClick = { model.undoRemove(r.id) },
                            modifier = Modifier.semantics { contentDescription = "Undo removing ${r.title}" })
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

        PillButton("Next: what gets in the way?", onClick = { speaker.stop(); model.push(Route.Barriers) },
            fill = Palette.ink, textColor = Palette.paper, shadow = Palette.mint)
    }
    reminder?.let { ReminderDialog(it) { reminder = null } }
}

@Composable
fun CareItemCard(item: VerifiedItem, done: Boolean, onToggleDone: () -> Unit, onRemind: () -> Unit, onRemove: () -> Unit) {
    val style = KindStyle.of(item.kind)
    val warning = item.itemKind == ItemKind.warning_sign
    AtlasCard(
        background = if (warning) Palette.redSoft.copy(alpha = 0.6f) else Palette.paper,
        border = if (warning) Palette.red else Palette.ink.copy(alpha = 0.75f),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(
                onClick = onToggleDone,
                modifier = Modifier.semantics {
                    contentDescription = if (done) "Done: ${item.title}" else "Mark ${item.title} done"
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
                    if (item.`when`.isNotEmpty()) Text(item.`when`, style = Type.caption)
                }
                Text(item.title, style = Type.headline.copy(textDecoration = if (done) TextDecoration.LineThrough else null))
                Text(item.plain_language, style = Type.body)
                if (item.needs_clarification && item.question_for_clinic.isNotEmpty()) {
                    Text(
                        "Ask your clinic: ${item.question_for_clinic}",
                        style = Type.sub.copy(color = Palette.peachDeep),
                        modifier = Modifier.fillMaxWidth().background(Palette.peach, RoundedCornerShape(12.dp)).padding(8.dp),
                    )
                }
                PaperQuote(item.source_quote)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinePill("Remind me", onClick = onRemind, fill = Palette.mint, icon = Icons.Filled.Notifications,
                        contentDescription = "Remind me about ${item.title}")
                    Spacer(Modifier.weight(1f))
                    TextLink("Remove", onClick = onRemove, color = Palette.inkSoft,
                        modifier = Modifier.semantics { contentDescription = "Remove ${item.title}" })
                }
            }
        }
    }
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

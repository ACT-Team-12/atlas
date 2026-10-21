package com.stephensookra.atlas.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.data.MedicineChanges
import com.stephensookra.atlas.data.VerifiedItem

private data class RowLook(val mark: String, val border: Color, val fill: Color, val text: Color)

private fun look(row: MedicineChanges.Row): RowLook = when (row) {
    MedicineChanges.Row.stop -> RowLook("✕", Palette.red, Palette.redSoft, Palette.red)
    MedicineChanges.Row.change -> RowLook("↻", Palette.peachDeep, Palette.peach, Palette.peachDeep)
    MedicineChanges.Row.start -> RowLook("+", Palette.teal, Palette.mintSoft, Palette.tealDeep)
    MedicineChanges.Row.keep -> RowLook("=", Palette.ink.copy(alpha = 0.4f), Palette.paper, Palette.ink)
    MedicineChanges.Row.ask -> RowLook("?", Palette.ink.copy(alpha = 0.4f), Palette.paper, Palette.ink)
}

/** ROW_NOTE in web/src/ui/MedicineChanges.tsx. */
const val MEDICINE_ASK_NOTE = "Your paper's words don't say clearly whether to stop, change, start or keep these. Ask your pharmacist before you change anything."

/**
 * "Your medicine changes" (web/src/ui/MedicineChanges.tsx): every medicine step sorted into Stop, Change, Start (and
 * Keep taking, only when the paper says to continue), Stop first. Each line shows the paper's own words, never the AI's.
 * A Change line shows an old and a new dose only when both are written in the paper's line; the strike-through is also
 * said in words ("was 10 mg, now 20 mg"). Each line goes to its step in the list below. No Pip here.
 */
@Composable
fun MedicineChangesCard(items: List<VerifiedItem>, paper: String, onGo: (String) -> Unit) {
    val groups = MedicineChanges.groups(items, paper)
    if (groups.isEmpty()) return
    AtlasCard {
        Text("Your medicine changes", style = Type.title3, modifier = Modifier.semantics { heading() })
        Text("Sorted by your paper's own words. Stop comes first: it is the easiest one to miss.", style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
        groups.forEach { (row, list) ->
            val l = look(row)
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().background(l.fill, RoundedCornerShape(14.dp)).border(2.dp, l.border, RoundedCornerShape(14.dp)).padding(10.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.semantics(mergeDescendants = true) { heading() },
                ) {
                    Box(Modifier.size(26.dp).border(2.dp, l.text, CircleShape).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
                        Text(l.mark, style = Type.sub.copy(color = l.text, fontWeight = FontWeight.ExtraBold))
                    }
                    Text(row.label, style = Type.headline.copy(color = l.text))
                    Text("(${list.size} ${if (list.size == 1) "medicine" else "medicines"})", style = Type.caption.copy(color = l.text))
                }
                if (row == MedicineChanges.Row.ask) Text(MEDICINE_ASK_NOTE, style = Type.caption.copy(fontWeight = FontWeight.SemiBold, color = l.text))
                list.forEach { c -> MedicineLine(c, onGo) }
            }
        }
    }
}

@Composable
private fun MedicineLine(c: MedicineChanges.Change, onGo: (String) -> Unit) {
    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().background(Palette.paper, RoundedCornerShape(10.dp)).padding(10.dp),
    ) {
        c.name?.let { Text(it, style = Type.headline) }
        c.dose?.let { d ->
            // The strike-through is never the only signal: the words "was" and "now" say it, on screen and aloud.
            Text(
                buildAnnotatedString {
                    append("Dose on your paper: was ")
                    withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(d.was) }
                    append(", now ")
                    withStyle(SpanStyle(fontWeight = FontWeight.ExtraBold)) { append(d.now) }
                },
                style = Type.sub,
                modifier = Modifier.semantics { contentDescription = "Dose on your paper: ${MedicineChanges.doseWords(d)}" },
            )
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.fillMaxWidth().sunRule().semantics(mergeDescendants = true) { contentDescription = "Copied word for word from your paper: ${c.quote}" },
        ) {
            Text("COPIED WORD FOR WORD FROM YOUR PAPER", style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.teal))
            Text("“${c.quote}”", style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        }
        TextLink("Go to this step", onClick = { onGo(c.id) }, color = Palette.ink,
            modifier = Modifier.semantics { contentDescription = "Go to this step: ${c.quote.take(50)}" })
    }
}

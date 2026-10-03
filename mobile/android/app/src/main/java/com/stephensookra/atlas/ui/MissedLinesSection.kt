package com.stephensookra.atlas.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.data.MissedLines
import com.stephensookra.atlas.data.MissedLinesView
import kotlinx.coroutines.delay

/**
 * "Lines on your paper we didn't turn into steps" (web/src/ui/MissedLines.tsx): instruction-like sentences no kept step
 * quotes, collapsed behind one heading. Shows nothing when the server could not check the paper (or sent no check), so
 * it never claims "all covered" for a paper it could not read.
 */
@Composable
fun MissedLinesSection(view: MissedLinesView) {
    // A polite live region speaks when its text CHANGES, so it is always present and the message lands a moment later,
    // and it speaks again when a removed or restored step changes the count (same 400 ms as the website).
    val message = MissedLines.announcement(view)
    var spoken by remember { mutableStateOf("") }
    LaunchedEffect(message) {
        delay(400)
        spoken = message
    }
    Text(
        spoken,
        style = Type.caption,
        modifier = Modifier.height(1.dp).alpha(0f).clearAndSetSemantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = spoken
        },
    )

    if (view !is MissedLinesView.Shown) return
    val n = view.lines.size
    if (n == 0) {
        AtlasCard(background = Palette.mintSoft, border = Palette.ink.copy(alpha = 0.7f)) {
            Text("✓ ${MissedLines.ALL_IN_A_STEP}", style = Type.headline,
                modifier = Modifier.semantics { contentDescription = MissedLines.ALL_IN_A_STEP })
            Text(MissedLines.ALL_IN_A_STEP_NOTE, style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
        }
        return
    }

    var open by remember { mutableStateOf(false) }
    val badge = MissedLines.lineCountLabel(n)
    AtlasCard(border = Palette.ink.copy(alpha = 0.7f)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = if (open) "Hide the lines" else "Show the lines") { open = !open }
                .semantics(mergeDescendants = true) {
                    heading()
                    stateDescription = if (open) "Expanded" else "Collapsed"
                    contentDescription = "${MissedLines.TITLE}, $badge"
                },
        ) {
            Text(MissedLines.TITLE, style = Type.headline, modifier = Modifier.weight(1f))
            Text(
                badge,
                style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.ink),
                modifier = Modifier
                    .background(Palette.sun, RoundedCornerShape(50))
                    .border(2.dp, Palette.ink, RoundedCornerShape(50))
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null)
        }
        if (open) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(MissedLines.READ_THESE, style = Type.sub)
                view.lines.forEach { line ->
                    Text(
                        "“${line.text}”",
                        style = Type.sub.copy(fontWeight = FontWeight.Normal),
                        modifier = Modifier.fillMaxWidth().sunRule().padding(start = 4.dp),
                    )
                }
                Text(MissedLines.CAN_MISS, style = Type.caption.copy(fontWeight = FontWeight.SemiBold))
            }
        }
    }
}

package com.stephensookra.atlas.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.TextSource
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.Sample

/** "Check the text": the only text ever sent to ATLAS is what the person confirms here. */
@Composable
fun CheckTextScreen(model: AppModel) {
    val focus = LocalFocusManager.current
    val sourceNote = when (model.textSource) {
        TextSource.Scan, TextSource.Photo -> "We read this on your phone. The photo was not sent anywhere."
        TextSource.Sample -> Sample.LABEL
        TextSource.Typed -> "Paste or type the words from your after-visit summary."
    }
    ScreenBody {
        ScreenTitle("Check the text", sourceNote)
        Text(
            "Every step has to quote this text word for word. If a word or number is wrong, fix it here. Only this text is sent to ATLAS.",
            style = Type.sub.copy(color = Palette.inkSoft),
        )

        val shape = RoundedCornerShape(18.dp)
        Box(
            Modifier
                .fillMaxWidth()
                .height(320.dp)
                .background(Palette.paper, shape)
                .border(2.dp, Palette.ink.copy(alpha = 0.7f), shape)
                .padding(14.dp),
        ) {
            BasicTextField(
                value = model.text,
                onValueChange = { model.updateText(it) },
                textStyle = Type.body.copy(fontSize = 16.sp),
                cursorBrush = SolidColor(Palette.teal),
                modifier = Modifier.fillMaxWidth().height(292.dp).semantics { contentDescription = "After-visit summary text" },
            )
            if (model.text.isEmpty()) {
                Text("Paste the after-visit summary here...", style = Type.body.copy(color = Palette.inkSoft.copy(alpha = 0.6f)))
            }
        }

        AtlasCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Explain it in", style = Type.sub.copy(fontWeight = FontWeight.Bold))
                Spacer(Modifier.weight(1f))
                LanguagePicker(model.language) { model.updateLanguage(it) }
            }
            Text("Reading level", style = Type.sub.copy(fontWeight = FontWeight.Bold))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                ReadingLevel.entries.forEachIndexed { i, lvl ->
                    SegmentedButton(
                        selected = model.level == lvl,
                        onClick = { model.updateLevel(lvl) },
                        shape = SegmentedButtonDefaults.itemShape(i, ReadingLevel.entries.size),
                        colors = SegmentedButtonDefaults.colors(
                            activeContainerColor = Palette.mint, activeContentColor = Palette.ink,
                            inactiveContainerColor = Palette.paper, inactiveContentColor = Palette.ink,
                            activeBorderColor = Palette.ink, inactiveBorderColor = Palette.ink,
                        ),
                    ) { Text(lvl.name.replaceFirstChar { it.uppercase() }) }
                }
            }
        }

        PillButton("Read my paper", onClick = { focus.clearFocus(); model.readPaper() }, enabled = model.canRead)
        if (model.text.trim().length <= 20) {
            Text("Add a few lines from your paper first.", style = Type.foot)
        }
    }
}

@Composable
fun LanguagePicker(selected: Language, onPick: (Language) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinePill("${selected.name} ▾", onClick = { open = true }, contentDescription = "Explain it in ${selected.name}. Change language")
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Palette.paper) {
            Language.entries.forEach { lang ->
                DropdownMenuItem(text = { Text(lang.name) }, onClick = { open = false; onPick(lang) })
            }
        }
    }
}

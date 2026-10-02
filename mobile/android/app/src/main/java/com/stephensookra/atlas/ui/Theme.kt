package com.stephensookra.atlas.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stephensookra.atlas.data.ItemKind

/** Palette from web/src/app/globals.css. Red is used for warning signs only. */
object Palette {
    val paper = Color(0xFFFBF8F3)
    val ink = Color(0xFF102A43)
    val inkSoft = Color(0xFF334E68)
    val teal = Color(0xFF0B7A75)
    val tealDeep = Color(0xFF075E5A)
    val mint = Color(0xFFBFE9DC)
    val mintSoft = Color(0xFFE6F6F0)
    val sky = Color(0xFFD6E9F8)
    val skyDeep = Color(0xFF1D5FA8)
    val peach = Color(0xFFFFE0C2)
    val peachDeep = Color(0xFFB85A0E)
    val sun = Color(0xFFFFC94D)
    val red = Color(0xFFD64545)
    val redSoft = Color(0xFFFBE3E3)
    val lilac = Color(0xFFE6DEFA)
}

const val MEDICAL_NOTE = "ATLAS explains your paper. It is not medical advice. Check with your doctor or clinic before changing anything."
const val PRIVACY_URL = "https://atlas-team12.vercel.app/privacy"
const val WEBSITE_URL = "https://atlas-team12.vercel.app"

@Composable
fun AtlasTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Palette.teal,
            onPrimary = Palette.paper,
            secondary = Palette.tealDeep,
            background = Palette.mintSoft,
            onBackground = Palette.ink,
            surface = Palette.paper,
            onSurface = Palette.ink,
            surfaceVariant = Palette.mintSoft,
            onSurfaceVariant = Palette.inkSoft,
            outline = Palette.ink,
            error = Palette.red,
            primaryContainer = Palette.mint,
            onPrimaryContainer = Palette.ink,
            secondaryContainer = Palette.mint,
            onSecondaryContainer = Palette.ink,
        ),
        content = content,
    )
}

object Type {
    val screenTitle = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 32.sp, lineHeight = 36.sp, color = Palette.ink)
    val title3 = TextStyle(fontWeight = FontWeight.Black, fontSize = 21.sp, lineHeight = 26.sp, color = Palette.ink)
    val headline = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, lineHeight = 22.sp, color = Palette.ink)
    val body = TextStyle(fontWeight = FontWeight.Normal, fontSize = 17.sp, lineHeight = 23.sp, color = Palette.ink)
    val sub = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp, color = Palette.ink)
    val foot = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp, color = Palette.inkSoft)
    val caption = TextStyle(fontWeight = FontWeight.Bold, fontSize = 12.sp, lineHeight = 16.sp, color = Palette.inkSoft)
}

/** Kind chips, same labels and colors as the KIND map in web/src/ui/CarePlanTool.tsx. */
data class KindStyle(val label: String, val background: Color, val foreground: Color) {
    companion object {
        fun of(kind: String): KindStyle = when (ItemKind.of(kind)) {
            ItemKind.medication -> KindStyle("Medicine", Palette.sky, Palette.skyDeep)
            ItemKind.lab_test -> KindStyle("Lab test", Palette.lilac, Palette.ink)
            ItemKind.referral -> KindStyle("Referral", Palette.peach, Palette.peachDeep)
            ItemKind.follow_up_visit -> KindStyle("Next visit", Palette.mint, Palette.tealDeep)
            ItemKind.self_care -> KindStyle("Daily care", Palette.mintSoft, Palette.tealDeep)
            ItemKind.warning_sign -> KindStyle("Warning sign", Palette.redSoft, Palette.red)
            null -> KindStyle("Step", Palette.mintSoft, Palette.ink)
        }
    }
}

// ---------- Building blocks ----------

@Composable
fun AtlasCard(
    modifier: Modifier = Modifier,
    background: Color = Palette.paper,
    border: Color = Palette.ink,
    lineWidth: Dp = 2.5.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier
            .fillMaxWidth()
            .background(background, shape)
            .border(lineWidth, border, shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
fun Chip(text: String, background: Color = Palette.mint, foreground: Color = Palette.tealDeep) {
    Text(
        text,
        style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = foreground),
        modifier = Modifier.background(background, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** Chunky pill button with an ink border and a hard shadow, like the web SquashButton. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    fill: Color = Palette.teal,
    textColor: Color = Palette.paper,
    shadow: Color = Palette.ink,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val shape = RoundedCornerShape(50)
    Box(
        modifier
            .fillMaxWidth()
            .padding(bottom = 4.dp)
            .alpha(if (enabled) 1f else 0.45f),
    ) {
        Box(Modifier.matchParentSize().offset(y = if (pressed) 1.dp else 4.dp).background(shadow, shape))
        Row(
            Modifier
                .fillMaxWidth()
                .offset(y = if (pressed) 3.dp else 0.dp)
                .heightIn(min = 52.dp)
                .background(fill, shape)
                .border(2.5.dp, Palette.ink, shape)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = 22.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = textColor, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, style = Type.headline.copy(color = textColor), textAlign = TextAlign.Center)
        }
    }
}

/** Smaller outlined pill for secondary actions. */
@Composable
fun OutlinePill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    fill: Color = Palette.paper,
    textColor: Color = Palette.ink,
    icon: ImageVector? = null,
    contentDescription: String? = null,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val shape = RoundedCornerShape(50)
    Row(
        modifier
            .heightIn(min = 44.dp)
            .background(if (pressed) Palette.mint else fill, shape)
            .border(2.dp, Palette.ink, shape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .then(if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = textColor, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = Type.sub.copy(fontWeight = FontWeight.Bold, color = textColor))
    }
}

/** Plain text link-style button. */
@Composable
fun TextLink(text: String, onClick: () -> Unit, color: Color = Palette.tealDeep, modifier: Modifier = Modifier) {
    Text(
        text,
        style = Type.foot.copy(fontWeight = FontWeight.Bold, color = color),
        modifier = modifier
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 44.dp)
            .padding(vertical = 12.dp),
    )
}

/** Sun-yellow rule on the left, sized to the content (used for quotes). */
fun Modifier.sunRule(): Modifier = this
    .drawBehind { drawRect(Palette.sun, size = Size(4.dp.toPx(), size.height)) }
    .padding(start = 12.dp)

/** "From your paper" quote block. */
@Composable
fun PaperQuote(quote: String) {
    Text(
        "From your paper: “$quote”",
        style = Type.foot.copy(fontStyle = FontStyle.Italic, fontWeight = FontWeight.Normal, color = Palette.ink.copy(alpha = 0.75f)),
        modifier = Modifier
            .fillMaxWidth()
            .sunRule()
            .clearAndSetSemantics { contentDescription = "From your paper, quote: $quote" },
    )
}

/** Required on Home, Plan and About. */
@Composable
fun MedicalNote() {
    Text(MEDICAL_NOTE, style = Type.foot)
}

@Composable
fun WarningBanner() {
    AtlasCard(background = Palette.redSoft, border = Palette.red, modifier = Modifier.semantics { heading() }) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Palette.red)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Your paper lists warning signs (marked red).", style = Type.headline.copy(color = Palette.red))
                Text(
                    "If you have any of them right now, do what your paper says: call your clinic, or call 911.",
                    style = Type.sub.copy(color = Palette.red),
                )
            }
        }
    }
}

@Composable
fun ScreenTitle(title: String, note: String? = null) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = Type.screenTitle, modifier = Modifier.semantics { heading() })
        if (note != null) Text(note, style = Type.sub.copy(color = Palette.tealDeep, fontSize = 16.sp))
    }
}

/** The ATLAS mark from web/src/ui/Mark.tsx: teal rounded square, folded paper, check. */
@Composable
fun AppMark(size: Dp = 40.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.width / 64f
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        drawRoundRect(Palette.teal, topLeft = p(2f, 2f), size = Size(60 * s, 60 * s), cornerRadius = CornerRadius(18 * s))
        val paper = Path().apply {
            moveTo(20 * s, 14 * s); lineTo(37 * s, 14 * s); lineTo(46 * s, 23 * s); lineTo(46 * s, 50 * s)
            quadraticTo(46 * s, 53 * s, 43 * s, 53 * s); lineTo(20 * s, 53 * s)
            quadraticTo(17 * s, 53 * s, 17 * s, 50 * s); lineTo(17 * s, 17 * s)
            quadraticTo(17 * s, 14 * s, 20 * s, 14 * s); close()
        }
        drawPath(paper, Palette.paper)
        val fold = Path().apply { moveTo(37 * s, 14 * s); lineTo(37 * s, 23 * s); lineTo(46 * s, 23 * s); close() }
        drawPath(fold, Palette.mint)
        val check = Path().apply { moveTo(23.5f * s, 37.5f * s); lineTo(29 * s, 43 * s); lineTo(40 * s, 31 * s) }
        drawPath(check, Palette.teal, style = Stroke(width = 4.5f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable
fun Gap(h: Dp) = Spacer(Modifier.height(h))

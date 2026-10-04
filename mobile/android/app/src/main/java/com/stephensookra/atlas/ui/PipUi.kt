package com.stephensookra.atlas.ui

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.data.Pip

/**
 * Pip drawn natively from Akhil's rig (video/assets/pip-rig.svg, the same geometry as web/src/ui/Pip.tsx): the path data
 * below is the rig's, word for word, in its own viewBox (-12 -12 88 92). Faces: normal and happy (a quiet Pip is the
 * normal face, still). Accessory: the flag, for the cheer. The app is light only, so these are the rig's light colors.
 * Hidden from TalkBack: what Pip says is announced by the steps screen, once, politely.
 */
object PipRig {
    const val VB_X = -12f
    const val VB_Y = -12f
    const val VB_W = 88f
    const val VB_H = 92f

    // Colors from the rig (video/DECISIONS.md "Pip art: RECEIVED").
    val ink = Color(0xFF14283A)
    val pin = Color(0xFFFFA47E)
    val pin2 = Color(0xFFF0606A)
    val deep = Color(0xFFD2543F)
    val leaf = Color(0xFF3F9A52)
    val go = Color(0xFF24895D)
    val face = Color(0xFFFFFDF7)
    val cheek = Color(0xFFF58C7A)

    const val BODY = "M32 78 C26 66 6 50 6 30 A26 26 0 0 1 58 30 C58 50 38 66 32 78 Z"
    const val CREASE = "M32 5 C25 12 24 20 26 24"
    const val STEM = "M32 5 L33 -2"
    const val LEAF = "M33 -1 C38 -9 48 -9 52 -5 C46 1 38 2 33 -1 Z"
    const val SHINE = "M14 22 A20 20 0 0 1 26 10"
    const val FLAG_POLE = "M56 36 L56 4"
    const val FLAG = "M56 5 L74 11 L56 17 Z"
    const val EYES_HAPPY = "M23 28 q3 -4 6 0 M35 28 q3 -4 6 0"
    const val MOUTH = "M27 34 q5 4.5 10 0"

    fun path(d: String): Path = PathParser().parsePathString(d).toPath()
}

/** The drawing itself, scaled to fit and centered. `eyes`: vertical scale of the eyes for the blink (1 open). */
@Composable
fun PipArt(happy: Boolean, flag: Boolean, eyes: Float, modifier: Modifier = Modifier) {
    val paths = remember {
        mapOf(
            "body" to PipRig.path(PipRig.BODY), "crease" to PipRig.path(PipRig.CREASE), "stem" to PipRig.path(PipRig.STEM),
            "leaf" to PipRig.path(PipRig.LEAF), "shine" to PipRig.path(PipRig.SHINE), "pole" to PipRig.path(PipRig.FLAG_POLE),
            "flag" to PipRig.path(PipRig.FLAG), "happy" to PipRig.path(PipRig.EYES_HAPPY), "mouth" to PipRig.path(PipRig.MOUTH),
        )
    }
    Canvas(modifier.clearAndSetSemantics {}) {
        val s = minOf(size.width / PipRig.VB_W, size.height / PipRig.VB_H)
        translate((size.width - PipRig.VB_W * s) / 2, (size.height - PipRig.VB_H * s) / 2) {
            scale(s, s, pivot = Offset.Zero) {
                translate(-PipRig.VB_X, -PipRig.VB_Y) { drawPip(paths, happy, flag, eyes) }
            }
        }
    }
}

private fun roundStroke(w: Float) = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round)

private fun DrawScope.drawPip(p: Map<String, Path>, happy: Boolean, flag: Boolean, eyes: Float) {
    val ink = PipRig.ink
    if (flag) {
        drawPath(p.getValue("pole"), ink, style = roundStroke(2.5f))
        drawPath(p.getValue("flag"), PipRig.go)
        drawPath(p.getValue("flag"), ink, style = Stroke(1.5f))
    }
    val body = p.getValue("body")
    val box = body.getBounds()
    drawPath(body, Brush.linearGradient(listOf(PipRig.pin, PipRig.pin2), start = Offset(box.left, box.top), end = Offset(box.right, box.bottom)))
    drawPath(body, ink, style = Stroke(2.5f, join = StrokeJoin.Round))
    drawPath(p.getValue("crease"), PipRig.deep.copy(alpha = 0.55f), style = roundStroke(2f))
    drawPath(p.getValue("stem"), ink, style = roundStroke(2.5f))
    drawPath(p.getValue("leaf"), PipRig.leaf)
    drawPath(p.getValue("leaf"), ink, style = Stroke(1.8f, join = StrokeJoin.Round))
    drawPath(p.getValue("shine"), Color.White.copy(alpha = 0.55f), style = roundStroke(3f))
    drawCircle(PipRig.face, radius = 16f, center = Offset(32f, 30f))
    drawCircle(ink, radius = 16f, center = Offset(32f, 30f), style = Stroke(2f))
    // Eyes: the blink scales them around their center, as the website's keyframes do.
    scale(1f, eyes, pivot = Offset(32f, 28f)) {
        if (happy) drawPath(p.getValue("happy"), ink, style = roundStroke(2.2f))
        else {
            drawCircle(ink, radius = 2.7f, center = Offset(26f, 27f))
            drawCircle(ink, radius = 2.7f, center = Offset(38f, 27f))
        }
    }
    drawCircle(PipRig.cheek.copy(alpha = 0.55f), radius = 2.6f, center = Offset(21f, 33f))
    drawCircle(PipRig.cheek.copy(alpha = 0.55f), radius = 2.6f, center = Offset(43f, 33f))
    drawPath(p.getValue("mouth"), ink, style = roundStroke(2.2f))
}

/** The rig's blink over 4.2 s (Akhil's keyframes): open at 0% and 94%, shut to 0.1 at 97%, open again at 100%. */
@Composable
private fun blinkScale(): Float {
    val t = rememberInfiniteTransition(label = "pip-blink")
    val v by t.animateFloat(
        initialValue = 1f, targetValue = 1f, label = "pip-eyes",
        animationSpec = infiniteRepeatable(keyframes {
            durationMillis = 4200
            1f at 0
            1f at 3948
            0.1f at 4074
            1f at 4200
        }),
    )
    return v
}

/**
 * Pip in place, with his mood: arrive hops in, cheer bounces with the happy face and the flag, quiet never moves. Calm mode
 * fades instead and stops the blink. Wrap it in `key(...)` per spot so each arrival plays once.
 */
@Composable
fun PipMarker(mood: Pip.Mood, calm: Boolean) {
    val motion = Pip.motion(mood, calm)
    val blinks = Pip.blinks(mood, calm)
    val shown = remember { Animatable(if (motion == Pip.Motion.Still) 1f else 0f) }
    LaunchedEffect(motion) {
        when (motion) {
            Pip.Motion.Still -> shown.snapTo(1f)
            Pip.Motion.Fade -> shown.animateTo(1f, tween(400))
            Pip.Motion.Hop -> shown.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow))
            Pip.Motion.Bounce -> shown.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMedium))
        }
    }
    val lift = with(LocalDensity.current) { 14.dp.toPx() }
    val eyes = if (blinks) blinkScale() else 1f
    PipArt(
        happy = mood == Pip.Mood.cheer, flag = mood == Pip.Mood.cheer, eyes = eyes,
        modifier = Modifier.fillMaxSize().graphicsLayer {
            val v = shown.value
            alpha = if (motion == Pip.Motion.Fade || motion == Pip.Motion.Hop) v.coerceIn(0f, 1f) else 1f
            translationY = if (motion == Pip.Motion.Hop) (1f - v) * -lift else 0f
            val sc = if (motion == Pip.Motion.Bounce) 0.82f + 0.18f * v else 1f
            scaleX = sc; scaleY = sc
            transformOrigin = TransformOrigin(0.5f, 1f)
        },
    )
}

/** The reserved spot on a card's trailing edge. Always takes its space, so text never moves when Pip comes or goes. */
@Composable
fun PipSlot(content: @Composable () -> Unit = {}) {
    Box(Modifier.size(width = 44.dp, height = 48.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) { content() }
}

/** What Pip says, as a small bubble. Hidden from TalkBack: the screen's polite live region reads the same words once. */
@Composable
fun PipBubble(text: String, pointDown: Boolean = false) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clearAndSetSemantics {}) {
        Text(
            text,
            style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.ink),
            modifier = Modifier
                .background(Palette.paper, RoundedCornerShape(50))
                .border(2.dp, Palette.ink, RoundedCornerShape(50))
                .padding(horizontal = 10.dp, vertical = 5.dp),
        )
        if (pointDown) {
            Canvas(Modifier.size(width = 12.dp, height = 7.dp)) {
                drawPath(Path().apply { moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2, size.height); close() }, Palette.ink)
            }
        }
    }
}

/** Calm mode state: the system's "Remove animations", or the person's own toggle saved on this phone. */
class PipCalm(private val context: Context) {
    private val prefs = context.getSharedPreferences("atlas.pip", Context.MODE_PRIVATE)
    var saved by mutableStateOf(prefs.getBoolean(Pip.CALM_KEY, false))
        private set
    val systemReduced: Boolean
        get() = Pip.systemReduced(Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))
    val calm: Boolean get() = Pip.calm(systemReduced, saved)

    fun set(on: Boolean) {
        saved = on
        prefs.edit().putBoolean(Pip.CALM_KEY, on).apply()
    }
}

@Composable
fun rememberPipCalm(): PipCalm {
    val context = LocalContext.current.applicationContext
    return remember { PipCalm(context) }
}

/** The "Calm mode" switch: Pip fades instead of hopping, and stops blinking. Already on when the system removes animations. */
@Composable
fun CalmToggle(calm: PipCalm) {
    val reduced = calm.systemReduced
    Row(
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "Calm mode"
            if (reduced) stateDescription = "On. Your device already asks for less motion"
        },
    ) {
        Text("Calm mode", style = Type.caption.copy(color = Palette.ink))
        Switch(
            checked = calm.calm, onCheckedChange = { calm.set(it) }, enabled = !reduced,
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.teal),
        )
    }
}

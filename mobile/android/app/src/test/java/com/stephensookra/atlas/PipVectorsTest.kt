package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.Pip
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pip on Android, checked against the website. mobile/shared/pip-vectors.json (the same file iOS replays) holds
 * web/src/lib/pip.ts's own answers: the fixed lines, the quiet kinds, and where Pip goes for 618 cases, with where the
 * one Pip is drawn.
 */
class PipVectorsTest {
    private val vectors by lazy { AtlasJson.parseToJsonElement(File("../../shared/pip-vectors.json").readText()).jsonObject }

    private fun str(o: JsonObject, k: String): String? = o[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content

    private fun expected(s: JsonObject): Pip.Spot = when (val at = str(s, "at")) {
        "none" -> Pip.Spot.None
        "header" -> Pip.Spot.Header
        "greet" -> Pip.Spot.Greet(str(s, "id")!!)
        "step" -> Pip.Spot.OnStep(str(s, "id")!!, Pip.Mood.valueOf(str(s, "mood")!!), str(s, "line")?.let { Pip.Line.valueOf(it) })
        else -> error("unknown spot $at")
    }

    private fun run(c: JsonObject): Pip.Spot {
        val steps = c.getValue("steps").jsonArray.map { val o = it.jsonObject; Pip.Step(str(o, "id")!!, str(o, "kind")!!) }
        val done = c.getValue("done").jsonArray.associate { it.jsonPrimitive.content to true }
        val checks = c.getValue("checks").jsonObject.mapValues { Check.valueOf(it.value.jsonPrimitive.content) }
        return Pip.spot(steps, done, { checks[it] ?: Check.unchecked }, str(c, "cheering"), c.getValue("greet").jsonPrimitive.boolean)
    }

    private val cases get() = vectors.getValue("cases").jsonArray.map { it.jsonObject }

    @Test fun fixedLinesAreTheWebsitesInAllSevenLanguages() {
        val web = vectors.getValue("lines").jsonObject
        assertEquals(Language.entries.map { it.name }.toSet(), web.keys)
        for (language in Language.entries) {
            val lines = web.getValue(language.name).jsonObject
            assertEquals(Pip.Line.entries.map { it.name }.toSet(), lines.keys)
            for (line in Pip.Line.entries) {
                assertEquals("$language $line", lines.getValue(line.name).jsonPrimitive.content, Pip.line(language, line))
            }
        }
    }

    @Test fun quietKindsAreTheWebsites() {
        assertEquals(vectors.getValue("quiet_kinds").jsonArray.map { it.jsonPrimitive.content }.toSet(), Pip.QUIET_KINDS)
    }

    @Test fun placementMatchesTheWebsite() {
        var passed = 0
        for (c in cases) {
            val name = str(c, "name")
            val want = expected(c.getValue("spot").jsonObject)
            val got = run(c)
            val drawn = Pip.drawn(got)
            val card = c["card"]?.takeIf { it != JsonNull }?.jsonObject?.let {
                Pip.Drawn.Card(str(it, "id")!!, Pip.Mood.valueOf(str(it, "mood")!!), str(it, "line")?.let { l -> Pip.Line.valueOf(l) })
            }
            assertEquals("$name", want, got)
            assertEquals("card in $name", card, drawn.card)
            assertEquals("heading in $name", str(c, "heading")?.let { Pip.Mood.valueOf(it) }, drawn.heading)
            passed++
        }
        assertTrue(cases.size > 600)
        println("pip vectors: $passed of ${cases.size} equal to the web reference")
    }

    @Test fun exactlyOnePipOnScreenInEveryState() {
        for (c in cases) {
            val spot = run(c)
            val drawn = Pip.drawn(spot)
            assertEquals(str(c, "name"), if (spot == Pip.Spot.None) 0 else 1, drawn.count)
            // During the greeting no card shows Pip: his card's slot stays empty.
            if (spot is Pip.Spot.Greet) { assertNull(drawn.card); assertEquals(Pip.Mood.arrive, drawn.heading) }
        }
    }

    private val steps = listOf(Pip.Step("eye", "referral"), Pip.Step("met", "medication"), Pip.Step("a1c", "lab_test"), Pip.Step("walk", "self_care"))
    private val unchecked: (String) -> Check = { Check.unchecked }

    @Test fun quietOnMedicineLabsWarningsAndFlaggedSteps() {
        // Medicine is the current step: quiet, no line, no motion and no blink, calm or not.
        val med = Pip.spot(steps, mapOf("eye" to true), unchecked, null)
        assertEquals(Pip.Spot.OnStep("met", Pip.Mood.quiet, null), med)
        assertNull(med.line)
        assertEquals(Pip.Motion.Still, Pip.motion(Pip.Mood.quiet, calm = false))
        assertEquals(Pip.Motion.Still, Pip.motion(Pip.Mood.quiet, calm = true))
        assertFalse(Pip.blinks(Pip.Mood.quiet, calm = false))
        // Medicine just marked done: no cheer there.
        assertEquals(Pip.Spot.OnStep("a1c", Pip.Mood.quiet, null), Pip.spot(steps, mapOf("eye" to true, "met" to true), unchecked, "met"))
        // A step the check flagged: quiet, and never cheered.
        val flagged: (String) -> Check = { if (it == "eye") Check.flagged else Check.unchecked }
        assertEquals(Pip.Spot.OnStep("met", Pip.Mood.quiet, null), Pip.spot(steps, mapOf("eye" to true), flagged, "eye"))
        assertTrue(Pip.quiet("warning_sign", Check.certified))
        assertFalse(Pip.quiet("self_care", Check.unchecked))
    }

    @Test fun greetingIsOnlyAFirstView() {
        assertTrue(Pip.greetAllowed(false, emptyMap()))
        assertFalse(Pip.greetAllowed(true, emptyMap()))
        // A done mark on a step since removed (or a warning sign) still means this is not a first view.
        assertFalse(Pip.greetAllowed(false, mapOf("removed-step" to true)))
        assertTrue(Pip.greetAllowed(false, mapOf("unticked" to false)))
    }

    @Test fun removeAnimationsAndCalmModeFadeWithNoBlink() {
        assertTrue(Pip.systemReduced(0f))
        assertFalse(Pip.systemReduced(1f))
        assertTrue(Pip.calm(systemReduced = true, saved = false))
        assertTrue(Pip.calm(systemReduced = false, saved = true))
        assertFalse(Pip.calm(systemReduced = false, saved = false))
        assertEquals(Pip.Motion.Hop, Pip.motion(Pip.Mood.arrive, calm = false))
        assertEquals(Pip.Motion.Bounce, Pip.motion(Pip.Mood.cheer, calm = false))
        assertEquals(Pip.Motion.Fade, Pip.motion(Pip.Mood.arrive, calm = true))
        assertEquals(Pip.Motion.Fade, Pip.motion(Pip.Mood.cheer, calm = true))
        assertFalse(Pip.blinks(Pip.Mood.arrive, calm = true))
        assertTrue(Pip.blinks(Pip.Mood.arrive, calm = false))
        assertEquals("atlas.pipCalm", Pip.CALM_KEY)
    }

    @Test fun announcementKeyReadsARepeatedCheerAgainButNotAMovedGreeting() {
        assertTrue(Pip.announceKey(Pip.Spot.OnStep("a", Pip.Mood.cheer, Pip.Line.done)) != Pip.announceKey(Pip.Spot.OnStep("b", Pip.Mood.cheer, Pip.Line.done)))
        assertEquals(Pip.announceKey(Pip.Spot.Greet("a")), Pip.announceKey(Pip.Spot.OnStep("a", Pip.Mood.arrive, Pip.Line.start)))
    }
}

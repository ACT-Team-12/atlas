package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.Pip
import com.stephensookra.atlas.data.WalkThrough
import com.stephensookra.atlas.data.WhenGroup
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * "Walk me through it" on Android, checked against the website. mobile/shared/walk-vectors.json (the same file iOS
 * replays) holds web/src/lib/walkThrough.ts's own answers: the fixed lines in all seven languages, the order, where Pip
 * shows on the step on screen, and the next open step.
 */
class WalkThroughTest {
    private val vectors by lazy { AtlasJson.parseToJsonElement(File("../../shared/walk-vectors.json").readText()).jsonObject }

    private fun str(o: JsonObject, k: String): String? = o[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content

    private fun spot(s: JsonObject): Pip.Spot = when (val at = str(s, "at")) {
        "none" -> Pip.Spot.None
        "header" -> Pip.Spot.Header
        "greet" -> Pip.Spot.Greet(str(s, "id")!!)
        "step" -> Pip.Spot.OnStep(str(s, "id")!!, Pip.Mood.valueOf(str(s, "mood")!!), str(s, "line")?.let { Pip.Line.valueOf(it) })
        else -> error("unknown spot $at")
    }

    @Test fun fixedLinesAreTheWebsitesInAllSevenLanguages() {
        val web = vectors.getValue("lines").jsonObject
        assertEquals(Language.entries.map { it.name }.toSet(), web.keys)
        assertEquals(WalkThrough.Line.entries.map { it.name }.toSet(), vectors.getValue("line_keys").jsonArray.map { it.jsonPrimitive.content }.toSet())
        for (language in Language.entries) {
            val table = web.getValue(language.name).jsonObject
            for (line in WalkThrough.Line.entries) {
                assertEquals("$language $line", table.getValue(line.name).jsonPrimitive.content, WalkThrough.line(language, line))
            }
        }
    }

    @Test fun filledLinesMatchTheWebsite() {
        for (f in vectors.getValue("filled").jsonArray.map { it.jsonObject }) {
            val values = f.getValue("values").jsonObject.mapValues { it.value.jsonPrimitive.int }
            assertEquals(f.toString(), str(f, "text"), WalkThrough.line(str(f, "language")!!, WalkThrough.Line.valueOf(str(f, "line")!!), values))
        }
    }

    @Test fun orderAndPipAndNextOpenMatchTheWebsite() {
        var passed = 0
        var total = 0
        for (o in vectors.getValue("order").jsonArray.map { it.jsonObject }) {
            total++
            val items = o.getValue("items").jsonArray.map { it.jsonObject }
            val got = WalkThrough.steps(items, { it.getValue("warning").jsonPrimitive.boolean }, { WhenGroup.valueOf(str(it, "group")!!) })
            assertEquals(o.toString(), o.getValue("ids").jsonArray.map { it.jsonPrimitive.content }, got.map { str(it.it, "id") })
            assertEquals(o.toString(), o.getValue("groups").jsonArray.map { it.jsonPrimitive.content }, got.map { it.key })
            passed++
        }
        for (c in vectors.getValue("pip").jsonArray.map { it.jsonObject }) {
            total++
            val shown = c.getValue("shown").jsonObject
            val got = WalkThrough.pip(spot(c.getValue("spot").jsonObject), str(shown, "id")!!, str(shown, "kind")!!,
                Check.valueOf(str(c, "check")!!), c.getValue("warning").jsonPrimitive.boolean)
            val want = (c["expected"] as? JsonObject)?.let { WalkThrough.ShownPip(Pip.Mood.valueOf(str(it, "mood")!!), str(it, "line")?.let { l -> Pip.Line.valueOf(l) }) }
            assertEquals(c.toString(), want, got)
            passed++
        }
        for (n in vectors.getValue("next_open").jsonArray.map { it.jsonObject }) {
            total++
            val ids = n.getValue("ids").jsonArray.map { it.jsonPrimitive.content }
            val done = n.getValue("done").jsonArray.associate { it.jsonPrimitive.content to true }
            assertEquals(n.toString(), n.getValue("expected").jsonPrimitive.int, WalkThrough.nextOpen(ids, done, n.getValue("from").jsonPrimitive.int))
            passed++
        }
        assertTrue("too few walk-through cases: $total", total > 600)
        // android-ci reads this line from the test report to prove the shared vectors ran.
        println("walk vectors: $passed of $total equal to the web reference")
    }

    @Test fun unknownLanguageFallsBackToEnglishAndNoEmDashes() {
        assertEquals("Walk me through it", WalkThrough.line("Klingon", WalkThrough.Line.open))
        assertEquals("Paso 2 de 5", WalkThrough.line(Language.Spanish, WalkThrough.Line.progress, mapOf("n" to 2, "total" to 5)))
        assertFalse(WalkThrough.LINES.values.flatMap { it.values }.any { '—' in it || '–' in it })
    }
}

package com.stephensookra.atlas

import android.app.Application
import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.HelperPresets
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.SessionStore
import com.stephensookra.atlas.data.StaleGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * Three bugs found on the emulator in 1.1, each run through the real AppModel against a saved file on disk:
 * a plan saved by 1.0 never showed the outdated note, opening a helper link moved "Welcome back"'s time,
 * and read aloud on outdated steps used the newly picked language instead of the steps' own.
 */
class SessionFixesTest {
    private class TestApp(private val dir: File) : Application() {
        override fun getFilesDir(): File = dir
        override fun getApplicationContext() = this
    }

    private fun tempDir(): File = Files.createTempDirectory("atlas-session").toFile().apply { deleteOnExit() }

    /** A care response as the live server sends it, minus `language` (the 1.0 app's model had no such field, so it never saved one). */
    private val legacyCare: String by lazy {
        val live = AtlasJson.parseToJsonElement(Fixture.text("extract_sample_live")).let { it as kotlinx.serialization.json.JsonObject }
        kotlinx.serialization.json.JsonObject(live - "language" - "missed_lines").toString()
    }

    /** What the 1.0 app wrote: no fingerprints, no meaning state, care without a language. */
    private fun legacyFile(dir: File, savedAt: Long, withPlan: Boolean = false) {
        val plan = if (withPlan) ""","plan":${Fixture.text("plan_sample_30303_live")}""" else ""
        File(dir, "session-v1.json").writeText(
            """{"text":"${"Take metformin 500 mg twice a day with meals. Call 911 for chest pain."}","language":"Spanish","level":"simple",
               "care":$legacyCare,"barriers":["cost"],"zip":"30303","note":""$plan,"done":{},"removed":{},"savedAt":$savedAt}""",
        )
    }

    // ---- Missed lines follow Remove and Undo

    @Test fun missedLinesFollowRemoveAndUndo() {
        val dir = tempDir()
        val care = AtlasJson.parseToJsonElement(Fixture.text("extract_sample_live")) as kotlinx.serialization.json.JsonObject
        // Built by the server (PR 66) for this exact response; taken from the shared vectors so it is the real payload.
        val vectors = AtlasJson.parseToJsonElement(File("../../shared/missed-lines-vectors.json").readText()) as kotlinx.serialization.json.JsonObject
        val live = (vectors.getValue("fixtures") as kotlinx.serialization.json.JsonArray)
            .map { it as kotlinx.serialization.json.JsonObject }
            .first { (it.getValue("name") as kotlinx.serialization.json.JsonPrimitive).content == "live-12-items" }
        val withPayload = kotlinx.serialization.json.JsonObject(care + ("missed_lines" to live.getValue("payload")))
        File(dir, "session-v1.json").writeText(
            """{"text":"x","language":"English","level":"simple","care":$withPayload,"savedAt":5}""",
        )
        val model = AppModel(TestApp(dir))
        val all = model.missedLines as com.stephensookra.atlas.data.MissedLinesView.Shown
        var changed = 0
        for (id in model.items.map { it.id }) {
            model.remove(id)
            val after = model.missedLines as com.stephensookra.atlas.data.MissedLinesView.Shown
            assertTrue("removing a step can only add lines", after.lines.size >= all.lines.size)
            assertEquals(all.total, after.total)
            if (after.lines.size > all.lines.size) changed++
            model.undoRemove(id)
            assertEquals("Undo restores the section exactly", all, model.missedLines)
        }
        assertTrue("some removal must surface a line", changed > 0)
    }
}

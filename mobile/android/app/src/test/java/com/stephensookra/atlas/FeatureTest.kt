package com.stephensookra.atlas

import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.Sample
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.SessionStore
import com.stephensookra.atlas.services.OcrLine
import com.stephensookra.atlas.services.ReminderDraft
import com.stephensookra.atlas.services.ReminderStore
import com.stephensookra.atlas.services.Speaker
import com.stephensookra.atlas.services.StoredReminder
import com.stephensookra.atlas.services.TextReader
import com.stephensookra.atlas.ui.Links
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class SampleTest {
    /** The app's sample must be byte-identical to the web sample (web/src/lib/sample.ts). */
    @Test fun sampleMatchesWebSource() {
        // Unit tests run with the module directory (mobile/android/app) as the working directory.
        val web = File("../../../web/src/lib/sample.ts").canonicalFile
        assertTrue("cannot find $web", web.exists())
        val src = web.readText(Charsets.UTF_8)
        val start = src.indexOf("SAMPLE_AVS = `") + "SAMPLE_AVS = `".length
        val end = src.indexOf("`;", start)
        assertTrue(start > 20 && end > start)
        assertEquals(src.substring(start, end), Sample.TEXT)
        val label = Regex("SAMPLE_LABEL = \"(.*?)\";").find(src)!!.groupValues[1]
        assertEquals(label, Sample.LABEL)
    }
}

class ReminderTest {
    @Test fun contentIsStepTitlePlusQuote() {
        val draft = ReminderDraft(
            "Start metformin",
            "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.",
            1_800_000_000_000,
        )
        assertEquals("ATLAS reminder: Start metformin", draft.notificationTitle)
        assertEquals(
            "Start metformin\nFrom your paper: “metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.”",
            draft.notificationBody,
        )
    }

    @Test fun noQuoteNeverClaimsToBeFromThePaper() {
        val draft = ReminderDraft("Apply for Medicaid", "  ", 0, "Apply through Georgia Gateway.")
        assertFalse(draft.notificationBody.contains("From your paper"))
        assertEquals("Apply for Medicaid\nApply through Georgia Gateway.", draft.notificationBody)
        assertEquals("Apply for Medicaid", ReminderDraft("Apply for Medicaid", "", 0).notificationBody)
    }

    @Test fun triggerIsTheChosenDayAndMinuteInLocalTime() {
        val zone = ZoneId.of("America/New_York")
        val millis = ReminderDraft.millisFor(LocalDate.of(2026, 10, 9), 8, 30, zone)
        val back = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(millis), zone)
        assertEquals(2026, back.year); assertEquals(10, back.monthValue); assertEquals(9, back.dayOfMonth)
        assertEquals(8, back.hour); assertEquals(30, back.minute)
    }

    @Test fun storeKeepsListAndRemoves() {
        val dir = Files.createTempDirectory("atlas-rem").toFile()
        val store = ReminderStore(dir)
        store.add(StoredReminder(2, "b", "B", 200))
        store.add(StoredReminder(1, "a", "A", 100))
        assertEquals(listOf(1, 2), store.all().map { it.id })
        store.remove(listOf(1))
        assertEquals(listOf(2), store.all().map { it.id })
        store.remove(listOf(2))
        assertTrue(store.all().isEmpty())
    }
}

class SpeechTest {
    @Test fun languageToVoiceMapMatchesWeb() {
        val expected = mapOf(
            Language.English to "en-US", Language.Spanish to "es-US", Language.Vietnamese to "vi-VN",
            Language.Korean to "ko-KR", Language.Chinese to "zh-CN", Language.Amharic to "am-ET", Language.French to "fr-FR",
        )
        for (lang in Language.entries) assertEquals(expected[lang], Speaker.code(lang))
        assertEquals(Language.entries.size, Speaker.voiceCode.size)
        assertTrue(Speaker.missingVoiceNote(Language.Amharic).contains("no Amharic voice"))
    }
}

class LocationTest {
    @Test fun serviceAreaMatchesServerBounds() {
        // Server PlanRequestSchema: lat -20 to 72, lng -180 to 180 (the US and its territories), inclusive like zod.
        assertTrue(LatLng(33.749, -84.388).isInServiceArea) // downtown Atlanta
        assertTrue(LatLng(37.33, -122.03).isInServiceArea) // Cupertino
        assertTrue(LatLng(13.44, 144.79).isInServiceArea) // Guam
        assertTrue(LatLng(-20.0, -180.0).isInServiceArea)
        assertFalse(LatLng(-33.87, 151.21).isInServiceArea) // Sydney
        assertFalse(LatLng(80.0, 0.0).isInServiceArea)
    }
}

class LinksTest {
    @Test fun phoneLinksUseDigitsAndHideEmpty() {
        assertEquals("tel:4048485389", Links.tel("404-848-5389"))
        assertNull(Links.tel(""))
        assertNull(Links.tel(null))
        assertNull(Links.tel("call us"))
    }

    @Test fun transitLinkAsksGoogleMapsForTransit() {
        val c = (Fixture.plan.resources.values.first { it is com.stephensookra.atlas.data.ResourceCard.ClinicCard }
            as com.stephensookra.atlas.data.ResourceCard.ClinicCard).clinic
        val url = Links.transit(c)
        assertTrue(url.startsWith("https://www.google.com/maps/dir/?api=1&destination="))
        assertTrue(url.endsWith("&travelmode=transit"))
        assertTrue(url.contains(c.zip))
    }

    @Test fun onlyWebLinksOpen() {
        assertEquals("https://example.org", Links.web(" https://example.org "))
        assertNull(Links.web(""))
        assertNull(Links.web("javascript:alert(1)"))
    }
}

class StoreTest {
    @Test fun savesLoadsAndClears() {
        val dir = Files.createTempDirectory("atlas-store").toFile()
        val store = SessionStore(dir)
        val session = SavedSession(
            text = Sample.TEXT, language = Language.Spanish, level = ReadingLevel.simple, care = Fixture.care,
            barriers = listOf(Barrier.transport), zip = "30303", note = "", plan = Fixture.plan,
            done = mapOf("item-0" to true), removed = emptyMap(), savedAt = 1_800_000_000_000,
        )
        store.save(session)
        assertEquals(session, store.load())
        store.clear()
        assertNull(store.load())
    }

    @Test fun corruptFileLoadsAsNothing() {
        val dir = Files.createTempDirectory("atlas-store").toFile()
        val store = SessionStore(dir)
        store.file.writeText("{not json")
        assertNull(store.load())
    }
}

class OcrOrderTest {
    @Test fun groupsSameLineAndReadsTopToBottom() {
        val lines = listOf(
            OcrLine("Visit: 10/01/2026", 600, 102, 900, 140),
            OcrLine("AFTER VISIT SUMMARY", 40, 20, 500, 60),
            OcrLine("Sample Patient", 40, 100, 300, 138),
            OcrLine("Return to clinic in 3 months", 40, 200, 700, 240),
            OcrLine("  ", 0, 300, 10, 310),
        )
        assertEquals(
            listOf("AFTER VISIT SUMMARY", "Sample Patient   Visit: 10/01/2026", "Return to clinic in 3 months"),
            TextReader.order(lines),
        )
    }
}

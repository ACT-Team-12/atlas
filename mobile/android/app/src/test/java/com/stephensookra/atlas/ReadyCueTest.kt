package com.stephensookra.atlas

import com.stephensookra.atlas.data.ReadyCue
import com.stephensookra.atlas.data.ReadyCue.What
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The ready cue's rules (web/src/ui/ReadyCue.tsx and cueFor in web/src/ui/CarePlanTool.tsx), on Android. */
class ReadyCueTest {
    @Test fun labelsAreTheWebsites() {
        assertEquals("Your steps are ready", ReadyCue.label(What.steps))
        assertEquals("Your plan is ready", ReadyCue.label(What.plan))
    }

    @Test fun showsOnlyForTheExactCurrentResultAndNotOnItsOwnScreen() {
        val steps = ReadyCue.Mark(What.steps, 2)
        assertEquals(What.steps, ReadyCue.shown(steps, 2, 0, careCurrent = true, planCurrent = false, top = null))
        assertEquals(What.steps, ReadyCue.shown(steps, 2, 0, careCurrent = true, planCurrent = false, top = Route.Reminders))
        // Already on the steps screen: nothing to show.
        assertNull(ReadyCue.shown(steps, 2, 0, careCurrent = true, planCurrent = false, top = Route.Steps))
        // Outdated (the text, language or level changed meanwhile): never a cue for it.
        assertNull(ReadyCue.shown(steps, 2, 0, careCurrent = false, planCurrent = false, top = null))
        // A newer reading replaced the one that raised it.
        assertNull(ReadyCue.shown(steps, 3, 0, careCurrent = true, planCurrent = false, top = null))
        val plan = ReadyCue.Mark(What.plan, 1)
        assertEquals(What.plan, ReadyCue.shown(plan, 5, 1, careCurrent = true, planCurrent = true, top = Route.Barriers))
        assertNull(ReadyCue.shown(plan, 5, 1, careCurrent = true, planCurrent = false, top = Route.Barriers))
        assertNull(ReadyCue.shown(plan, 5, 2, careCurrent = true, planCurrent = true, top = Route.Barriers))
        assertNull(ReadyCue.shown(null, 0, 0, careCurrent = true, planCurrent = true, top = null))
    }

    @Test fun showMeGoesToTheResultScreen() {
        assertEquals(listOf(Route.Steps), ReadyCue.path(What.steps, emptyList()))
        assertEquals(listOf(Route.Check, Route.Steps), ReadyCue.path(What.steps, listOf(Route.Check)))
        assertEquals(listOf(Route.Check, Route.Steps), ReadyCue.path(What.steps, listOf(Route.Check, Route.Steps, Route.Barriers)))
        assertEquals(listOf(Route.Check, Route.Steps, Route.Barriers, Route.Plan), ReadyCue.path(What.plan, listOf(Route.Check, Route.Steps, Route.Barriers)))
        assertEquals(listOf(Route.Steps, Route.Plan), ReadyCue.path(What.plan, emptyList()))
        assertEquals(listOf(Route.Steps, Route.Plan), ReadyCue.path(What.plan, listOf(Route.Steps, Route.Plan, Route.Reminders)))
    }
}

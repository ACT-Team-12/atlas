package com.stephensookra.atlas.data

import com.stephensookra.atlas.Route

/**
 * "Your plan is ready: show me" (web/src/ui/ReadyCue.tsx). Reading the paper and building the plan take 10 to 25
 * seconds. A person may choose to look around the app meanwhile; when the result lands, the app does not move them.
 * Instead this cue floats at the bottom of every screen until they use it or open the result themselves. Pure rules,
 * tested in ReadyCueTest.
 */
object ReadyCue {
    @Suppress("EnumEntryName")
    enum class What { steps, plan }

    /** The exact result that raised the cue: which kind, and which reading or plan (counted in this run of the app). */
    data class Mark(val what: What, val run: Int)

    /** LABEL in ReadyCue.tsx, also said once, politely, when the cue appears. */
    fun label(what: What): String = if (what == What.steps) "Your steps are ready" else "Your plan is ready"

    /** The screen the cue takes the person to. */
    fun route(what: What): Route = if (what == What.steps) Route.Steps else Route.Plan

    /**
     * cueFor in CarePlanTool.tsx: the cue shows only for the exact result that raised it and only while that result is
     * still current (never for outdated steps or an outdated plan), and hides once its screen is open.
     */
    fun shown(mark: Mark?, readingCount: Int, planCount: Int, careCurrent: Boolean, planCurrent: Boolean, top: Route?): What? {
        if (mark == null || top == route(mark.what)) return null
        return when (mark.what) {
            What.steps -> What.steps.takeIf { mark.run == readingCount && careCurrent }
            What.plan -> What.plan.takeIf { mark.run == planCount && planCurrent }
        }
    }

    /**
     * Where "show me" goes: back to the result's screen if it is already in the stack, otherwise on top of where the
     * person is (Back then returns them there).
     */
    fun path(what: What, from: List<Route>): List<Route> {
        val target = route(what)
        val i = from.indexOf(target)
        if (i >= 0) return from.take(i + 1)
        if (what == What.plan && Route.Steps !in from) return from + listOf(Route.Steps, Route.Plan)
        return from + target
    }
}

package com.stephensookra.atlas.data

/**
 * Pip, the "you are here" marker on a plan (Akhil's design: a Georgia peach shaped like a map pin). Pure rules, no AI.
 * A port of web/src/lib/pip.ts; PipVectorsTest replays mobile/shared/pip-vectors.json, the website's own answers.
 *
 * - Pip sits in a reserved spot on the trailing edge of the card for the step that matters now, and never covers text.
 * - The step that matters now is the first step not yet done, in the order the groups are shown (earliest group first).
 * - Pip is quiet around medicine, warning signs and lab tests: no motion, no bubble, no cheer on those cards. A step a
 *   check disagreed with is quiet too, so a cheer or a bubble never reads as an endorsement of it.
 * - What Pip says is a short FIXED line from the table below, never AI text, and never a medical suggestion.
 * - Pip is one character: exactly one on screen whenever there are steps.
 */
object Pip {
    @Suppress("EnumEntryName")
    enum class Line { start, done, next, allDone }

    @Suppress("EnumEntryName")
    enum class Mood { arrive, cheer, quiet }

    /**
     * Every line Pip can say, per app language, copied exactly from PIP_LINES in web/src/lib/pip.ts. Written by the team,
     * not by a model at runtime. NATIVE REVIEW NEEDED for every language but English (Amharic most of all), as on the
     * website.
     */
    val LINES: Map<Language, Map<Line, String>> = mapOf(
        Language.English to lines("Start here", "Nice, that's done", "Next up", "All done for now"),
        // NATIVE REVIEW NEEDED (Spanish).
        Language.Spanish to lines("Empiece aquí", "Bien, ya está hecho", "Lo siguiente", "Todo listo por ahora"),
        // NATIVE REVIEW NEEDED (Vietnamese).
        Language.Vietnamese to lines("Bắt đầu ở đây", "Tốt lắm, đã xong", "Tiếp theo", "Tạm thời đã xong hết"),
        // NATIVE REVIEW NEEDED (Korean).
        Language.Korean to lines("여기서 시작하세요", "잘했어요, 끝났어요", "다음 차례", "지금은 모두 끝났어요"),
        // NATIVE REVIEW NEEDED (Chinese, Simplified).
        Language.Chinese to lines("从这里开始", "很好，完成了", "下一步", "目前都完成了"),
        // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
        Language.Amharic to lines("ከዚህ ይጀምሩ", "ጥሩ፣ ተጠናቋል", "ቀጣዩ", "ለአሁን ሁሉም ተጠናቋል"),
        // NATIVE REVIEW NEEDED (French).
        Language.French to lines("Commencez ici", "Bien, c'est fait", "Ensuite", "Tout est fait pour l'instant"),
    )

    private fun lines(start: String, done: String, next: String, allDone: String) =
        mapOf(Line.start to start, Line.done to done, Line.next to next, Line.allDone to allDone)

    /** Pip's line in the person's language (English when a line is missing, as on the website). */
    fun line(language: Language, line: Line): String =
        LINES[language]?.get(line) ?: LINES.getValue(Language.English).getValue(line)

    /** Kinds of step Pip stays quiet on: medicine, lab tests and warning signs. */
    val QUIET_KINDS: Set<String> = setOf("medication", "lab_test", "warning_sign")

    /** True when Pip must be quiet on this step: no motion, no bubble, no cheer. */
    fun quiet(kind: String, check: Check): Boolean = kind in QUIET_KINDS || check == Check.flagged

    data class Step(val id: String, val kind: String)

    /** Where Pip is and what he says (PipSpot in pip.ts). */
    sealed interface Spot {
        val line: Line?

        data class OnStep(val id: String, val mood: Mood, override val line: Line?) : Spot

        /** Every step done: "All done for now" at the heading. */
        data object Header : Spot { override val line = Line.allDone }

        /**
         * First view when the current step is quiet: "Start here" once at the heading, pointing down at the list. Pip is
         * one character, so the card (`id`) shows no Pip meanwhile: its slot stays reserved and empty.
         */
        data class Greet(val id: String) : Spot { override val line = Line.start }

        data object None : Spot { override val line: Line? = null }
    }

    /** The step that matters now: the first not done, in the order shown. Null when every step is done or there are none. */
    fun currentStepId(ordered: List<Step>, done: Map<String, Boolean>): String? = ordered.firstOrNull { done[it.id] != true }?.id

    /**
     * Decides Pip's spot (pipSpot in pip.ts). `cheering` is a step the person just marked done; while it is set and still
     * done, Pip cheers there, then moves on. Quiet steps never get a cheer and never get a line. `greet`: whether the
     * heading greeting is still allowed (see [greetAllowed]).
     */
    fun spot(ordered: List<Step>, done: Map<String, Boolean>, check: (String) -> Check, cheering: String?, greet: Boolean = true): Spot {
        if (ordered.isEmpty()) return Spot.None
        val cheer = cheering?.let { c -> ordered.firstOrNull { it.id == c } }
        if (cheer != null && done[cheer.id] == true && !quiet(cheer.kind, check(cheer.id))) return Spot.OnStep(cheer.id, Mood.cheer, Line.done)
        val id = currentStepId(ordered, done) ?: return Spot.Header
        val step = ordered.first { it.id == id }
        val anyDone = ordered.any { done[it.id] == true }
        if (quiet(step.kind, check(id))) return if (greet && !anyDone) Spot.Greet(id) else Spot.OnStep(id, Mood.quiet, null)
        return Spot.OnStep(id, Mood.arrive, if (anyDone) Line.next else Line.start)
    }

    /**
     * The greeting is a first view only: off for good once any step was marked done on this screen (`greetOver`), and off
     * when the saved record has any done mark, including one on a step since removed (CareSteps.tsx).
     */
    fun greetAllowed(greetOver: Boolean, done: Map<String, Boolean>): Boolean = !greetOver && done.values.none { it }

    /** Where the one Pip is drawn: on a card only for a step spot, at the heading for the greeting and for all done. */
    data class Drawn(val card: Card?, val heading: Mood?) {
        data class Card(val id: String, val mood: Mood, val line: Line?)
        val count: Int get() = (if (card == null) 0 else 1) + (if (heading == null) 0 else 1)
    }

    fun drawn(spot: Spot): Drawn = when (spot) {
        is Spot.OnStep -> Drawn(Drawn.Card(spot.id, spot.mood, spot.line), null)
        Spot.Header, is Spot.Greet -> Drawn(null, Mood.arrive)
        Spot.None -> Drawn(null, null)
    }

    /**
     * What TalkBack hears is keyed on where Pip is too, not only on the words: two steps cheered one after the other both
     * say "Nice, that's done", and the second must still be read. The greeting shares the key of the same step's own
     * "Start here", so a late check that turns that step quiet moves the words without reading them twice.
     */
    fun announceKey(spot: Spot): String = when (spot) {
        is Spot.OnStep -> "${spot.id}:${spot.mood.name}"
        is Spot.Greet -> "${spot.id}:arrive"
        Spot.Header -> "header"
        Spot.None -> "none"
    }

    /** How Pip moves (globals.css on the website). Quiet never moves; calm mode fades instead and stops the blink. */
    enum class Motion { Hop, Bounce, Fade, Still }

    fun motion(mood: Mood, calm: Boolean): Motion = when {
        mood == Mood.quiet -> Motion.Still
        calm -> Motion.Fade
        mood == Mood.cheer -> Motion.Bounce
        else -> Motion.Hop
    }

    fun blinks(mood: Mood, calm: Boolean): Boolean = !calm && mood != Mood.quiet

    /** The system's "Remove animations" (Settings.Global.ANIMATOR_DURATION_SCALE == 0) asks for less motion. */
    fun systemReduced(animatorDurationScale: Float): Boolean = animatorDurationScale == 0f

    /** Calm mode is on when the system asks for less motion or the person turned the toggle on (saved on this phone). */
    fun calm(systemReduced: Boolean, saved: Boolean): Boolean = systemReduced || saved

    /** Saved on this phone under the same key as the website's localStorage. */
    const val CALM_KEY = "atlas.pipCalm"

    /** How long a cheer stays before Pip moves on (CareSteps.tsx). */
    const val CHEER_MILLIS = 1400L
}

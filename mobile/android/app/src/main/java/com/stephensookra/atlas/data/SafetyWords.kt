package com.stephensookra.atlas.data

import java.text.Normalizer

/**
 * Warning and stop words for the app's other languages: Vietnamese, Korean, Chinese, Amharic and French. A port of
 * web/src/lib/safetyWords.ts with the same pattern text (SafetyPatterns); the word lists, their sources and the
 * native-speaker review note live in that file.
 *
 * These can only ADD caution: WarningPin.fromPaper and StepsWhen.stopNowFromPaper OR this answer with the English and
 * Spanish one, so nothing here removes a pin or moves a step later. Text is read with runs of spaces as one space and
 * in Unicode NFC form. Korean, Chinese and Amharic are matched as substrings, Vietnamese and French as whole words.
 */
object SafetyWords {
    /** The order of the per-language stop rules (STOP_LANG_ORDER in safetyWords.ts). */
    val STOP_LANGS = listOf("vi", "fr", "ko", "zh", "am")

    /** HEADING_ENDS in safetyWords.ts: a list heading may end with ":", "：" (full width) or "፦" (Ethiopic). */
    val HEADING_ENDS = listOf(":", "：", "፦")

    private val WARNING_MORE = SafetyPatterns.WARNING_MORE.regex()
    private val NOT_EMERGENCY_MORE = SafetyPatterns.NOT_EMERGENCY_MORE.regex()
    private val STOPS = listOf(
        SafetyPatterns.STOP_VI to SafetyPatterns.NOT_NOW_VI,
        SafetyPatterns.STOP_FR to SafetyPatterns.NOT_NOW_FR,
        SafetyPatterns.STOP_KO to SafetyPatterns.NOT_NOW_KO,
        SafetyPatterns.STOP_ZH to SafetyPatterns.NOT_NOW_ZH,
        SafetyPatterns.STOP_AM to SafetyPatterns.NOT_NOW_AM,
    ).map { (stop, notNow) -> stop.regex() to notNow.regex() }

    /** The paper's text as these lists read it: Unicode NFC, then one space for every run of spaces. */
    fun prepare(t: String): String = StepsWhen.spaces(Normalizer.normalize(t, Normalizer.Form.NFC))

    /** True when the quote has warning words in these languages (or 911 written as 9-1-1 or next to non-Latin letters). */
    fun warningFromPaperMore(quote: String): Boolean = WARNING_MORE.containsMatchIn(prepare(quote).replace(NOT_EMERGENCY_MORE, " "))

    /**
     * True when, in one of these languages, the quote or its list heading says to stop and neither names anything that
     * makes the stop not start now. A language's exclusions apply to its own stop words.
     */
    fun stopNowMore(quote: String, heading: String): Boolean {
        val texts = listOf(quote, heading).map { StepsWhen.trim(prepare(it)) }.filter { it.isNotEmpty() }
        return STOPS.any { (stop, notNow) -> texts.none { notNow.containsMatchIn(it) } && texts.any { stop.containsMatchIn(it) } }
    }
}

package com.stephensookra.atlas.data

/**
 * Which steps are pinned as warning signs. A line-for-line port of web/src/lib/warningPin.ts, using the same pattern
 * text (SafetyPatterns, checked against mobile/shared/safety-vectors.json).
 *
 * The model's kind may only ADD caution: a step it labels "warning_sign" is pinned, and so is any step whose own quote
 * from the paper carries warning language (call 911, the emergency room, chest pain, trouble breathing...), whatever
 * kind the model gave it. Read from the paper's quote only.
 */
object WarningPin {
    private val WARNING_WORDS = SafetyPatterns.WARNING_WORDS.regex()
    private val NOT_EMERGENCY = SafetyPatterns.NOT_EMERGENCY.regex()
    private val ER = SafetyPatterns.ER.regex()
    private val JS_SPACES = Regex(SafetyPattern.JS_SPACE_CLASS + "+")

    /** True when the paper's own words in this quote are warning language. */
    fun fromPaper(quote: String): Boolean {
        // "This is not an emergency" is not warning language; any other warning words in the quote still count.
        val t = quote.replace(JS_SPACES, " ").replace(NOT_EMERGENCY, " ")
        return WARNING_WORDS.containsMatchIn(t) || ER.containsMatchIn(t)
    }

    /** Pinned as a warning sign: the model said so, or the paper's quote does. Never removed by the model's kind. */
    fun isWarning(kind: String, quote: String): Boolean = kind == "warning_sign" || fromPaper(quote)

    fun isWarning(item: VerifiedItem): Boolean = isWarning(item.kind, item.source_quote)
}

import Foundation

/// Warning and stop words for the app's other languages: Vietnamese, Korean, Chinese, Amharic and French. A port of
/// web/src/lib/safetyWords.ts with the same pattern text (SafetyPatterns); the word lists, their sources and the
/// native-speaker review note live in that file.
///
/// These can only ADD caution: WarningPin.fromPaper and StepsWhen.stopNowFromPaper OR this answer with the English and
/// Spanish one, so nothing here removes a pin or moves a step later. Text is read with runs of spaces as one space and
/// in Unicode NFC form. Korean, Chinese and Amharic are matched as substrings, Vietnamese and French as whole words.
enum SafetyWords {
    /// The order of the per-language stop rules (STOP_LANG_ORDER in safetyWords.ts).
    static let stopLangs = ["vi", "fr", "ko", "zh", "am"]
    /// HEADING_ENDS in safetyWords.ts: a list heading may end with ":", "：" (full width) or "፦" (Ethiopic).
    static let headingEnds = [":", "\u{FF1A}", "\u{1366}"]

    private static let warningMore = SafetyPatterns.WARNING_MORE.regex()
    private static let notEmergencyMore = SafetyPatterns.NOT_EMERGENCY_MORE.regex()
    private static let stops: [(stop: NSRegularExpression, notNow: NSRegularExpression)] = [
        (SafetyPatterns.STOP_VI.regex(), SafetyPatterns.NOT_NOW_VI.regex()),
        (SafetyPatterns.STOP_FR.regex(), SafetyPatterns.NOT_NOW_FR.regex()),
        (SafetyPatterns.STOP_KO.regex(), SafetyPatterns.NOT_NOW_KO.regex()),
        (SafetyPatterns.STOP_ZH.regex(), SafetyPatterns.NOT_NOW_ZH.regex()),
        (SafetyPatterns.STOP_AM.regex(), SafetyPatterns.NOT_NOW_AM.regex()),
    ]

    /// The paper's text as these lists read it: Unicode NFC, then one space for every run of spaces.
    static func prepare(_ t: String) -> String { StepsWhen.spaces(t.precomposedStringWithCanonicalMapping) }

    /// True when the quote has warning words in these languages (or 911 written as 9-1-1 or next to non-Latin letters).
    static func warningFromPaperMore(_ quote: String) -> Bool {
        Regexes.test(warningMore, Regexes.replaceAll(notEmergencyMore, in: prepare(quote), with: " "))
    }

    /// True when, in one of these languages, the quote or its list heading says to stop and neither names anything that
    /// makes the stop not start now. A language's exclusions apply to its own stop words.
    static func stopNowMore(quote: String, heading: String) -> Bool {
        let texts = [quote, heading].map { StepsWhen.trim(prepare($0)) }.filter { !$0.isEmpty }
        return stops.contains { rule in
            !texts.contains { Regexes.test(rule.notNow, $0) } && texts.contains { Regexes.test(rule.stop, $0) }
        }
    }
}

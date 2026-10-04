import Foundation

/// Which steps are pinned as warning signs. A line-for-line port of web/src/lib/warningPin.ts, using the same pattern
/// text (SafetyPatterns, checked against mobile/shared/safety-vectors.json).
///
/// The model's kind may only ADD caution: a step it labels "warning_sign" is pinned, and so is any step whose own quote
/// from the paper carries warning language (call 911, the emergency room, chest pain, trouble breathing...), whatever
/// kind the model gave it. Read from the paper's quote only.
enum WarningPin {
    private static let warningWords = SafetyPatterns.WARNING_WORDS.regex()
    private static let notEmergency = SafetyPatterns.NOT_EMERGENCY.regex()
    private static let er = SafetyPatterns.ER.regex()
    private static let jsSpaces = try! NSRegularExpression(pattern: SafetyPattern.jsSpaceClass + "+")

    /// True when the paper's own words in this quote are warning language.
    static func fromPaper(_ quote: String) -> Bool {
        // "This is not an emergency" is not warning language; any other warning words in the quote still count.
        let t = Regexes.replaceAll(notEmergency, in: Regexes.replaceAll(jsSpaces, in: quote, with: " "), with: " ")
        // Vietnamese, Korean, Chinese, Amharic and French (SafetyWords) can only add a pin, never remove one.
        return Regexes.test(warningWords, t) || Regexes.test(er, t) || SafetyWords.warningFromPaperMore(quote)
    }

    /// Pinned as a warning sign: the model said so, or the paper's quote does. Never removed by the model's kind.
    static func isWarning(kind: String, quote: String) -> Bool { kind == "warning_sign" || fromPaper(quote) }

    static func isWarning(_ item: VerifiedItem) -> Bool { isWarning(kind: item.kind, quote: item.source_quote) }
}

/// Small helpers that give NSRegularExpression JavaScript's test / replace(/g) behaviour over UTF-16 text.
enum Regexes {
    static func test(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    static func replaceAll(_ re: NSRegularExpression, in s: String, with literal: String) -> String {
        re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length),
                                    withTemplate: NSRegularExpression.escapedTemplate(for: literal))
    }
}

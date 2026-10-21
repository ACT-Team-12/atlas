import Foundation

/// JavaScript-style regular expression helpers over UTF-16 text (the website's string offsets).
enum JSRegex {
    /// Compiles a pattern with the website's meaning of \s and \d (SafetyPattern does the rewriting).
    static func make(_ source: String, _ flags: String = "iu") -> NSRegularExpression {
        SafetyPattern(source: source, flags: flags).regex()
    }

    static func all(_ re: NSRegularExpression, _ s: String) -> [NSTextCheckingResult] {
        re.matches(in: s, range: NSRange(location: 0, length: (s as NSString).length))
    }

    static func first(_ re: NSRegularExpression, _ s: String) -> NSTextCheckingResult? {
        re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length))
    }

    /// A capture group's text, or nil when it did not take part in the match.
    static func group(_ m: NSTextCheckingResult, _ i: Int, in s: String) -> String? {
        let r = m.range(at: i)
        return r.location == NSNotFound ? nil : (s as NSString).substring(with: r)
    }

    /// `s.split(/[chars]/)`: every piece between the characters, empty pieces kept.
    static func split(_ s: String, on chars: String) -> [String] {
        (s as NSString).components(separatedBy: CharacterSet(charactersIn: chars))
    }
}

/// The number readings the medicine card's dose rule depends on, ported from web/src/lib/textReading.ts (readable),
/// web/src/lib/numberWords.ts (English number words) and web/src/lib/meaning.ts (numberUnits, doseReadings). Only the
/// English reading is ported, because doseReadings reads English only. MedicineChangesTests checks the result through
/// the shared medicine vectors.
enum DoseReadings {
    // MARK: readable (textReading.ts)

    /// Unicode compatibility form, no-break spaces as spaces, curly apostrophes and quotes as straight ones, every dash
    /// as "-".
    static func readable(_ text: String) -> String {
        var out = ""
        for u in text.precomposedStringWithCompatibilityMapping.unicodeScalars {
            switch u.value {
            case 0x00A0, 0x2007, 0x202F: out.append(" ")
            case 0x2018, 0x2019, 0x201B, 0x2032, 0x02BC, 0xFF07: out.append("'")
            case 0x201C, 0x201D, 0x2033: out.append("\"")
            case 0x2010...0x2015, 0x2212: out.append("-")
            default: out.unicodeScalars.append(u)
            }
        }
        return out
    }

    // MARK: English number words (numberWords.ts, readLatin with EN_LEX)

    private enum Tok { case n(Int, article: Bool), mul(Int), conn }

    private static let en: [String: Int] = [
        "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
        "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90, "once": 1, "twice": 2,
    ]

    /// NAME_BEFORE_LETTER: words before a letter that is a name, not "a" ("vitamin A", "type A").
    static let nameBeforeLetter = JSRegex.make(#"^(?:vitamin|vitamins|hepatitis|hep|type|class|grade|stage|group|plan|part|step|schedule|category|level|phase|section|form|option|list|blood|strep|influenza|flu|size|ward|wing|building|suite|room|floor|zone|area|track|lot)$"#, "")
    private static let enCount = JSRegex.make(#"^(?:tablets?|pills?|capsules?|doses?|times?|drops?|puffs?|minutes?|seconds?|hours?|days?|weeks?|months?|years?|mg|mcg|g|ml|l|grams?|liters?|litres?|ounces?|oz|units?|patch(?:es)?|injections?|cups?|glasses?|bottles?|packets?|spoons?|teaspoons?|tablespoons?)$"#, "")
    private static let notArticleAfter = JSRegex.make(#"^(?:once|twice|times?|half|quarter|per|every|each|and)$"#, "")
    private static let letters = JSRegex.make(#"\p{L}+"#, "u")
    private static let joiner = JSRegex.make(#"^[\s\-–]*$"#, "u")

    private static func enWord(_ w: String, prev: String?, next: String?) -> Tok? {
        if w == "hundred" { return .mul(100) }
        if w == "thousand" { return .mul(1000) }
        if w == "and" { return .conn }
        if w == "a" && (next == "hundred" || next == "thousand") { return .n(1, article: false) }
        if (w == "a" || w == "an") && !Regexes.test(notArticleAfter, prev ?? "") && !Regexes.test(nameBeforeLetter, prev ?? "") {
            return .n(1, article: true)
        }
        return en[w].map { .n($0, article: false) }
    }

    /// The smallest non-zero place of n (120 gives 10, 200 gives 100, 7 gives 1).
    private static func place(_ n: Int) -> Int {
        var p = 1
        while n > 0 && n % (p * 10) == 0 { p *= 10 }
        return p
    }

    private static func compose(_ toks: [Tok]) -> Int? {
        var total = 0, cur = 0, any = false
        for t in toks {
            switch t {
            case .conn: continue
            case .mul(let v):
                if v == 1000 { total += (cur == 0 ? 1 : cur) * 1000; cur = 0; any = true; continue }
                let low = cur % v
                cur = cur - low + (low == 0 ? 1 : low) * v
                any = true
            case .n(let v, _):
                if !any { cur = v; any = true; continue }
                let ok = cur == 0 || v < place(cur)
                if !ok { return nil }
                cur += v
            }
        }
        return any ? total + cur : nil
    }

    /// The English number words in `text`, as digit strings, in the order first read, each once.
    static func englishNumbers(_ text: String) -> [String] {
        let t = text.lowercased()
        let ns = t as NSString
        let words = JSRegex.all(letters, t).map { (w: ns.substring(with: $0.range), at: $0.range.location, end: $0.range.location + $0.range.length) }
        var out: [String] = []
        var i = 0
        while i < words.count {
            let prev = i > 0 ? words[i - 1].w : nil
            guard let first = enWord(words[i].w, prev: prev, next: i + 1 < words.count ? words[i + 1].w : nil) else { i += 1; continue }
            if case .conn = first { i += 1; continue }
            var run: [Tok] = [first]
            var j = i + 1
            while j < words.count, Regexes.test(joiner, ns.substring(with: NSRange(location: words[j - 1].end, length: words[j].at - words[j - 1].end))) {
                guard let tok = enWord(words[j].w, prev: words[j - 1].w, next: j + 1 < words.count ? words[j + 1].w : nil) else { break }
                run.append(tok)
                j += 1
            }
            while let last = run.last, case .conn = last { run.removeLast(); j -= 1 }
            let nextWord = j < words.count ? words[j].w : ""
            if run.count == 1, case .n(_, let article) = run[0], article, !Regexes.test(enCount, nextWord) { i = j; continue }
            if let n = compose(run) {
                let s = String(n)
                if !out.contains(s) { out.append(s) }
            }
            i = j
        }
        return out
    }

    // MARK: numberUnits and doseReadings (meaning.ts)

    private static let unitClasses: [(String, NSRegularExpression)] = [
        ("dose", #"^(?:tablets?|pills?|capsules?|puffs?|drops?|doses?|patch(?:es)?|injections?|units?|sprays?|tabletas?|pastillas?|c[áa]psulas?|comprimidos?|gotas?|inhalaci[óo]n|inhalaciones|unidades|unidad|parches?|comprim[ée]s?|pilules?|g[ée]lules?|cachets?|gouttes?|bouff[ée]es?|unit[ée]s?|viên|giọt|nhát|liều|miếng)$"#),
        ("mass", #"^(?:mg|mcg|g|grams?|milligrams?|micrograms?|gramos?|miligramos?|grammes?|milligrammes?|gam)$"#),
        ("volume", #"^(?:ml|l|oz|ounces?|cups?|glass(?:es)?|liters?|litres?|teaspoons?|tablespoons?|tsp|tbsp|tazas?|vasos?|onzas?|litros?|cucharadas?|cucharaditas?|verres?|tasses?|onces?|cuill[èe]res?|cốc|ly|lít|muỗng|thìa)$"#),
        ("minute", #"^(?:minutes?|mins?|minutos?|phút)$"#),
        ("hour", #"^(?:hours?|hrs?|horas?|heures?|giờ)$"#),
        ("day", #"^(?:days?|d[íi]as?|jours?|ngày)$"#),
        ("week", #"^(?:weeks?|semanas?|semaines?|tuần)$"#),
        ("month", #"^(?:months?|mes|meses|mois|tháng)$"#),
        ("times", #"^(?:times?|x|vez|veces|fois|lần)$"#),
        ("ratio", #"^(?:parts?|partes?|parties?|phần)$"#),
        ("clock", #"^(?:am|pm|a\.m\.?|p\.m\.?|o'clock|o’clock|h)$"#),
    ].map { ($0.0, JSRegex.make($0.1, "u")) }
    private static let cjkUnitClasses: [(String, NSRegularExpression)] = [
        ("dose", "^(?:片|粒|颗|顆|알|정|캡슐|방울)"), ("mass", "^(?:毫克|밀리그램)"), ("volume", "^(?:毫升|杯|밀리리터|컵|잔)"),
        ("minute", "^(?:分钟|分鐘|분)"), ("hour", "^(?:小时|小時|시간)"), ("day", "^(?:天|日|일)"), ("week", "^(?:周|週|星期|주)"),
        ("month", "^(?:个月|個月|개월|달)"), ("times", "^(?:次|회|번)"), ("clock", "^(?:点|點|시)"),
    ].map { ($0.0, JSRegex.make($0.1, "u")) }

    static func unitClass(_ word: String?) -> String? {
        guard let word, !word.isEmpty else { return nil }
        let w = word.lowercased()
        for (c, re) in unitClasses where Regexes.test(re, w) { return c }
        for (c, re) in cjkUnitClasses where Regexes.test(re, w) { return c }
        return nil
    }

    private static let contextStop: Set<String> = [
        "take", "use", "give", "apply", "inhale", "drink", "eat", "the", "a", "an", "and", "or", "of", "with", "by", "at", "to",
        "for", "your", "then", "also", "every", "each", "per", "total", "daily", "once", "twice", "mouth", "in", "on", "is",
        "it", "you", "should", "please", "do", "not", "start", "stop", "continue", "keep", "inject", "swallow", "chew",
        "spray", "insert", "place", "put", "mix", "dissolve", "measure", "now",
    ]
    private static let sameName: [String: String] = ["pill": "tablet", "pills": "tablet", "tablet": "tablet", "tablets": "tablet",
                                                     "previously": "previously", "formerly": "previously"]
    static let aliasNames = Set(sameName.values)
    private static let person: Set<String> = ["you", "i", "we", "they", "he", "she"]

    private static func nameOf(_ w: String, prev: String?, next: String?) -> String {
        if w == "used" && next?.lowercased() == "to" && person.contains(prev?.lowercased() ?? "") { return "previously" }
        return sameName[w] ?? w
    }

    private static let tokens = JSRegex.make(#"\d{3}[-.]\d{3}[-.]\d{4}|\d{1,2}:\d{2}|\d+(?:st|nd|rd|th)(?![\p{L}\p{M}])|\d+(?:[.,]\d+)*(?:\s*[/⁄∕]\s*\d+)?|[ap]\.\s?m\.?|[\p{L}\p{M}]+"#, "giu")
    private static let startsDigit = JSRegex.make(#"^\d"#, "")
    private static let clockTok = JSRegex.make(#"^\d{1,2}:\d{2}$"#, "")
    private static let phoneTok = JSRegex.make(#"^\d{3}[-.]\d{3}[-.]\d{4}$"#, "")
    private static let halfWord = JSRegex.make(#"^(?:half|halves|medio|media|medias|mitad|demi|demie|demis|moitié|nửa|半|반)$"#, "iu")
    private static let quarterWord = JSRegex.make(#"^(?:quarter|quarters|cuarto|cuartos|cuarta|quart|quarts)$"#, "iu")
    private static let ordinalTok = JSRegex.make(#"^\d+(?:st|nd|rd|th)$"#, "i")
    private static let onceTwice = JSRegex.make(#"^(?:once|twice)$"#, "i")
    private static let articleTok = JSRegex.make(#"^an?$"#, "i")
    private static let articleAfter = JSRegex.make(#"^(?:once|twice|times?|half|quarter|per|every|each|and)$"#, "i")
    private static let spaceRun = JSRegex.make(#"\s+"#, "")
    private static let fractionSlash = JSRegex.make("[⁄∕]", "u")
    private static let thousandsComma = try! NSRegularExpression(pattern: ",(?=[0-9]{3}(?![A-Za-z0-9_]))")
    private static let trailingNonDigits = JSRegex.make(#"[^0-9]+$"#, "")

    struct Pair: Equatable { let value: String; let unit: String?; let context: [String] }

    /// Each number in `text` with the kind of unit right after it, and the naming words just before it (numberUnits with
    /// languages ["English"]).
    static func numberUnits(_ text: String) -> [Pair] {
        let toks = JSRegex.all(tokens, text).map { (text as NSString).substring(with: $0.range) }
        var pairs: [Pair] = []
        func isNumberTok(_ t: String?) -> Bool {
            guard let t else { return false }
            return Regexes.test(startsDigit, t) || !englishNumbers(t).isEmpty
        }
        func ctxBefore(_ i: Int, _ cls: String?) -> [String] {
            var out: [String] = []
            var k = i - 1
            while k >= 0 && out.count < 3 {
                defer { k -= 1 }
                let t = toks[k]
                if Regexes.test(startsDigit, t) { break }
                let w = t.lowercased()
                let u = unitClass(w)
                if (u != nil && (u == cls || cls == nil)) || contextStop.contains(w) { continue }
                if !englishNumbers(w).isEmpty { break }
                out.append(nameOf(w, prev: k > 0 ? toks[k - 1] : nil, next: k + 1 < toks.count ? toks[k + 1] : nil))
            }
            return out
        }
        func unitAfter(_ i: Int) -> String? {
            var k = i + 1
            while k <= i + 3 && k < toks.count {
                if let c = unitClass(toks[k]) { return c }
                if isNumberTok(toks[k]) { return nil }
                k += 1
            }
            return nil
        }
        func push(_ v: String, _ c: String?, _ i: Int) { pairs.append(Pair(value: v, unit: c, context: ctxBefore(i, c))) }

        for i in toks.indices {
            let tok = toks[i]
            let next: String? = i + 1 < toks.count ? toks[i + 1] : nil
            if Regexes.test(clockTok, tok) || Regexes.test(phoneTok, tok) {
                let parts = JSRegex.split(tok, on: ":.-")
                for (k, part) in parts.enumerated() {
                    push(part, tok.contains(":") ? (k == 0 ? "clock" : "clockmin") : "phone", i)
                }
                continue
            }
            if Regexes.test(halfWord, tok) || Regexes.test(quarterWord, tok) {
                push(Regexes.test(halfWord, tok) ? "1/2" : "1/4", unitAfter(i) ?? "portion", i)
                continue
            }
            var value: String?
            var cls: String?
            if Regexes.test(ordinalTok, tok) {
                value = Regexes.replaceAll(trailingNonDigits, in: tok, with: "")
                cls = "ordinal"
            } else if Regexes.test(startsDigit, tok) {
                var v = Regexes.replaceAll(spaceRun, in: tok, with: "")
                v = Regexes.replaceAll(fractionSlash, in: v, with: "/")
                v = Regexes.replaceAll(thousandsComma, in: v, with: "")
                value = v
                cls = unitAfter(i)
            } else if Regexes.test(onceTwice, tok) {
                value = tok.lowercased() == "once" ? "1" : "2"
                cls = "times"
            } else {
                let prev = i > 0 ? toks[i - 1] : ""
                if Regexes.test(articleTok, tok) && Regexes.test(articleAfter, prev) { continue }
                if Regexes.test(articleTok, tok) && Regexes.test(nameBeforeLetter, prev.lowercased()) { continue }
                let both = englishNumbers("\(tok) \(next ?? "")")
                if both.count == 1 && englishNumbers(next ?? "").isEmpty { value = both[0] }
                if value != nil { cls = unitAfter(i) }
            }
            guard let value else { continue }
            push(value, cls, i)
        }
        return pairs
    }

    struct Reading: Equatable {
        let value: String
        let unit: String
        let previously: Bool
        let names: [String]
    }

    /// doseReadings: every dose amount on the line (mass, dose count or volume), with the words that name what it is for.
    static func doseReadings(_ text: String) -> [Reading] {
        let doseUnits: Set<String> = ["mass", "dose", "volume"]
        return numberUnits(readable(text)).compactMap { p in
            guard let unit = p.unit, doseUnits.contains(unit), Regexes.test(startsDigit, p.value) else { return nil }
            return Reading(value: p.value, unit: unit, previously: p.context.contains("previously"),
                           names: p.context.filter { !aliasNames.contains($0) && unitClass($0) == nil })
        }
    }
}

import Foundation

/// "Your medicine changes": every medicine step sorted into STOP, CHANGE, START (and KEEP when the paper says to
/// continue), read from the PAPER'S OWN WORDS only. Pure, no AI. A line-for-line port of web/src/lib/medicineChanges.ts
/// with the same pattern text; MedicineChangesTests replays mobile/shared/medicine-changes-vectors.json, the cases the
/// website's own suite replays.
///
/// - STOP only when the "Right away" stop rule (StepsWhen.stopNowFromPaper) also says so, so the card never shows a Stop
///   the list does not. A stop line the card is unsure of goes to "Ask your pharmacist", still on the card.
/// - Anything the words do not settle goes to "Ask your pharmacist", never to a guessed row: a negated action, a
///   condition or a later moment, a description or history, a hold, two different actions on one line, a line that
///   disagrees with its heading, a stop word the stop rule does not accept, or no action word at all.
/// - A CHANGE row shows the old and new dose only when both are written in the quote and every check agrees (see
///   doseChange). The doses shown are the paper's characters, copied, never computed.
///
/// NATIVE-SPEAKER REVIEW NEEDED for every non-English list, as on the website; Amharic is the least certain.
enum MedicineChanges {
    enum Row: String, CaseIterable, Sendable { case stop, change, start, keep, ask }

    /// MED_ROW_LABEL in medicineChanges.ts.
    static func label(_ row: Row) -> String {
        switch row {
        case .stop: "Stop"
        case .change: "Change"
        case .start: "Start"
        case .keep: "Keep taking"
        case .ask: "Ask your pharmacist"
        }
    }

    struct Dose: Equatable, Sendable { let was: String; let now: String }

    struct Change: Equatable, Sendable, Identifiable {
        let id: String
        let row: Row
        /// Why it went there (MedReason). Tests read it; the screen does not show it.
        let reason: String
        /// The medicine's name as the paper writes it at the start of the line, or nil.
        let name: String?
        /// The verified quote, with runs of spaces as one.
        let quote: String
        let dose: Dose?
    }

    // MARK: Word lists

    private static let S = #"\s+"#
    /// Whole-word alternatives with letter-aware edges (English, Spanish, French, Vietnamese).
    private static func edged(_ src: String) -> NSRegularExpression {
        JSRegex.make(#"(?<![\p{L}\p{N}\p{M}])(?:"# + src + #")(?![\p{L}\p{N}\p{M}])"#)
    }
    /// Substring alternatives (Korean, Chinese, Amharic).
    private static func bare(_ src: String) -> NSRegularExpression { JSRegex.make(src) }

    struct Lists {
        let start, change, keep, hold, neg, cond, history: NSRegularExpression
    }

    private static let en = Lists(
        start: edged("start|started|starting|begin|begins|beginning|restart|resume|new\(S)(?:medicines?|medications?|prescriptions?)"),
        change: edged([
            "(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?\(S)(?:(?:your|the|this)\(S))?(?:dose|dosage|how\(S)you\(S)take)",
            "dose\(S)(?:was\(S)|is\(S))?(?:increased|decreased|changed|reduced|lowered|adjusted)|new\(S)dose|previously|formerly",
            "(?:changed?|switch(?:ed)?)\(S)to",
            "(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?(?:\(S)[\\p{L}()]+){1,2}\(S)(?:dose|dosage)",
            "(?:increase|decrease|reduce|lower|raise)[sd]?(?:\(S)[\\p{L}()]+){0,3}\(S)to\(S)\\d",
        ].joined(separator: "|")),
        keep: edged("continue|continuing|keep\(S)(?:taking|using)"),
        hold: edged("hold|held|holding|pause|paused|temporarily"),
        neg: edged("(?:do\(S)not|don['’]t|never|not|no\(S)longer)(?:\(S)\\p{L}+){0,2}\(S)(?:stop|discontinue|start|begin|increase|decrease|reduce|lower|raise|change|continue|restart|resume|keep|hold|switch)|no\(S)changes?|no\(S)need\(S)to|need\(S)not|needn['’]t|not\(S)necessary|unnecessary|without\(S)stopping"),
        cond: edged("if|unless|in\(S)case|until|when|whenever|while|after(?!\(S)(?:meals?|breakfast|lunch|dinner|supper|eating|food))|before(?!\(S)(?:meals?|breakfast|lunch|dinner|supper|eating|food|bed|bedtime|sleep))"),
        history: edged("you(?:\(S)have)?\(S)(?:stopped|started|began|took|were|used)|last\(S)(?:year|month|week)|ago|already|in\(S)the\(S)past|may|might|could|yesterday"
            + "|(?:was|were|has\(S)been|have\(S)been|had\(S)been)\(S)(?:\\p{L}+\(S))?(?:started|stopped|discontinued|increased|decreased|changed|reduced|lowered|raised|adjusted|begun|held)|(?:19|20)\\d\\d(?!\(S)?(?:mg|mcg|units?|iu|ml|g)(?![\\p{L}]))")
    )
    private static let es = Lists(
        start: edged("empiece|empezar|comience|comenzar|inicie|iniciar|reanude|reanudar|reinicie|reiniciar|vuelva\(S)a\(S)(?:tomar|empezar)|nuevos?\(S)medicamentos?|nuevas?\(S)medicinas?"),
        change: edged("(?:aumente|disminuya|reduzca|baje|cambie|ajuste)(?:\(S)(?:la|su))?\(S)dosis|nueva\(S)dosis|anteriormente|cambi[eó]\(S)a"),
        keep: edged("contin[uú]e|continuar|siga\(S)tomando|seguir\(S)tomando"),
        hold: edged("temporalmente|pausa|pause"),
        neg: edged("(?:no|nunca)(?:\(S)\\p{L}+){0,2}\(S)(?:deje|dejar|suspenda|suspender|empiece|empezar|comience|comenzar|inicie|aumente|disminuya|reduzca|cambie|contin[uú]e|reanude)|sin\(S)cambios?|no\(S)(?:hay\(S)(?:necesidad|que)|es\(S)necesario|necesita)"),
        cond: edged("si|a\(S)menos\(S)que|en\(S)caso\(S)de|hasta\(S)que|cuando|mientras|despu[eé]s\(S)de(?!\(S)(?:las\(S))?(?:comidas?|desayun\\p{L}*|cenar?|almorzar|comer))|antes\(S)de(?!\(S)(?:las\(S))?(?:comidas?|desayun\\p{L}*|cenar?|almorzar|comer|acostarse|dormir))"),
        history: edged("puede|pueden|podr[ií]a|el\(S)año\(S)pasado|usted\(S)(?:dej[oó]|empez[oó]|tomaba)|ayer|fue\(S)(?:suspendid[oa]|iniciad[oa]|aumentad[oa]|cambiad[oa]|empezad[oa]|disminuid[oa])")
    )
    private static let fr = Lists(
        start: edged("commencez|commencer|débutez|débuter|reprenez|reprendre|recommencez|recommencer|nouveaux?\(S)médicaments?"),
        change: edged("(?:augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez)\(S)(?:la|votre)\(S)(?:dose|posologie)|nouvelle\(S)dose|auparavant|anciennement"),
        keep: edged("continuez|continuer|poursuivez|poursuivre"),
        hold: edged("temporairement|pause"),
        neg: JSRegex.make("(?<![\\p{L}\\p{N}])(?:ne\(S)(?:\\p{L}+\(S)){0,2}|n['’]\\s*)(?:commencez|augmentez|diminuez|réduisez|changez|modifiez|continuez|poursuivez|reprenez|arrêtez|arretez|cessez|interrompez|suspendez)(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:aucun\(S)changement|pas\(S)(?:nécessaire|besoin)|inutile)(?![\\p{L}\\p{N}])"),
        cond: edged("si|s['’]ils?|sauf\(S)si|en\(S)cas|jusqu['’]à|quand|lorsque|lorsqu['’]\\p{L}+|pendant\(S)que|après(?!\(S)(?:les\(S))?(?:repas|manger))|avant(?!\(S)(?:les\(S))?(?:repas|manger|le\(S)coucher|de\(S)dormir))"),
        history: edged("peut|peuvent|pourrait|l['’]an\(S)dernier|vous\(S)avez\(S)(?:arrêté|commencé|pris)|hier|a\(S)été\(S)(?:arrêtée?|commencée?|augmentée?|modifiée?|diminuée?)")
    )
    private static let vi = Lists(
        start: edged("bắt\(S)đầu|thuốc\(S)mới|dùng\(S)lại|uống\(S)lại"),
        change: edged("tăng\(S)liều|giảm\(S)liều|đổi\(S)liều|thay\(S)đổi\(S)liều|điều\(S)chỉnh\(S)liều|liều\(S)mới|đổi\(S)sang|trước\(S)đây"),
        keep: edged("tiếp\(S)tục|vẫn\(S)(?:dùng|uống)"),
        hold: edged("tạm\(S)(?:ngưng|ngừng|dừng|thời)"),
        neg: edged("(?:không|đừng|chớ)(?:\(S)\\p{L}+){0,3}\(S)(?:ngưng|ngừng|dừng|bắt\(S)đầu|tăng|giảm|đổi|tiếp\(S)tục)|không\(S)thay\(S)đổi|không\(S)cần"),
        // A look-behind needs a bounded length here; the text has runs of spaces as one by then, so \s{1,9} reads the same.
        cond: edged("nếu|trừ\(S)khi|trường\(S)hợp|cho\(S)đến\(S)khi|(?:sau|trước)\(S)khi(?!\(S)(?:ăn|ngủ))|(?<!(?:sau|trước)\\s{1,9})khi"),
        history: edged("có\(S)thể|năm\(S)ngoái|hôm\(S)qua|đã\(S)được|đã\(S)(?:ngưng|ngừng|dừng|bắt\(S)đầu|uống|dùng)")
    )
    private static let ko = Lists(
        start: bare(#"시작|새로\s*처방|새\s*약|새로운\s*약|재개"#),
        change: bare(#"증량|감량|용량\s*(?:을\s*)?(?:늘리|늘려|줄이|줄여|변경|조정)|이전\s*용량|(?:으로|로)\s*변경"#),
        keep: bare("계속"),
        hold: bare(#"일시\s*중단|잠시\s*중단|일시적으로"#),
        neg: bare(#"(?:중단|중지|멈추|끊|시작|증량|감량|늘리|줄이|변경|계속)\p{L}*?지\s*(?:마|말|않)|변경\s*없|필요\s*(?:가|는)?\s*없|않아도"#),
        cond: bare(#"경우|만약|만일|때까지|(?<!식)후|(?<!식)전에|때(?!문)"#),
        history: bare(#"수\s*있|작년|어제"#)
    )
    private static let zh = Lists(
        start: bare("开始|開始|新药|新藥|新处方|新處方|加用|恢复服用|恢復服用|重新服用"),
        change: bare("增加剂量|增加劑量|剂量增加|劑量增加|减少剂量|減少劑量|剂量减少|劑量減少|加量|减量|減量|改为|改為|改成|调整剂量|調整劑量|更改剂量|更改劑量|增至|减至|減至|原来|原來|此前"),
        keep: bare("继续|繼續"),
        hold: bare("暂停|暫停|暂时|暫時"),
        neg: bare(#"(?:不要|不可|不能|不得|请勿|請勿|勿|别|別|切勿)\p{L}{0,6}?(?:停|开始|開始|增加|减少|減少|加量|减量|減量|改|继续|繼續|恢复|恢復)|不变|不變|不需要|不必|无需|無需|不用"#),
        cond: bare(#"如果|如若|假如|一旦|如有|直到|(?<![\p{L}])若|(?<![饭飯餐])[后後]|之前|以前|(?<![小暂暫同按及准準])[时時]"#),
        history: bare("可能|去年|昨天|曾经|曾經|已经|已經|已于|已於")
    )
    private static let am = Lists(
        start: bare(#"ይጀምሩ|ጀምሩ|አዲስ\s*መድ[ሀሃሐ]ኒት|አዲስ\s*መድኃኒት|እንደገና"#),
        change: bare("ይጨምሩ|ይቀንሱ|ይቀይሩ"),
        keep: bare("ይቀጥሉ"),
        hold: bare("ለጊዜው"),
        neg: bare("አይጀምሩ|አይጨምሩ|አይቀንሱ|አይቀይሩ|አያቁሙ|አያቋርጡ|አይቀጥሉ|አያስፈልግም"),
        cond: bare("ከሆነ|ካለብዎት|ካጋጠመዎት|ቢያጋጥምዎ|እስከ|በኋላ|በፊት"),
        history: bare("ይችላል|ትናንት")
    )
    private static let langLists: [Lists] = [en, es, fr, vi, ko, zh, am]

    /// Stop words of all seven languages (the very patterns StepsWhen and SafetyWords use).
    private static let stopWords: [NSRegularExpression] = [
        SafetyPatterns.STOP, SafetyPatterns.STOP_VI, SafetyPatterns.STOP_FR, SafetyPatterns.STOP_KO,
        SafetyPatterns.STOP_ZH, SafetyPatterns.STOP_AM,
    ].map { $0.regex() }

    /// "from 10 mg to 20 mg" in the Latin-script languages; the doses must carry the same unit word.
    private static let amount = #"(?<![\d.,])(\d+(?:[.,]\d+)?\s*(mg|mcg|µg|g|ml|units?|unidades?|unités?|đơn\s+vị|IU|UI)(?![\p{L}\p{M}]))"#
    private static let amountRe = JSRegex.make(amount, "giu")
    private static let fromTo = JSRegex.make(#"(?<![\p{L}\p{N}])(?:from|de|desde|từ)\s+"# + amount + #"\s+(?:to|a|hasta|à|lên|xuống|thành|đến|tới)\s+"# + amount + #"(?![\p{L}\p{N}])"#, "giu")
    /// "Previously 10 mg" (English): the paper's own word for the old dose.
    private static let previously = JSRegex.make(#"(?<![\p{L}\p{N}])(?:previously|formerly)[:,]?\s+"# + amount + #"(?![\p{L}\p{N}])"#, "giu")

    /// A verb that changes a dose. A "from 10 mg to 20 mg" counts as a change only next to one.
    private static let changeVerbSource = #"(?<![\p{L}\p{N}\p{M}])(?:increase[sd]?|decrease[sd]?|reduce[sd]?|lower(?:ed)?|raise[sd]?|change[sd]?|switch(?:ed)?|adjust(?:ed)?|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|thay\s+đổi|điều\s+chỉnh)(?![\p{L}\p{N}\p{M}])"#
    private static let changeVerb = JSRegex.make(changeVerbSource)
    /// The verb must GOVERN the from-to: it opens the clause, with at most five words before "from", none of them range
    /// words ("strengths range from 10 mg to 20 mg" is a description, not a change).
    private static let governs = JSRegex.make(#"^(?:[-*•‣–]\s*)?(?:"# + changeVerbSource + #")((?:\s+[\p{L}\p{M}()'’-]+){0,5})\s*$"#)
    private static let rangeWords = edged("ranges?|ranging|across|between|strengths?|available|rango|entre|disponibles?|gamme|khoảng")

    private static let spaceRun = JSRegex.make(#"\s+"#, "")

    /// NFC, runs of spaces as one, trimmed.
    static func prepare(_ t: String) -> String { StepsWhen.trim(StepsWhen.spaces(t.precomposedStringWithCanonicalMapping)) }

    private static func fromToWithVerb(_ t: String) -> [NSTextCheckingResult] {
        let ns = t as NSString
        let ends = [".", ";", ":", "!", "?", ",", "(", "\n", "。", "；", "："]
        return JSRegex.all(fromTo, t).filter { m in
            let before = ns.substring(to: m.range.location) as NSString
            let cut = ends.map { before.range(of: $0, options: .backwards).location }.map { $0 == NSNotFound ? -1 : $0 }.max() ?? -1
            let clause = StepsWhen.trim(before.substring(from: cut + 1))
            guard let g = JSRegex.first(governs, clause) else { return false }
            return !Regexes.test(rangeWords, JSRegex.group(g, 1, in: clause) ?? "")
        }
    }

    /// A negation earlier in the same clause than the first action word ("No need to stop", "不需要停止").
    private static let negToken = JSRegex.make(#"(?<![\p{L}])(?:not|no|never|without|nunca|sin|ne|pas|jamais|sans|không|đừng|chớ|chưa)(?![\p{L}])|n['’]|[不别別勿无無未没沒]"#, "giu")

    private static func negatedBeforeAction(_ t: String, actions: [NSRegularExpression]) -> Bool {
        for clause in JSRegex.split(t, on: ".;:!?,。；：，") {
            let at = actions.compactMap { JSRegex.first($0, clause)?.range.location }.min()
            guard let at else { continue }
            if JSRegex.all(negToken, clause).contains(where: { $0.range.location < at }) { return true }
        }
        return false
    }

    struct Signals: Equatable {
        var stop = false, change = false, start = false, keep = false, hold = false, neg = false, cond = false, history = false
    }

    static func signals(_ text: String) -> Signals {
        let t = prepare(text)
        func any(_ pick: (Lists) -> NSRegularExpression) -> Bool { langLists.contains { Regexes.test(pick($0), t) } }
        let actions = stopWords + langLists.flatMap { [$0.start, $0.change, $0.keep, $0.hold] } + [changeVerb]
        // A negation, condition, hold or history word changes an action only in the sentence that holds the action.
        let sentences = JSRegex.split(t, on: ".;!?。；\n").filter { x in
            actions.contains { Regexes.test($0, x) } || !fromToWithVerb(x).isEmpty
        }
        func inAction(_ pick: (Lists) -> NSRegularExpression) -> Bool {
            sentences.contains { x in langLists.contains { Regexes.test(pick($0), x) } }
        }
        var s = Signals()
        s.stop = stopWords.contains { Regexes.test($0, t) }
        s.change = any(\.change) || !fromToWithVerb(t).isEmpty
        s.start = any(\.start)
        s.keep = any(\.keep)
        s.hold = inAction(\.hold)
        s.neg = inAction(\.neg) || negatedBeforeAction(t, actions: actions)
        s.cond = inAction(\.cond)
        s.history = inAction(\.history)
        return s
    }

    private static func rows(_ s: Signals) -> [Row] {
        [(Row.stop, s.stop), (.change, s.change), (.start, s.start), (.keep, s.keep)].filter(\.1).map(\.0)
    }

    /// Which row one medicine step goes in, and why. Non-medicine steps are not sorted (nil).
    static func classify(kind: String, quote: String, span: TextSpan?, paper: String) -> (row: Row, reason: String)? {
        if kind != "medication" { return nil }
        let heading = StepsWhen.listHeadingAny(paper, span: span)
        let q = signals(quote)
        let h: Signals? = heading.isEmpty ? nil : signals(heading)
        let both = [q] + (h.map { [$0] } ?? [])
        if both.contains(where: \.neg) { return (.ask, "negated") }
        if both.contains(where: \.cond) { return (.ask, "conditional") }
        if both.contains(where: \.hold) { return (.ask, "hold") }
        if both.contains(where: \.history) { return (.ask, "not_an_instruction") }
        // A stop word counts only where the "Right away" rule accepts it: every Stop on the card is under "Right away" too.
        if both.contains(where: \.stop) && !StepsWhen.stopNowFromPaper(kind: kind, quote: quote, span: span, paper: paper) {
            return (.ask, "stop_not_now")
        }
        let qr = rows(q)
        let hr = h.map(rows) ?? []
        if qr.count > 1 || hr.count > 1 { return (.ask, "mixed") }
        if qr.count == 1 && hr.count == 1 && qr[0] != hr[0] { return (.ask, "heading_disagrees") }
        if qr.count == 1 { return (qr[0], hr.isEmpty ? "words" : "words_and_heading") }
        if hr.count == 1 { return (hr[0], "heading") }
        return (.ask, "no_action_words")
    }

    // MARK: Doses

    /// Words that may follow a dose without naming what it is for ("20 mg total", "10 mg once daily").
    private static let afterDoseOK = Set((
        "tablet tablets tab tabs pill pills capsule capsules total by mouth orally po once twice daily a an per each every day days " +
        "in the morning evening night bedtime at with meals meal food as needed and for weekly qd bid tid " +
        "tableta tabletas pastilla pastillas cápsula cápsulas al día diario diaria por vía oral boca cada una vez veces con comida comidas " +
        "comprimé comprimés gélule gélules par jour fois une le matin soir avec repas " +
        "viên mỗi ngày lần uống sáng tối"
    ).split(separator: " ").map(String.init))
    /// Words skipped before that check: "20 mg of aspirin" looks at "aspirin".
    private static let afterDoseSkip: Set<String> = ["of", "de", "du", "des", "d", "của"]
    private static let wordRun = JSRegex.make(#"[\p{L}\p{M}]+"#, "gu")
    private static let valueRe = JSRegex.make(#"\d+(?:[.,]\d+)?"#, "")
    private static let leadingNumber = JSRegex.make(#"^[\d.,\s]+"#, "")

    /// True when the words right after this dose (up to the end of its sentence) never name something else.
    private static func nothingNamedAfter(_ text: String, _ end: Int) -> Bool {
        let rest = JSRegex.split((text as NSString).substring(from: end), on: ".;!?\n")[0]
        return JSRegex.all(wordRun, rest).allSatisfy { m in
            let w = (rest as NSString).substring(with: m.range).lowercased()
            return afterDoseSkip.contains(w) || afterDoseOK.contains(w)
        }
    }

    private static func valueOf(_ amount: String) -> String {
        let v = JSRegex.first(valueRe, amount).map { (amount as NSString).substring(with: $0.range) } ?? ""
        guard let comma = v.range(of: ",") else { return v }
        return v.replacingCharacters(in: comma, with: ".")
    }

    private static func unitWord(_ amount: String) -> String {
        Regexes.replaceAll(spaceRun, in: Regexes.replaceAll(leadingNumber, in: amount, with: ""), with: " ").lowercased()
    }

    private static let filler: Set<String> = ["from", "de", "desde", "từ", "previously", "formerly", "increase", "decrease", "reduce",
                                              "change", "to", "a", "à", "hasta", "lên", "xuống", "thành", "đến", "tới"]

    /// The old and new dose, as written in the quote, or nil. Never computed, never filled in from anywhere else.
    static func doseChange(_ quote: String) -> Dose? {
        let t = Regexes.replaceAll(spaceRun, in: quote, with: " ")
        let ft = fromToWithVerb(t)
        let prev = JSRegex.all(previously, t)
        if ft.count + prev.count != 1 { return nil }
        var was: String, now: String, nowEnd: Int
        var joined = (-1, -1)
        if ft.count == 1 {
            let m = ft[0]
            was = JSRegex.group(m, 1, in: t) ?? ""
            now = JSRegex.group(m, 3, in: t) ?? ""
            if unitWord(was) != unitWord(now) { return nil }
            nowEnd = m.range.location + m.range.length
            joined = (m.range.location, nowEnd)
        } else {
            was = JSRegex.group(prev[0], 1, in: t) ?? ""
            // The new dose: the one other value with the same unit word on the line, written out.
            let unit = unitWord(was)
            let others = JSRegex.all(amountRe, t).filter { m in
                let a = JSRegex.group(m, 1, in: t) ?? ""
                return unitWord(a) == unit && valueOf(a) != valueOf(was)
            }
            if Set(others.map { valueOf(JSRegex.group($0, 1, in: t) ?? "") }).count != 1 { return nil }
            now = JSRegex.group(others[0], 1, in: t) ?? ""
            nowEnd = others[0].range.location + others[0].range.length
        }
        if valueOf(was) == valueOf(now) { return nil }
        if !nothingNamedAfter(t, nowEnd) { return nil }
        // The meaning check's own reading: exactly these two values of that kind of dose on the line, and their naming
        // words do not point at two different medicines.
        let readings = DoseReadings.doseReadings(t)
        func dot(_ s: String) -> String { s.range(of: ",").map { s.replacingCharacters(in: $0, with: ".") } ?? s }
        let wasR = readings.filter { dot($0.value) == valueOf(was) }
        let nowR = readings.filter { dot($0.value) == valueOf(now) }
        // The new dose written once: two medicines on the same new value can't be told apart.
        if wasR.isEmpty || nowR.count != 1 { return nil }
        let unitKind = nowR[0].unit
        if wasR.contains(where: { $0.unit != unitKind }) || nowR.contains(where: { $0.unit != unitKind }) { return nil }
        if Set(readings.filter { $0.unit == unitKind }.map { dot($0.value) }).count != 2 { return nil }
        // Each dose also must not be followed by a name, and the words before them must agree.
        func names(_ rs: [DoseReadings.Reading]) -> Set<String> { Set(rs.flatMap(\.names).filter { !filler.contains($0) }) }
        let a = names(wasR), b = names(nowR)
        if !a.isEmpty && !b.isEmpty && a.isDisjoint(with: b) { return nil }
        for m in JSRegex.all(amountRe, t) {
            let at = m.range.location
            if at >= joined.0 && at < joined.1 { continue }
            if !nothingNamedAfter(t, at + m.range.length) { return nil }
        }
        return Dose(was: StepsWhen.trim(was), now: StepsWhen.trim(now))
    }

    // MARK: The medicine's name

    /// Words that mean the start of a line is an instruction, not a medicine's name.
    private static let instruction = JSRegex.make(#"(?<![\p{L}])(?:take|takes|taking|tome|tomar|prenez|prendre|uống|dùng|use|apply|increase|decrease|reduce|lower|raise|adjust|change|switch|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|from|desde|từ|to|dose|dosis|liều)(?![\p{L}])|복용|드시|용량|服用|剂量|劑量|ይውሰዱ"#)
    private static let nameAtStart = JSRegex.make(#"^([\p{L}][\p{L}\p{M}\s()'’/.-]*?)\s*\d"#, "u")
    private static let nameTail = JSRegex.make(#"[\s,:;-]+$"#, "u")

    /// The medicine's name as the paper writes it: the words at the very start of the quote, up to its first number.
    /// Nil when the line starts with an instruction instead, or the start is too long to be a name. Copied, never rewritten.
    static func medicineName(_ quote: String) -> String? {
        let t = StepsWhen.trim(StepsWhen.spaces(quote))
        guard let m = JSRegex.first(nameAtStart, t), let raw = JSRegex.group(m, 1, in: t) else { return nil }
        let name = Regexes.replaceAll(nameTail, in: StepsWhen.trim(raw), with: "")
        if name.isEmpty || (name as NSString).length > 48 || name.components(separatedBy: " ").count > 6 { return nil }
        let s = signals(name)
        if s.stop || s.change || s.start || s.keep || s.hold || Regexes.test(instruction, name) { return nil }
        return name
    }

    // MARK: The card

    static func change(id: String, kind: String, quote: String, span: TextSpan?, paper: String) -> Change? {
        guard let c = classify(kind: kind, quote: quote, span: span, paper: paper) else { return nil }
        return Change(id: id, row: c.row, reason: c.reason, name: medicineName(quote),
                      quote: StepsWhen.trim(StepsWhen.spaces(quote)), dose: c.row == .change ? doseChange(quote) : nil)
    }

    static func change(_ it: VerifiedItem, paper: String) -> Change? {
        change(id: it.id, kind: it.kind, quote: it.source_quote, span: it.span, paper: paper)
    }

    /// Every medicine step, by row (Stop first), in paper order inside each row. Rows with nothing are left out.
    static func groups(_ items: [VerifiedItem], paper: String) -> [RowGroup] {
        let all = items.compactMap { change($0, paper: paper) }
        return Row.allCases.compactMap { row in
            let list = all.filter { $0.row == row }
            return list.isEmpty ? nil : RowGroup(row: row, list: list)
        }
    }

    struct RowGroup: Identifiable, Sendable {
        let row: Row
        let list: [Change]
        var id: Row { row }
    }

    /// "was 10 mg, now 20 mg": the words a screen reader hears, not a strike-through.
    static func doseWords(_ d: Dose) -> String { "was \(d.was), now \(d.now)" }
}

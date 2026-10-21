import Foundation

/// Pip, the "you are here" marker on a plan (Akhil's design: a Georgia peach shaped like a map pin). Pure rules, no AI.
/// A port of web/src/lib/pip.ts; PipTests replays mobile/shared/pip-vectors.json, the website's own answers.
///
/// - Pip sits in a reserved spot on the trailing edge of the card for the step that matters now, and never covers text.
/// - The step that matters now is the first step not yet done, in the order the groups are shown (earliest group first).
/// - Pip is quiet around medicine, warning signs and lab tests: no motion, no bubble, no cheer on those cards. A step a
///   check disagreed with is quiet too, so a cheer or a bubble never reads as an endorsement of it.
/// - What Pip says is a short FIXED line from the table below, never AI text, and never a medical suggestion.
/// - Pip is one character: exactly one on screen whenever there are steps.
enum Pip {
    enum Line: String, Sendable, CaseIterable, Decodable { case start, done, next, allDone }
    enum Mood: String, Sendable, Decodable { case arrive, cheer, quiet }

    /// Every line Pip can say, per app language, copied exactly from PIP_LINES in web/src/lib/pip.ts.
    /// Written by the team, not by a model at runtime. NATIVE REVIEW NEEDED for every language but English (Amharic
    /// most of all), as on the website.
    static let lines: [Language: [Line: String]] = [
        .English: [.start: "Start here", .done: "Nice, that's done", .next: "Next up", .allDone: "All done for now"],
        // NATIVE REVIEW NEEDED (Spanish).
        .Spanish: [.start: "Empiece aquí", .done: "Bien, ya está hecho", .next: "Lo siguiente", .allDone: "Todo listo por ahora"],
        // NATIVE REVIEW NEEDED (Vietnamese).
        .Vietnamese: [.start: "Bắt đầu ở đây", .done: "Tốt lắm, đã xong", .next: "Tiếp theo", .allDone: "Tạm thời đã xong hết"],
        // NATIVE REVIEW NEEDED (Korean).
        .Korean: [.start: "여기서 시작하세요", .done: "잘했어요, 끝났어요", .next: "다음 차례", .allDone: "지금은 모두 끝났어요"],
        // NATIVE REVIEW NEEDED (Chinese, Simplified).
        .Chinese: [.start: "从这里开始", .done: "很好，完成了", .next: "下一步", .allDone: "目前都完成了"],
        // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
        .Amharic: [.start: "ከዚህ ይጀምሩ", .done: "ጥሩ፣ ተጠናቋል", .next: "ቀጣዩ", .allDone: "ለአሁን ሁሉም ተጠናቋል"],
        // NATIVE REVIEW NEEDED (French).
        .French: [.start: "Commencez ici", .done: "Bien, c'est fait", .next: "Ensuite", .allDone: "Tout est fait pour l'instant"],
    ]

    /// Pip's line in the person's language (English when a line is missing, as on the website).
    static func line(_ language: Language, _ line: Line) -> String {
        lines[language]?[line] ?? lines[.English]![line]!
    }

    /// Kinds of step Pip stays quiet on: medicine, lab tests and warning signs.
    static let quietKinds: Set<String> = ["medication", "lab_test", "warning_sign"]

    /// True when Pip must be quiet on this step: no motion, no bubble, no cheer.
    static func quiet(kind: String, check: Check) -> Bool { quietKinds.contains(kind) || check == .flagged }

    struct Step: Sendable, Equatable { let id: String; let kind: String }

    /// Where Pip is and what he says (PipSpot in pip.ts).
    enum Spot: Sendable, Equatable {
        case step(id: String, mood: Mood, line: Line?)
        /// Every step done: "All done for now" at the heading.
        case header
        /// First view when the current step is quiet: "Start here" once at the heading, pointing down at the list.
        /// Pip is one character, so the card (`id`) shows no Pip meanwhile: its slot stays reserved and empty.
        case greet(id: String)
        case none

        var isGreet: Bool { if case .greet = self { true } else { false } }

        var line: Line? {
            switch self {
            case .step(_, _, let line): line
            case .header: .allDone
            case .greet: .start
            case .none: nil
            }
        }
    }

    /// The step that matters now: the first not done, in the order shown. Nil when every step is done or there are none.
    static func currentStepId(_ ordered: [Step], done: [String: Bool]) -> String? {
        ordered.first { done[$0.id] != true }?.id
    }

    /// Decides Pip's spot (pipSpot in pip.ts). `cheering` is a step the person just marked done; while it is set and still
    /// done, Pip cheers there, then moves on. Quiet steps never get a cheer and never get a line. `greet`: whether the
    /// heading greeting is still allowed (see `greetAllowed`).
    static func spot(_ ordered: [Step], done: [String: Bool], check: (String) -> Check, cheering: String?, greet: Bool = true) -> Spot {
        if ordered.isEmpty { return .none }
        if let cheering, let s = ordered.first(where: { $0.id == cheering }), done[s.id] == true, !quiet(kind: s.kind, check: check(s.id)) {
            return .step(id: s.id, mood: .cheer, line: .done)
        }
        guard let id = currentStepId(ordered, done: done), let step = ordered.first(where: { $0.id == id }) else { return .header }
        let anyDone = ordered.contains { done[$0.id] == true }
        if quiet(kind: step.kind, check: check(id)) {
            return greet && !anyDone ? .greet(id: id) : .step(id: id, mood: .quiet, line: nil)
        }
        return .step(id: id, mood: .arrive, line: anyDone ? .next : .start)
    }

    /// The greeting is a first view only: off for good once any step was marked done on this screen (`greetOver`), and off
    /// when the saved record has any done mark, including one on a step since removed (CareSteps.tsx).
    static func greetAllowed(greetOver: Bool, done: [String: Bool]) -> Bool {
        !greetOver && !done.values.contains(true)
    }

    /// Where the one Pip is drawn: on a card only for a step spot, at the heading for the greeting and for all done.
    struct Drawn: Sendable, Equatable {
        struct Card: Sendable, Equatable { let id: String; let mood: Mood; let line: Line? }
        let card: Card?
        let heading: Mood?
        var count: Int { (card == nil ? 0 : 1) + (heading == nil ? 0 : 1) }
    }

    static func drawn(_ spot: Spot) -> Drawn {
        switch spot {
        case .step(let id, let mood, let line): Drawn(card: .init(id: id, mood: mood, line: line), heading: nil)
        case .header, .greet: Drawn(card: nil, heading: .arrive)
        case .none: Drawn(card: nil, heading: nil)
        }
    }

    /// What the screen reader hears is keyed on where Pip is too, not only on the words: two steps cheered one after the
    /// other both say "Nice, that's done", and the second must still be read. The greeting shares the key of the same
    /// step's own "Start here", so a late check that turns that step quiet moves the words without reading them twice.
    static func announceKey(_ spot: Spot) -> String {
        switch spot {
        case .step(let id, let mood, _): "\(id):\(mood.rawValue)"
        case .greet(let id): "\(id):arrive"
        case .header: "header"
        case .none: "none"
        }
    }

    /// How Pip moves (globals.css on the website). Quiet never moves. Calm mode (Reduce Motion, or the in-app toggle)
    /// fades instead of hopping or bouncing, and turns the blink off.
    enum Motion: Sendable, Equatable { case hop, bounce, fade, still }

    static func motion(_ mood: Mood, calm: Bool) -> Motion {
        if mood == .quiet { return .still }
        if calm { return .fade }
        return mood == .cheer ? .bounce : .hop
    }

    static func blinks(_ mood: Mood, calm: Bool) -> Bool { !calm && mood != .quiet }

    /// The rig's blink over 4.2 s (Akhil's keyframes): eyes open at 0% and 94%, shut to 0.1 at 97%, open again at 100%.
    static func blinkScale(at seconds: Double) -> Double {
        let period = 4.2
        let p = (seconds.truncatingRemainder(dividingBy: period) + period).truncatingRemainder(dividingBy: period) / period
        if p < 0.94 { return 1 }
        if p < 0.97 { return 1 - 0.9 * (p - 0.94) / 0.03 }
        return 0.1 + 0.9 * (p - 0.97) / 0.03
    }

    /// Calm mode is on when the system asks for reduced motion or the person turned the toggle on (saved on this phone).
    static func calm(reduceMotion: Bool, saved: Bool) -> Bool { reduceMotion || saved }

    /// Saved on this phone, the same key as the website's localStorage.
    static let calmKey = "atlas.pipCalm"

    /// How long a cheer stays before Pip moves on (CareSteps.tsx).
    static let cheerSeconds = 1.4
}

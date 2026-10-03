import Foundation

// /api/meaning: the second-model double-check. Source of truth: web/src/lib/meaning.ts (MeaningRequestSchema,
// MeaningResult, MeaningResponse) and web/src/lib/meaningRun.ts (what the browser sends).

struct MeaningItem: Codable, Hashable, Sendable {
    let id: String
    let plain_language: String
    let when: String
    let source_quote: String
}

struct MeaningRequest: Codable, Hashable, Sendable {
    /// Left out of the JSON when nil (the server's zod schema accepts a missing language, not null).
    let language: Language?
    let items: [MeaningItem]

    /// The server accepts 1 to 40 items; meaningRun.ts sends the first 40.
    static let maxItems = 40

    /// Same body as runMeaningCheck: the title is checked with the explanation (round 13). Nil when there is nothing to check.
    static func of(_ items: [VerifiedItem], language: Language?) -> MeaningRequest? {
        guard !items.isEmpty else { return nil }
        return MeaningRequest(language: language, items: items.prefix(maxItems).map {
            MeaningItem(id: $0.id, plain_language: PaperFirst.checkedText(title: $0.title, plain: $0.plain_language),
                        when: $0.when, source_quote: $0.source_quote)
        })
    }
}

struct MeaningResult: Codable, Hashable, Sendable {
    let id: String
    let flagged: Bool
    let numbers_ok: Bool
    let unexpected_numbers: [String]
    let model_verdict: String
    let what_differs: String
    /// True only when the second model said "same" AND every number checks out. Only this earns the green check.
    let certified: Bool

    init(id: String, flagged: Bool = false, numbers_ok: Bool = false, unexpected_numbers: [String] = [],
         model_verdict: String = "unclear", what_differs: String = "", certified: Bool = false) {
        self.id = id; self.flagged = flagged; self.numbers_ok = numbers_ok; self.unexpected_numbers = unexpected_numbers
        self.model_verdict = model_verdict; self.what_differs = what_differs; self.certified = certified
    }

    enum CodingKeys: String, CodingKey { case id, flagged, numbers_ok, unexpected_numbers, model_verdict, what_differs, certified }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        flagged = try c.decodeIfPresent(Bool.self, forKey: .flagged) ?? false
        numbers_ok = try c.decodeIfPresent(Bool.self, forKey: .numbers_ok) ?? false
        unexpected_numbers = try c.decodeIfPresent([String].self, forKey: .unexpected_numbers) ?? []
        model_verdict = try c.decodeIfPresent(String.self, forKey: .model_verdict) ?? "unclear"
        what_differs = try c.decodeIfPresent(String.self, forKey: .what_differs) ?? ""
        certified = try c.decodeIfPresent(Bool.self, forKey: .certified) ?? false
    }
}

struct MeaningResponse: Codable, Hashable, Sendable {
    let results: [MeaningResult]
    let flagged: Int
    let checker_model: String
    let ms: Int

    enum CodingKeys: String, CodingKey { case results, flagged, checker_model, ms }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        results = try c.decode([MeaningResult].self, forKey: .results)
        flagged = try c.decodeIfPresent(Int.self, forKey: .flagged) ?? 0
        checker_model = try c.decodeIfPresent(String.self, forKey: .checker_model) ?? ""
        ms = try c.decodeIfPresent(Int.self, forKey: .ms) ?? 0
    }
}

enum MeaningStatus: String, Codable, Sendable {
    case idle, loading, done, error
}

/// The double-check as the screen has it. `byId` is only read when status is done.
struct MeaningState: Codable, Hashable, Sendable {
    var status: MeaningStatus = .idle
    var byId: [String: MeaningResult] = [:]

    static let idle = MeaningState()

    /// The check for one step. Anything but a finished check is unchecked, so the paper's words lead.
    func check(for id: String) -> Check {
        status == .done ? PaperFirst.checkOf(byId[id]) : .unchecked
    }

    /// The result to show beside a step, only once the check has finished.
    func result(for id: String) -> MeaningResult? { status == .done ? byId[id] : nil }

    /// Results for ids that were not in the request are dropped, so a reply can never vouch for another step.
    static func done(_ request: MeaningRequest, _ response: MeaningResponse) -> MeaningState {
        let asked = Set(request.items.map(\.id))
        var byId: [String: MeaningResult] = [:]
        // A repeated id keeps the last result, like Object.fromEntries in meaningRun.ts.
        for r in response.results where asked.contains(r.id) { byId[r.id] = r }
        return MeaningState(status: .done, byId: byId)
    }
}

import Foundation

// Codable mirrors of the server types. Source of truth:
//   web/src/lib/schema.ts     (CarePlanResponse, VerifiedItem, RequestSchema)
//   web/src/lib/plan.ts       (PlanRequestSchema, PlanResponse, PlanStep, ResourceCard)
//   web/src/lib/resources.ts  (Clinic, Program, BARRIERS)
// Unknown keys are ignored by JSONDecoder, so extra server fields never break decoding.
// Fields the server fills with zod defaults are decoded leniently.

// MARK: - Shared enums

enum ItemKind: String, Codable, CaseIterable, Sendable {
    case medication, lab_test, referral, follow_up_visit, self_care, warning_sign
}

enum ReadingLevel: String, Codable, CaseIterable, Sendable, Identifiable {
    case simple, standard, detailed
    var id: String { rawValue }
}

enum Language: String, Codable, CaseIterable, Sendable, Identifiable {
    case English, Spanish, Vietnamese, Korean, Chinese, Amharic, French
    var id: String { rawValue }
}

/// Mirrors BARRIERS + BARRIER_LABEL in web/src/lib/resources.ts, in the same order.
enum Barrier: String, Codable, CaseIterable, Sendable, Identifiable {
    case transport, cost, insurance, language, schedule, tech, referrals, food, housing
    var id: String { rawValue }

    var label: String {
        switch self {
        case .transport: "Getting there (no car, long bus ride)"
        case .cost: "Paying for the visit, lab or medicine"
        case .insurance: "No insurance, or not sure what's covered"
        case .language: "I'd rather get help in another language"
        case .schedule: "Time off work, clinic hours"
        case .tech: "No reliable phone or internet"
        case .referrals: "Not sure how referrals or labs work"
        case .food: "Having enough food"
        case .housing: "A safe, steady place to stay"
        }
    }
}

// MARK: - /api/extract

struct ExtractRequest: Encodable, Sendable {
    let text: String
    let reading_level: ReadingLevel
    let language: Language
}

struct TextSpan: Codable, Hashable, Sendable {
    let start: Int
    let end: Int
}

struct VerifiedItem: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let title: String
    let plain_language: String
    let why: String
    let when: String
    let source_quote: String
    let needs_clarification: Bool
    let question_for_clinic: String
    let grounded: Bool
    let span: TextSpan?

    var itemKind: ItemKind? { ItemKind(rawValue: kind) }

    init(id: String, kind: String, title: String, plain_language: String, why: String = "", when: String = "",
         source_quote: String, needs_clarification: Bool = false, question_for_clinic: String = "",
         grounded: Bool = true, span: TextSpan? = nil) {
        self.id = id; self.kind = kind; self.title = title; self.plain_language = plain_language
        self.why = why; self.when = when; self.source_quote = source_quote
        self.needs_clarification = needs_clarification; self.question_for_clinic = question_for_clinic
        self.grounded = grounded; self.span = span
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, title, plain_language, why, when, source_quote, needs_clarification, question_for_clinic, grounded, span
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        plain_language = try c.decode(String.self, forKey: .plain_language)
        why = try c.decodeIfPresent(String.self, forKey: .why) ?? ""
        when = try c.decodeIfPresent(String.self, forKey: .when) ?? ""
        source_quote = try c.decode(String.self, forKey: .source_quote)
        needs_clarification = try c.decodeIfPresent(Bool.self, forKey: .needs_clarification) ?? false
        question_for_clinic = try c.decodeIfPresent(String.self, forKey: .question_for_clinic) ?? ""
        grounded = try c.decodeIfPresent(Bool.self, forKey: .grounded) ?? false
        span = try c.decodeIfPresent(TextSpan.self, forKey: .span)
    }
}

struct CareStats: Codable, Hashable, Sendable {
    let extracted: Int
    let grounded: Int
    let refused: Int
    let ms: Int
}

struct CarePlanResponse: Codable, Hashable, Sendable {
    let source_text: String
    let source_kind: String
    let items: [VerifiedItem]
    let refused: [VerifiedItem]
    let questions_for_doctor: [String]
    let not_in_document: [String]
    let has_warning_signs: Bool
    /// The language the explanations were written in (sent back to the meaning check). Missing from older servers
    /// and from plans saved by older versions of the app (set from the saved language when such a plan is loaded).
    var language: Language?
    let model: String
    let stats: CareStats
    /// The "Lines on your paper we didn't turn into steps" check (MissedLines). Missing from older servers and saved plans.
    let missed_lines: MissedLinesPayload?

    enum CodingKeys: String, CodingKey {
        case source_text, source_kind, items, refused, questions_for_doctor, not_in_document, has_warning_signs, language, model, stats
        case missed_lines
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source_text = try c.decodeIfPresent(String.self, forKey: .source_text) ?? ""
        source_kind = try c.decodeIfPresent(String.self, forKey: .source_kind) ?? "text"
        items = try c.decode([VerifiedItem].self, forKey: .items)
        refused = try c.decodeIfPresent([VerifiedItem].self, forKey: .refused) ?? []
        questions_for_doctor = try c.decodeIfPresent([String].self, forKey: .questions_for_doctor) ?? []
        not_in_document = try c.decodeIfPresent([String].self, forKey: .not_in_document) ?? []
        has_warning_signs = try c.decodeIfPresent(Bool.self, forKey: .has_warning_signs) ?? false
        // An unknown language (a newer server) is left out rather than failing the whole read.
        language = (try? c.decodeIfPresent(Language.self, forKey: .language)) ?? nil
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        stats = try c.decode(CareStats.self, forKey: .stats)
        // Never fails the read: a payload this app cannot read decodes as MissedLinesPayload.unreadable (hidden, invalid).
        missed_lines = (try? c.decodeIfPresent(MissedLinesPayload.self, forKey: .missed_lines)) ?? nil
    }
}

// MARK: - /api/plan

struct PlanCareInput: Encodable, Sendable {
    let id: String
    let kind: String
    let title: String
    let plain_language: String
    let when: String
    let source_quote: String

    init(_ item: VerifiedItem) {
        id = item.id; kind = item.kind; title = item.title
        plain_language = item.plain_language; when = item.when; source_quote = item.source_quote
    }
}

struct LatLng: Codable, Hashable, Sendable {
    let lat: Double
    let lng: Double

    /// The server accepts the US and its territories (PlanRequestSchema: lat -20 to 72, lng -180 to 180).
    var isInServiceArea: Bool { (-20...72).contains(lat) && (-180...180).contains(lng) }
}

struct PlanRequest: Encodable, Sendable {
    let care: [PlanCareInput]
    let barriers: [Barrier]
    let zip: String?
    let location: LatLng?
    let language: Language
    let note: String
}

struct PlanStep: Codable, Hashable, Sendable {
    let title: String
    let action: String
    let why: String
    let barrier: String
    let care_ids: [String]
    let resource_ids: [String]
    let dropped_refs: [String]

    enum CodingKeys: String, CodingKey { case title, action, why, barrier, care_ids, resource_ids, dropped_refs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        action = try c.decodeIfPresent(String.self, forKey: .action) ?? ""
        why = try c.decodeIfPresent(String.self, forKey: .why) ?? ""
        barrier = try c.decodeIfPresent(String.self, forKey: .barrier) ?? ""
        care_ids = try c.decodeIfPresent([String].self, forKey: .care_ids) ?? []
        resource_ids = try c.decodeIfPresent([String].self, forKey: .resource_ids) ?? []
        dropped_refs = try c.decodeIfPresent([String].self, forKey: .dropped_refs) ?? []
    }
}

struct TransitStop: Codable, Hashable, Sendable {
    let name: String
    let stop_id: String
    let meters: Double
}

struct Clinic: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let address: String
    let city: String
    let zip: String
    let phone: String
    let lat: Double
    let lng: Double
    // Shown as extra detail only; optional so a missing field never drops a verified clinic.
    let org: String?
    let county: String?
    let website: String?
    let hours_per_week: Double?
    let setting: String?
    let health_center_type: String?
    let nearest_rail: TransitStop?
    let nearest_bus: TransitStop?
    let barriers: [String]?
    let source_id: String?
}

struct ProgramAccess: Codable, Hashable, Sendable {
    let phone: String?
    let text: String?
    let url: String?
}

struct Program: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let barriers: [String]?
    let access: ProgramAccess
    let languages: [String]?
    let evidence_quote: String
    let source_url: String
    let source_id: String?
    let hours_note: String?
    let language_note: String?
}

/// Discriminated union on "type", like the TypeScript ResourceCard.
enum ResourceCard: Codable, Hashable, Sendable {
    case clinic(id: String, km: Double?, clinic: Clinic)
    case program(id: String, program: Program)

    enum CodingKeys: String, CodingKey { case type, id, km, clinic, program }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        let id = try c.decode(String.self, forKey: .id)
        switch type {
        case "clinic":
            self = .clinic(id: id, km: try c.decodeIfPresent(Double.self, forKey: .km), clinic: try c.decode(Clinic.self, forKey: .clinic))
        case "program":
            self = .program(id: id, program: try c.decode(Program.self, forKey: .program))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown resource type \(type)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .clinic(id, km, clinic):
            try c.encode("clinic", forKey: .type); try c.encode(id, forKey: .id)
            try c.encodeIfPresent(km, forKey: .km); try c.encode(clinic, forKey: .clinic)
        case let .program(id, program):
            try c.encode("program", forKey: .type); try c.encode(id, forKey: .id); try c.encode(program, forKey: .program)
        }
    }
}

struct Located: Codable, Hashable, Sendable {
    let by: String
    let label: String
}

struct PlanStats: Codable, Hashable, Sendable {
    let candidates: Int
    let steps: Int
    let dropped_refs: Int
    let ms: Int
}

struct PlanResponse: Codable, Hashable, Sendable {
    let summary: String
    let steps: [PlanStep]
    let resources: [String: ResourceCard]
    let ask_a_person: Bool
    let ask_a_person_reason: String
    let located: Located
    let stats: PlanStats
    let model: String
}

// MARK: - /api/results (web/src/lib/results.ts)

struct ResultsRequest: Encodable, Sendable {
    let text: String
    let language: Language
}

/// One test on the report. status is decided by the server's code from the printed flag or printed range, never by the AI.
struct ResultRow: Codable, Hashable, Sendable {
    let test: String
    let value: String
    let unit: String
    let range_text: String
    let quote: String
    let plain_name: String
    let ask: String
    let status: String // "outside" | "inside" | "unknown"
    let direction: String? // "high" | "low" | null
    let reason: String
}

struct ResultsCounts: Codable, Hashable, Sendable {
    let outside: Int
    let inside: Int
    let unknown: Int
}

struct ResultsDropped: Codable, Hashable, Sendable {
    let test: String
    let reason: String
}

/// How many result-looking lines the server's code found in the report, and how many a verified row covered.
struct ResultsCoverage: Codable, Hashable, Sendable {
    let candidates: Int
    let checked: Int
    let unchecked: [String]
}

struct ResultsResponse: Codable, Hashable, Sendable {
    let rows: [ResultRow]
    let dropped: [ResultsDropped]
    let counts: ResultsCounts
    /// Optional so an older server still decodes; without it the app never claims an all-clear.
    let coverage: ResultsCoverage?
    let model: String
    let ms: Int

    /// Same rules as headline() in web/src/ui/LabResults.tsx: never a report-wide all-clear unless every result line
    /// the server's code found was checked.
    var headline: String {
        if rows.isEmpty { return "We couldn't read any results from this. Check the text or ask your clinic." }
        if counts.outside > 0 { return "\(counts.outside) \(counts.outside == 1 ? "result is" : "results are") outside the range on your report." }
        guard let c = coverage else { return "None of the results we read is outside its range. Check the rest of your report too." }
        if c.checked < c.candidates { return "We checked \(c.checked) of \(c.candidates) result lines. None of the ones we checked is outside its range." }
        if counts.unknown > 0 { return "Nothing is marked outside its range, but we couldn't tell for \(counts.unknown) \(counts.unknown == 1 ? "result" : "results")." }
        return "Nothing on this report is marked or printed as outside its range."
    }
}

struct APIErrorBody: Decodable, Sendable {
    let error: String
}

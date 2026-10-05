import Foundation
import Testing
@testable import ATLAS

/// "Ask my paper" on iPhone, checked against the website. mobile/shared/ask-vectors.json (a test resource referenced from
/// project.yml, the same file Android replays) holds the website's own answers: every fixed string in seven languages,
/// which questions are urgent (never sent), the ready question, and which quotes survive onThisPaper.
struct AskPaperTests {
    struct Vectors: Decodable {
        let text: [String: [String: String]]
        let max_question: Int
        let urgent: [Urgent]
        let ready: [Ready]
        let on_this_paper: [OnPaper]

        struct Urgent: Decodable { let question: String; let urgent: Bool }
        struct Person: Decodable { let who: String; let label: String; let question: String }
        struct Ready: Decodable { let question: String; let language: String; let expected: Person }
        struct OnPaper: Decodable { let name: String; let source: String; let res: AnyRes; let expected: AnyRes }
        /// AskResponse as JSON, read through the app's own decoder.
        struct AnyRes: Decodable {
            let raw: Data
            init(from decoder: Decoder) throws {
                let v = try JSONValue(from: decoder)
                raw = try JSONEncoder().encode(v)
            }
        }
    }

    /// Any JSON value, so a nested object can be handed to the app's decoder unchanged.
    enum JSONValue: Codable {
        case string(String), number(Double), bool(Bool), null, array([JSONValue]), object([String: JSONValue])
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let n = try? c.decode(Double.self) { self = .number(n) }
            else if let s = try? c.decode(String.self) { self = .string(s) }
            else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
            else { self = .object(try c.decode([String: JSONValue].self)) }
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .string(let s): try c.encode(s)
            case .number(let n): try c.encode(n)
            case .bool(let b): try c.encode(b)
            case .null: try c.encodeNil()
            case .array(let a): try c.encode(a)
            case .object(let o): try c.encode(o)
            }
        }
    }

    final class Token {}

    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: Token.self).url(forResource: "ask-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    @Test func fixedStringsAreTheWebsitesInAllSevenLanguages() throws {
        let v = try Self.load()
        #expect(Set(v.text.keys) == Set(Language.allCases.map(\.rawValue)))
        #expect(v.max_question == AskPaper.maxQuestion)
        for language in Language.allCases {
            let web = try #require(v.text[language.rawValue])
            let t = AskPaper.strings(language)
            let mine: [String: String] = [
                "title": t.title, "intro": t.intro, "label": t.label, "placeholder": t.placeholder, "button": t.button,
                "asking": t.asking, "refusal": t.refusal, "readyLabel": t.readyLabel, "readyHint": t.readyHint, "copy": t.copy,
                "copied": t.copied, "urgentTitle": t.urgentTitle, "urgentBody": t.urgentBody, "urgentPaper": t.urgentPaper,
                "paperLabel": t.paperLabel, "leadNote": t.leadNote, "error": t.error, "busy": t.busy,
                "unavailable": t.unavailable, "today": t.today,
                "readyQuestion": t.readyQuestion("can I drive?"), "about": t.about("ibuprofen"),
                "held1": t.held(1), "held2": t.held(2), "held5": t.held(5),
            ]
            #expect(Set(mine.keys) == Set(web.keys), "\(language)")
            for (k, value) in mine {
                #expect(Array(value.utf16) == Array((web[k] ?? "").utf16), "\(language).\(k)")
            }
        }
    }

    @Test func urgentQuestionsMatchTheWebsite() throws {
        let v = try Self.load()
        var passed = 0
        for u in v.urgent {
            let got = AskPaper.isUrgentQuestion(u.question)
            #expect(got == u.urgent, "\(u.question)")
            if got == u.urgent { passed += 1 }
        }
        var readyPassed = 0
        for r in v.ready {
            let got = AskPaper.askAboutQuestion(r.question, language: r.language)
            let ok = got.who == r.expected.who && got.label == r.expected.label
                && Array(got.question.utf16) == Array(r.expected.question.utf16)
            #expect(ok, "\(r.language): \(r.question)")
            if ok { readyPassed += 1 }
        }
        var paperPassed = 0
        for c in v.on_this_paper {
            let res = try #require(AskPaper.decode(c.res.raw), "\(c.name)")
            let want = try #require(AskPaper.decode(c.expected.raw), "\(c.name)")
            let got = AskPaper.onThisPaper(res, source: c.source)
            #expect(got == want, "\(c.name)")
            if got == want { paperPassed += 1 }
        }
        let total = v.urgent.count + v.ready.count + v.on_this_paper.count
        #expect(total > 90)
        // ios-ci reads this line to prove the shared vectors ran.
        print("ask vectors: \(passed + readyPassed + paperPassed) of \(total) equal to the web reference")
    }

    @Test func refusalsShowFixedWordsNotTheServersEnglish() {
        #expect(AskPaper.errorMessage(status: 429, limitHeader: "shared-daily", language: .English) == AskPaper.strings(.English).today)
        #expect(AskPaper.errorMessage(status: 429, limitHeader: nil, language: .Spanish) == AskPaper.strings(.Spanish).busy)
        #expect(AskPaper.errorMessage(status: 503, limitHeader: "unavailable", language: .French) == AskPaper.strings(.French).unavailable)
        #expect(AskPaper.errorMessage(status: 500, limitHeader: "shared-daily", language: .Korean) == AskPaper.strings(.Korean).error)
        #expect(AskPaper.errorMessage(status: 400, limitHeader: nil, language: .English) == "Something went wrong. Try again.")
    }

    @Test func anUnknownKindIsAnErrorNotAnAnswer() {
        #expect(AskPaper.decode(Data(#"{"kind":"advice","text":"take two"}"#.utf8)) == nil)
        #expect(AskPaper.decode(Data(#"{"error":"busy"}"#.utf8)) == nil)
        #expect(AskPaper.decode(Data(#"{"kind":"urgent"}"#.utf8)) == .urgent)
    }

    @Test func theRequestIsTheWebsitesBody() throws {
        let req = try APIClient().request("/api/ask", body: AskRequest(source_text: "Take 1 tablet daily.", language: .Spanish, question: "when?"))
        #expect(req.url?.absoluteString == "https://atlas-team12.vercel.app/api/ask")
        #expect(req.value(forHTTPHeaderField: "x-atlas-surface") == "ios")
        let body = try #require(req.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: String] })
        #expect(body == ["source_text": "Take 1 tablet daily.", "language": "Spanish", "question": "when?"])
    }

    @Test func urgentCardShowsOnlyThePapersOwnWarningLines() {
        func item(_ id: String, _ kind: String, _ quote: String) -> VerifiedItem {
            VerifiedItem(id: id, kind: kind, title: "", plain_language: "", why: "", when: "", source_quote: quote,
                         needs_clarification: false, question_for_clinic: "", grounded: true, span: nil)
        }
        let items = [item("a", "warning_sign", "Rest at home."), item("b", "self_care", "Call 911 if you have chest pain.")]
        #expect(AskPaper.warningLines(items).map(\.id) == ["b"])
    }
}

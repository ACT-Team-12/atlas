import Foundation
import Testing
@testable import ATLAS

/// The Oct 3 catch-up with the website: paper first with the second-model double-check, helper links and the
/// outdated-plan guard. Each case mirrors a rule in web/src/lib (paperFirst.ts, planQuotes.ts, speechText.ts,
/// shareText.ts, meaningRun.ts, helperLink.ts, staleGuard.ts) and the Android WebParityTest of the same name.
struct WebParityTests {
    private func item(_ id: String, quote: String = "Take metformin 500 mg twice a day.", grounded: Bool = true,
                      kind: String = "medication") -> VerifiedItem {
        VerifiedItem(id: id, kind: kind, title: "Diabetes medicine", plain_language: "Take one pill two times a day.",
                     when: "Morning and evening", source_quote: quote, grounded: grounded)
    }

    private func certified(_ id: String) -> MeaningResult { MeaningResult(id: id, numbers_ok: true, model_verdict: "same", certified: true) }
    private func flagged(_ id: String) -> MeaningResult { MeaningResult(id: id, flagged: true, model_verdict: "different", what_differs: "paper says \"500 mg\"") }

    private func step(_ title: String, action: String = "", careIds: [String] = []) throws -> PlanStep {
        let body: [String: Any] = ["title": title, "action": action, "care_ids": careIds]
        return try JSONDecoder().decode(PlanStep.self, from: JSONSerialization.data(withJSONObject: body))
    }

    /// A file in the repo, found from this test file's path (mobile/ios/ATLASTests/ -> repo root).
    private func repoFile(_ path: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    // MARK: Paper first

    @Test func uncheckedQuoteLeadsAndExplanationIsSecondaryWithNote() {
        let v = PaperFirst.careStep(item("a"), check: .unchecked)
        #expect(!v.explanationLeads)
        #expect(v.quoteLabel == "Your paper says:")
        #expect(v.quote == "Take metformin 500 mg twice a day.")
        // The AI's title and when are its words too, so they are secondary with the plain words.
        #expect(v.explanation == "Diabetes medicine · Morning and evening · Take one pill two times a day.")
        #expect(v.note == PaperFirst.noteUnchecked)
    }

    @Test func unconfirmedCardIsLabelledCalmly() throws {
        let v = PaperFirst.careStep(item("a"), check: .unchecked)
        #expect(v.screenLabel == "Copied word for word from your paper")
        #expect(v.note == "Plain words (not double-checked yet)")
        #expect(!(v.note ?? "").contains("follow your paper"))
        let web = try repoFile("web/src/lib/stepsView.ts")
        #expect(web.contains("\"\(PaperFirst.checkedOnce)\""), "stepsView.ts SEAL_TEXT.once differs")
    }

    @Test func askPersonUsesOnlyThePapersWords() throws {
        let quote = "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily."
        for check in [Check.unchecked, .flagged] {
            let a = try #require(PaperFirst.askPerson(kind: "medication", quote: quote, check: check))
            #expect(a.label == "Ask your pharmacist")
            #expect(a.question == "My paper says: \"\(quote)\" Can you confirm what I should take?")
        }
        let lab = try #require(PaperFirst.askPerson(kind: "lab_test", quote: "Hemoglobin A1c - due in 3 months", check: .unchecked))
        #expect(lab.label == "Ask your clinic")
        #expect(lab.question == "My paper says: \"Hemoglobin A1c - due in 3 months\" Can you help me understand what I should do?")
        #expect(PaperFirst.askPerson(kind: "medication", quote: quote, check: .certified) == nil)
        #expect(PaperFirst.askPerson(kind: "warning_sign", quote: "Call 911 if you have chest pain.", check: .unchecked) == nil)
        #expect(PaperFirst.askPerson(kind: "medication", quote: "  ", check: .unchecked) == nil)
        // The same fixed wording as the website.
        let web = try repoFile("web/src/lib/askPerson.ts")
        for s in ["Can you confirm what I should take?", "Can you help me understand what I should do?", "Ask your pharmacist", "Ask your clinic", "My paper says: \"${quote}\" Can"] {
            #expect(web.contains(s), "askPerson.ts lacks: \(s)")
        }
    }

    @Test func certifiedExplanationLeadsWithItsQuote() {
        let v = PaperFirst.careStep(item("a"), check: .certified)
        #expect(v.explanationLeads)
        #expect(v.explanation == "Take one pill two times a day.")
        #expect(v.note == nil)
        #expect(PaperFirst.lines(v) == ["Take one pill two times a day.", "Your paper says: \"Take metformin 500 mg twice a day.\""])
    }

    @Test func textThatLeavesTheScreenNeverCarriesAnUncertifiedExplanation() {
        for check in [Check.unchecked, .flagged] {
            let lines = PaperFirst.lines(PaperFirst.careStep(item("a"), check: check))
            #expect(lines.count == 2)
            #expect(lines.first == "Your paper says: \"Take metformin 500 mg twice a day.\"")
            #expect(!lines.contains { $0.contains("one pill") || $0.contains("Diabetes medicine") })
        }
        #expect(PaperFirst.lines(PaperFirst.careStep(item("a"), check: .flagged))[1] == PaperFirst.leftOutFlagged)
        #expect(PaperFirst.lines(PaperFirst.careStep(item("a"), check: .unchecked))[1] == PaperFirst.leftOutUnchecked)
    }

    @Test func noQuoteMeansNoExplanation() {
        let v = PaperFirst.careStep(item("a", quote: "   "), check: .certified)
        #expect(v.quote.isEmpty && v.explanation == nil)
        #expect(PaperFirst.lines(v).isEmpty)
    }

    @Test func labRowLeadsWithTheReportLine() throws {
        let row = try JSONDecoder().decode(ResultRow.self, from: Data(#"{"test":"Glucose","value":"142","unit":"mg/dL","range_text":"70-99","quote":"Glucose 142 H","plain_name":"Blood sugar","ask":"","status":"outside","direction":"high","reason":""}"#.utf8))
        let v = PaperFirst.labRow(row)
        #expect(!v.explanationLeads)
        #expect(v.quoteLabel == "Your report says:")
        #expect(v.explanation == "Blood sugar")
        #expect(v.note == PaperFirst.noteUnchecked)
    }

    @Test func remindersUseTheKindAndOnlyACertifiedWhen() {
        #expect(PaperFirst.bookTitle(kind: "medication") == "Medicine from your paper")
        #expect(PaperFirst.bookTitle(kind: "unknown") == "Appointment from your paper")
        #expect(PaperFirst.bookWhen(item("a"), check: .unchecked) == "")
        #expect(PaperFirst.bookWhen(item("a"), check: .flagged) == "")
        #expect(PaperFirst.bookWhen(item("a"), check: .certified) == "Morning and evening")
    }

    @Test func planStepQuotesAreGroundedDeduplicatedAndSkipUnknownIds() throws {
        let items = [item("a"), item("b", quote: "Take metformin 500 mg twice a day."), item("c", quote: "Not real", grounded: false),
                     item("d", quote: "Labs in 2 weeks.")]
        let s = try step("Get a ride", careIds: ["a", "b", "c", "zzz", "d"])
        #expect(PaperFirst.planStepQuotes(s, items: items) == ["Take metformin 500 mg twice a day.", "Labs in 2 weeks."])
        #expect(PaperFirst.planStepQuotes(try step("Call 211"), items: items).isEmpty)
    }

    @Test func planReadAloudStartsWithTheSuggestionNoteAndCarriesQuotes() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Fixture.data("extract_sample_live"))
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let lines = PaperFirst.planSpeechLines(plan, items: care.items)
        #expect(lines[0] == PaperFirst.planIsASuggestion)
        #expect(lines[1] == plan.summary)
        let quoted = plan.steps.flatMap { PaperFirst.planStepQuotes($0, items: care.items) }
        #expect(!quoted.isEmpty)
        #expect(lines.count == 2 + plan.steps.count + quoted.count)
    }

    @Test func planSuggestionWordingMatchesWeb() throws {
        let speech = try repoFile("web/src/lib/speechText.ts")
        #expect(speech.contains("\"\(PaperFirst.planIsASuggestion)\""))
        let pf = try repoFile("web/src/lib/paperFirst.ts")
        for s in [PaperFirst.noteUnchecked, PaperFirst.noteFlagged, PaperFirst.leftOutUnchecked, PaperFirst.leftOutFlagged] {
            #expect(pf.contains(s), "paperFirst.ts lacks: \(s)")
        }
        // The check status lines on each card use the website's own words.
        // The step cards moved to CareSteps.tsx, and the certified line is SEAL_TEXT.twice in stepsView.ts.
        let ui = try repoFile("web/src/ui/CareSteps.tsx")
        #expect(ui.contains("Double-check this one with your clinic: our second check says the explanation may not match your paper."))
        let seals = try repoFile("web/src/lib/stepsView.ts")
        #expect(seals.contains("\"\(CheckStatus.checkedTwice)\""))
    }

    // MARK: The double-check (/api/meaning)

    @Test func meaningRequestMatchesTheBrowsersBody() throws {
        #expect(MeaningRequest.of([], language: .English) == nil)
        let many = (0..<45).map { item("item-\($0)") }
        let req = try #require(MeaningRequest.of(many, language: .Spanish))
        #expect(req.items.count == 40)
        #expect(req.items[0].plain_language == "Diabetes medicine. Take one pill two times a day.")
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(req)) as? [String: Any])
        #expect(json["language"] as? String == "Spanish")
        let first = try #require((json["items"] as? [[String: Any]])?.first)
        #expect(Set(first.keys) == ["id", "plain_language", "when", "source_quote"])
        // No language: the field is left out (the server's zod schema accepts missing, not null).
        let noLang = try #require(MeaningRequest.of(Array(many.prefix(1)), language: nil))
        let noLangJSON = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(noLang)) as? [String: Any])
        #expect(Set(noLangJSON.keys) == ["items"])
    }

    @Test func meaningStateOnlyCertifiesFinishedRequestedIds() throws {
        let req = try #require(MeaningRequest.of([item("a"), item("b"), item("c")], language: .English))
        let response = try JSONDecoder().decode(MeaningResponse.self, from: Data("""
            {"results":[
              {"id":"a","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"same","what_differs":"","certified":true},
              {"id":"b","flagged":true,"numbers_ok":false,"unexpected_numbers":["2"],"model_verdict":"different","what_differs":"x","certified":false},
              {"id":"c","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"unclear","what_differs":"","certified":false},
              {"id":"evil","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"same","what_differs":"","certified":true}
            ],"flagged":1,"checker_model":"m","ms":10}
            """.utf8))
        let state = MeaningState.done(req, response)
        #expect(state.check(for: "a") == .certified)
        #expect(state.check(for: "b") == .flagged)
        #expect(state.check(for: "c") == .unchecked)
        #expect(state.check(for: "evil") == .unchecked)
        #expect(state.byId["evil"] == nil)
        // While loading or after an error, nothing leads with an explanation.
        #expect(MeaningState(status: .loading, byId: state.byId).check(for: "a") == .unchecked)
        #expect(MeaningState(status: .error, byId: state.byId).check(for: "a") == .unchecked)
        #expect(PaperFirst.checkOf(MeaningResult(id: "x", flagged: true, certified: true)) == .flagged)
    }

    @Test func flaggedStatusMatchesTheWebsiteWording() {
        let r = MeaningResult(id: "a", flagged: true, unexpected_numbers: ["2", "3"], model_verdict: "different", what_differs: "paper says 500 mg")
        #expect(CheckStatus.flaggedText(r) == "Double-check this one with your clinic: our second check says the explanation may not match your paper. Paper says 500 mg (Number not in your paper: 2, 3.)")
    }

    @Test func shareTextSendsAnExplanationOnlyWhenCertified() throws {
        let items = [item("a"), item("b", quote: "Labs in 2 weeks.", kind: "lab_test"), item("c", quote: "Walk daily.", kind: "self_care")]
        let base = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let plan = PlanResponse(summary: base.summary, steps: [try step("Get a ride", action: "Call MARTA Mobility.", careIds: ["b"])],
                                resources: [:], ask_a_person: false, ask_a_person_reason: "", located: base.located,
                                stats: base.stats, model: base.model)
        let meaning = MeaningState(status: .done, byId: ["a": certified("a"), "b": flagged("b")])
        let text = ShareText.plan(items: items, plan: plan, questions: [], meaning: meaning, planItems: items)
        #expect(text.contains("1. Medicine: Diabetes medicine (Morning and evening)"))
        #expect(text.contains("   Take one pill two times a day."))
        #expect(text.contains("2. Lab test\n   Double-check this one with your clinic"))
        #expect(text.contains("3. Self care\n   Your paper says: \"Walk daily.\"\n   \(PaperFirst.leftOutUnchecked)"))
        #expect(text.components(separatedBy: "Take one pill two times a day.").count - 1 == 1)
        #expect(text.contains("1. Get a ride. Call MARTA Mobility.\n   Your paper says: \"Labs in 2 weeks.\""))
        #expect(text.contains("Suggestion from ATLAS, not the paper: \(plan.summary)"))
        // With no double-check at all (the default), no explanation leaves the phone.
        #expect(!ShareText.plan(items: items, plan: plan, questions: []).contains("one pill"))
    }

    @Test func nextVisitQuestionsCarryTheAIQuestionOnlyWhenCertified() throws {
        let aiQ = "QUESTION-WHICH-METFORMIN-DOSE"
        let asks = VerifiedItem(id: "a", kind: "medication", title: "Diabetes medicine", plain_language: "Take one pill.",
                                source_quote: "Take metformin 500 mg twice a day.", needs_clarification: true, question_for_clinic: aiQ)
        let base = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let plan = PlanResponse(summary: base.summary, steps: [], resources: [:], ask_a_person: false, ask_a_person_reason: "",
                                located: base.located, stats: base.stats, model: base.model)
        // Older readings also repeat the step's question in the general list: it must not leak through there either.
        let general = [aiQ, "Do I need a ride?"]
        for meaning in [MeaningState.idle, MeaningState(status: .error), MeaningState(status: .done, byId: ["a": flagged("a")])] {
            let text = ShareText.plan(items: [asks], plan: plan, questions: general, meaning: meaning, planItems: [asks])
            #expect(!text.contains(aiQ))
            #expect(text.contains("- My paper says: \"Take metformin 500 mg twice a day.\" Can you confirm what I should take?"))
            #expect(text.contains("- Do I need a ride?"))
        }
        let ok = ShareText.plan(items: [asks], plan: plan, questions: general, meaning: MeaningState(status: .done, byId: ["a": certified("a")]), planItems: [asks])
        #expect(ok.components(separatedBy: aiQ).count - 1 == 1)
        // A removed step's question stays out of the general list as well.
        #expect(PaperFirst.visitQuestions(items: [], general: general, also: [asks], check: { _ in .certified }) == ["Do I need a ride?"])
        #expect(PaperFirst.questionKey("  Which pain-medicines, are SAFE?? ") == "which pain medicines are safe")
        // A held-back (refused) step's question, repeated in a saved reading's general list, stays out too.
        let saved = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"{"items":[],"refused":[{"id":"r1","kind":"medication","title":"t","plain_language":"p","source_quote":"q","needs_clarification":true,"question_for_clinic":"Should I double my insulin?","grounded":false}],"questions_for_doctor":["Should I double my insulin?","Do I need a ride?"],"stats":{"extracted":1,"grounded":0,"refused":1,"ms":1}}"#.utf8))
        #expect(PaperFirst.readingGeneralQuestions(saved) == ["Do I need a ride?"])
        let web = try repoFile("web/src/lib/visitQuestions.ts")
        #expect(web.contains("export function visitQuestions"), "visitQuestions.ts moved")
    }

    @Test func extractResponseCarriesItsLanguageAndOldFilesStillLoad() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},"language":"Korean"}"#.utf8))
        #expect(care.language == .Korean)
        let old = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1}}"#.utf8))
        #expect(old.language == nil)
        // A session saved by version 1.0 (no meaning, no fingerprints) still loads.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let saved = try decoder.decode(SavedSession.self, from: Data(#"{"text":"x","language":"English","level":"simple","barriers":[],"zip":"","note":"","done":{},"removed":{},"savedAt":"2026-10-02T12:00:00Z"}"#.utf8))
        #expect(saved.meaning == nil && saved.readFingerprint == nil && saved.planFingerprint == nil)
    }

    // MARK: Every call says it is the iPhone app

    @Test func everyRequestCarriesTheSurfaceHeaderAndOnlyAHelperPlanCarriesTheEntry() throws {
        let api = APIClient()
        let plain = try api.request("/api/meaning", body: ["x": 1])
        #expect(plain.value(forHTTPHeaderField: "x-atlas-surface") == "ios")
        #expect(plain.value(forHTTPHeaderField: "x-atlas-entry") == nil)
        let helper = try api.request("/api/plan", body: ["x": 1], headers: [HelperLink.entryHeader: HelperLink.helperEntry])
        #expect(helper.value(forHTTPHeaderField: "x-atlas-surface") == "ios")
        #expect(helper.value(forHTTPHeaderField: "x-atlas-entry") == "helper-link")
        // The server accepts exactly these values (web/src/lib/db.ts surfaceOf, entryOf).
        let db = try repoFile("web/src/lib/db.ts")
        #expect(db.contains("s === \"ios\""))
        #expect(db.contains("=== \"helper-link\""))
    }

    // MARK: Helper links

    @Test func parsesTheDocumentedHelperLink() {
        #expect(HelperLink.parseFragment("#try&via=helper&lang=es&level=simple&zip=30310") == HelperPresets(language: .Spanish, level: .simple, zip: "30310"))
        #expect(HelperLink.parseFragment("try&via=helper") == HelperPresets())
        #expect(HelperLink.parseFragment("#via=helper&lang=am") == HelperPresets(language: .Amharic))
    }

    @Test func helperLinkRejectsAnythingOffTheAllowLists() {
        #expect(HelperLink.parseFragment(nil) == nil)
        #expect(HelperLink.parseFragment("") == nil)
        #expect(HelperLink.parseFragment("#try&lang=es") == nil)
        #expect(HelperLink.parseFragment("#via=helper&via=helper&lang=es") == nil) // repeated via is ambiguous
        #expect(HelperLink.parseFragment("#via=Helper") == nil)
        #expect(HelperLink.parseFragment("#via=helper&lang=es&" + String(repeating: "x", count: 120)) == nil)
        #expect(HelperLink.parseFragment("#via=helper&lang=%65s&level=SIMPLE&zip=00000&lang2=es&zip=3031") == HelperPresets())
        #expect(HelperLink.parseFragment("#via=helper&lang=es&lang=fr&level=detailed&zip=1234a") == HelperPresets(level: .detailed))
        #expect(HelperLink.parseFragment("#via=helper&zip=٣٠٣١٠") == HelperPresets()) // Arabic-Indic digits are not a ZIP
    }

    @Test func onlyOurOwnHttpsHostCounts() throws {
        let f = "try&via=helper&lang=es"
        #expect(HelperLink.fromLink(try #require(URL(string: "https://atlas-team12.vercel.app/#\(f)")))?.language == .Spanish)
        #expect(HelperLink.fromLink(try #require(URL(string: "http://atlas-team12.vercel.app/#\(f)"))) == nil)
        #expect(HelperLink.fromLink(try #require(URL(string: "https://evil.example/#\(f)"))) == nil)
        #expect(HelperLink.fromLink(try #require(URL(string: "https://atlas-team12.vercel.app.evil.example/#\(f)"))) == nil)
        // The fragment is read raw: a percent-encoded value never matches the allow-list.
        #expect(HelperLink.fromLink(try #require(URL(string: "https://atlas-team12.vercel.app/#via=helper&lang=%65s")))?.language == nil)
    }

    @Test func bannerMatchesTheWebsite() throws {
        #expect(HelperLink.banner(HelperPresets()).text == "Someone helping you set this up. You can change anything.")
        #expect(HelperLink.banner(HelperPresets(language: .English, zip: "30310")).text == "Someone helping you set this up in English for 30310. You can change anything.")
        let es = HelperLink.banner(HelperPresets(language: .Spanish, zip: "30310"))
        #expect(es.text == "Alguien que le ayuda preparó esto en español para el código postal 30310. Puede cambiar cualquier cosa.")
        #expect(es.langCode == "es")
        #expect(es.english == "Someone helping you set this up in Spanish for 30310. You can change anything.")
        // Every localized banner's opening words appear in web/src/lib/helperLink.ts.
        let web = try repoFile("web/src/lib/helperLink.ts")
        for l in Language.allCases {
            let text = HelperLink.banner(HelperPresets(language: l)).text
            #expect(web.contains(String(text.prefix(14))), "banner for \(l) drifted: \(text)")
        }
        for (l, code) in HelperLink.langCode { #expect(web.contains("\(l.rawValue): \"\(code)\"")) }
    }

    @Test func entitlementAndSiteAssociationAgree() throws {
        let spec = try repoFile("mobile/ios/project.yml")
        #expect(spec.contains("applinks:\(HelperLink.host)"))
        let team = try #require(spec.firstMatch(of: #/DEVELOPMENT_TEAM: (\w+)/#)).1
        let aasa = try repoFile("web/public/.well-known/apple-app-site-association")
        let json = try #require(JSONSerialization.jsonObject(with: Data(aasa.utf8)) as? [String: Any])
        let details = try #require((json["applinks"] as? [String: Any])?["details"] as? [[String: Any]])
        #expect(details.count == 1)
        #expect(details[0]["appIDs"] as? [String] == ["\(team).com.stephensookra.atlas"])
        let components = try #require(details[0]["components"] as? [[String: Any]])
        #expect(components.map { $0["/"] as? String } == ["/"])
        // Served as JSON despite having no extension.
        let config = try repoFile("web/next.config.ts")
        #expect(config.contains("/.well-known/apple-app-site-association") && config.contains("application/json"))
    }

    // MARK: Outdated plan

    @Test func planFingerprintIgnoresBarrierOrderButNothingElse() {
        func fp(ids: [String] = ["a"], b: [Barrier] = [.cost, .transport], lang: Language = .English, note: String = "",
                zip: String = "30303", loc: LatLng? = nil) -> String {
            StaleGuard.planFingerprint(careIds: ids, barriers: b, language: lang, note: note, place: StaleGuard.place(location: loc, zip: zip), location: loc)
        }
        #expect(fp() == fp(b: [.transport, .cost]))
        #expect(fp() != fp(ids: ["a", "b"]))
        #expect(fp() != fp(b: [.cost]))
        #expect(fp() != fp(lang: .Spanish))
        #expect(fp() != fp(note: "no car"))
        #expect(fp() != fp(zip: "30310"))
        #expect(fp() != fp(loc: LatLng(lat: 33.7, lng: -84.4)))
        #expect(fp(loc: LatLng(lat: 33.7, lng: -84.4)) == fp(zip: "30310", loc: LatLng(lat: 33.7, lng: -84.4)))
        #expect(fp(zip: "123") == fp(zip: "")) // an invalid ZIP is not sent, so it is the same request
        #expect(StaleGuard.readFingerprint(text: "x", language: .English, level: .simple) != StaleGuard.readFingerprint(text: "x", language: .English, level: .detailed))
    }
}

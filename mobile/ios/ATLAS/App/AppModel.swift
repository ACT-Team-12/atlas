import CoreGraphics
import Foundation
import Observation

enum Route: Hashable {
    case check, steps, barriers, plan, reminders, labs
}

/// Where the text on the "Check the text" screen came from.
enum TextSource: String, Codable, Sendable {
    case scan, photo, typed, sample
}

@MainActor
@Observable
final class AppModel {
    // Inputs
    var text = "" { didSet { persist() } }
    var textSource: TextSource = .typed
    var language: Language = .English { didSet { persist() } }
    var level: ReadingLevel = .simple { didSet { persist() } }
    var barriers: [Barrier] = [] { didSet { persist() } }
    var zip = "" { didSet { persist() } }
    var note = "" { didSet { persist() } }
    /// Device location for the plan request only. Never saved.
    var location: LatLng?

    // Results. A read, a plan, or a step done, removed or restored moves the saved time "Welcome back" shows.
    var care: CarePlanResponse? { didSet { persist(planChanged: true) } }
    var plan: PlanResponse? { didSet { persist(planChanged: true) } }
    var done: [String: Bool] = [:] { didSet { persist(planChanged: true) } }
    var removed: [String: Bool] = [:] { didSet { persist(planChanged: true) } }
    var restoredAt: Date?
    /// The second-model double-check of `care` (paper first: only a certified explanation may lead).
    private(set) var meaning: MeaningState = .idle { didSet { persist() } }
    /// What `care` was read from and what `plan` was built from (StaleGuard). Nil when unknown (older saved files).
    private(set) var readFingerprint: String?
    private(set) var planFingerprint: String?
    /// When the steps or the plan last changed (SavedSession.savedAt). Input changes and helper links keep it.
    @ObservationIgnored private var planChangedAt: Date?

    // Helper link: the banner, and whether the next plan counts as one built from the link. Never saved.
    private(set) var helperBanner: HelperBanner?
    @ObservationIgnored private var fromHelperLink = false

    // The meaning check runs beside the read; every Clear, new read or restore moves this fence, so an older reply is
    // never applied to a newer paper (web/src/lib/meaningRun.ts RunFence).
    @ObservationIgnored private var meaningRunID = 0
    @ObservationIgnored private var meaningTask: Task<Void, Never>?

    // Work in progress
    var path: [Route] = []
    var busy: Busy?
    var error: String?

    enum Busy: Equatable { case recognizing, reading, planning }

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let store: SessionStore
    @ObservationIgnored private var restoring = false

    init(api: APIClient = APIClient(), store: SessionStore = SessionStore()) {
        self.api = api
        self.store = store
        restore()
    }

    // MARK: Derived

    var items: [VerifiedItem] { (care?.items ?? []).filter { removed[$0.id] != true } }
    var removedItems: [VerifiedItem] { (care?.items ?? []).filter { removed[$0.id] == true } }
    var careByID: [String: VerifiedItem] {
        Dictionary((care?.items ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
    var canRead: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).count > 20 && busy == nil }
    var canPlan: Bool { busy == nil && !(barriers.isEmpty && items.isEmpty) && !careOutdated }

    func check(for id: String) -> Check { meaning.check(for: id) }

    /// "Lines on your paper we didn't turn into steps", for the steps still kept: follows every Remove and Undo.
    var missedLines: MissedLinesView { MissedLines.view(care?.missed_lines, keptIDs: items.map(\.id)) }

    /// The steps on screen were read from different text, language or reading level than what is entered now.
    var careOutdated: Bool {
        guard care != nil, let readFingerprint else { return false }
        return readFingerprint != StaleGuard.readFingerprint(text: text, language: language, level: level)
    }

    /// The plan on screen was built from different inputs than what is entered now; its actions are turned off.
    var planOutdated: Bool {
        guard plan != nil, let planFingerprint else { return false }
        return careOutdated || planFingerprint != currentPlanFingerprint()
    }

    private func currentPlanFingerprint() -> String {
        StaleGuard.planFingerprint(careIds: items.map(\.id), barriers: barriers, language: language, note: note,
                                   place: StaleGuard.place(location: location, zip: zip), location: location)
    }

    // MARK: Helper links

    /// Opened from a link. Only a helper link for our own site does anything; nothing is sent.
    func open(_ url: URL) {
        guard let presets = HelperLink.fromLink(url) else { return }
        applyHelperLink(presets)
    }

    /// Applies the presets (each one is optional) and shows the banner. Nothing saved is touched; "Open it" still
    /// brings the last plan back.
    func applyHelperLink(_ p: HelperPresets) {
        if let l = p.language { language = l }
        if let l = p.level { level = l }
        if let z = p.zip { zip = z; location = nil }
        helperBanner = HelperLink.banner(p)
        fromHelperLink = true
        // Show the first screen, where the banner is.
        if busy == nil { path = [] }
    }

    func dismissHelperBanner() { helperBanner = nil }

    // MARK: Text in

    func useSample() {
        textSource = .sample
        text = Sample.text
        path = [.check]
    }

    func startTyping() {
        textSource = .typed
        path = [.check]
    }

    /// OCR on the phone. Pages never leave the device; only the text the person confirms is sent later.
    func recognize(pages: [CGImage], source: TextSource) {
        guard !pages.isEmpty else { return }
        cancel()
        error = nil
        busy = .recognizing
        task = Task {
            do {
                let result = try await TextRecognizer.recognize(pages: pages)
                busy = nil
                if result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    error = "We could not find any words in that picture. Try again in good light, or type the text."
                    return
                }
                textSource = source
                text = result
                path = [.check]
            } catch is CancellationError {
                busy = nil
            } catch {
                busy = nil
                self.error = "We could not read that picture. Try again, or type the text."
            }
        }
    }

    // MARK: Server calls

    func readPaper() {
        guard canRead else { return }
        cancel()
        error = nil
        busy = .reading
        let text = self.text, level = self.level, language = self.language
        task = Task {
            do {
                let result = try await api.extract(text: text, level: level, language: language)
                readFingerprint = StaleGuard.readFingerprint(text: text, language: language, level: level)
                planFingerprint = nil
                care = result
                plan = nil
                done = [:]
                removed = [:]
                restoredAt = nil
                busy = nil
                startMeaningCheck(for: result, language: result.language ?? language)
                if path.last != .steps { path.append(.steps) }
            } catch {
                busy = nil
                if (error as? APIError) != .cancelled { self.error = error.localizedDescription }
            }
        }
    }

    func makePlan() {
        guard canPlan else { return }
        cancel()
        error = nil
        busy = .planning
        let validZip = zip.range(of: #"^\d{5}$"#, options: .regularExpression) != nil
        let fingerprint = currentPlanFingerprint()
        let viaHelper = fromHelperLink
        let request = PlanRequest(
            care: items.map(PlanCareInput.init),
            barriers: barriers,
            zip: location == nil && validZip ? zip : nil,
            location: location,
            language: language,
            note: note
        )
        task = Task {
            do {
                let result = try await api.plan(request, fromHelperLink: viaHelper)
                planFingerprint = fingerprint
                plan = result
                // One link counts at most one plan (helperLink.ts consumeHelperSession).
                if viaHelper { fromHelperLink = false }
                busy = nil
                if path.last != .plan { path.append(.plan) }
            } catch {
                busy = nil
                if (error as? APIError) != .cancelled { self.error = error.localizedDescription }
            }
        }
    }

    /// Runs the second check for `forCare`. Its reply is applied only while the run is current and `care` is still
    /// that read.
    private func startMeaningCheck(for forCare: CarePlanResponse, language: Language?) {
        cancelMeaning()
        let run = meaningRunID
        guard let request = MeaningRequest.of(forCare.items, language: language) else {
            meaning = .idle
            return
        }
        meaning = MeaningState(status: .loading)
        let api = self.api
        meaningTask = Task {
            let next: MeaningState
            do {
                next = .done(request, try await api.meaning(request))
            } catch {
                next = MeaningState(status: .error)
            }
            // Cleared, re-read, restored or cancelled meanwhile: an older reply is never shown beside a newer paper.
            guard !Task.isCancelled, run == meaningRunID, care == forCare else { return }
            meaning = next
        }
    }

    private func cancelMeaning() {
        meaningRunID += 1
        meaningTask?.cancel()
        meaningTask = nil
    }

    func cancel() {
        task?.cancel()
        task = nil
        busy = nil
    }

    func toggle(_ barrier: Barrier) {
        if let i = barriers.firstIndex(of: barrier) { barriers.remove(at: i) } else { barriers.append(barrier) }
    }

    // MARK: Saved on this phone

    private func restore() {
        guard let saved = store.load()?.upgraded() else { return }
        restoring = true
        text = saved.text; language = saved.language; level = saved.level
        care = saved.care; barriers = saved.barriers; zip = saved.zip; note = saved.note
        plan = saved.plan; done = saved.done; removed = saved.removed
        readFingerprint = saved.readFingerprint; planFingerprint = saved.planFingerprint
        planChangedAt = saved.savedAt
        let savedMeaning = saved.meaning ?? .idle
        meaning = savedMeaning.status == .done ? savedMeaning : .idle
        restoring = false
        if saved.care != nil || saved.plan != nil { restoredAt = saved.savedAt }
        // A check that was still running when the app closed is run again; until it answers, every step is unchecked.
        if let c = saved.care, savedMeaning.status == .loading { startMeaningCheck(for: c, language: c.language ?? saved.language) }
    }

    /// `planChanged`: a read, a plan, or a step done, removed or restored, which moves the saved time "Welcome back"
    /// shows. Everything else (language, level, ZIP, note, barriers, a helper link, the double-check) is saved but keeps it.
    private func persist(planChanged: Bool = false) {
        guard !restoring, care != nil || plan != nil else { return }
        let at = planChanged ? Date() : (planChangedAt ?? Date())
        planChangedAt = at
        let session = SavedSession(text: text, language: language, level: level, care: care, barriers: barriers,
                                   zip: zip, note: note, plan: plan, done: done, removed: removed,
                                   meaning: meaning, readFingerprint: readFingerprint, planFingerprint: planFingerprint,
                                   savedAt: at)
        try? store.save(session)
    }

    func openSaved() {
        path = plan != nil ? [.steps, .plan] : [.steps]
    }

    /// "Clear from this phone": saved plan, typed text and ATLAS reminders.
    func clearFromPhone() async {
        cancel()
        cancelMeaning()
        helperBanner = nil; fromHelperLink = false
        store.clear()
        restoring = true
        meaning = .idle; readFingerprint = nil; planFingerprint = nil; planChangedAt = nil
        text = ""; care = nil; plan = nil; barriers = []; zip = ""; note = ""; done = [:]; removed = [:]
        restoring = false
        location = nil
        restoredAt = nil
        path = []
        await Reminders.removeAll()
    }
}

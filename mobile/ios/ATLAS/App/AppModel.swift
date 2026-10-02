import CoreGraphics
import Foundation
import Observation

enum Route: Hashable {
    case check, steps, barriers, plan, reminders
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

    // Results
    var care: CarePlanResponse? { didSet { persist() } }
    var plan: PlanResponse? { didSet { persist() } }
    var done: [String: Bool] = [:] { didSet { persist() } }
    var removed: [String: Bool] = [:] { didSet { persist() } }
    var restoredAt: Date?

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
    var canPlan: Bool { busy == nil && !(barriers.isEmpty && items.isEmpty) }

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
                care = result
                plan = nil
                done = [:]
                removed = [:]
                restoredAt = nil
                busy = nil
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
                let result = try await api.plan(request)
                plan = result
                busy = nil
                if path.last != .plan { path.append(.plan) }
            } catch {
                busy = nil
                if (error as? APIError) != .cancelled { self.error = error.localizedDescription }
            }
        }
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
        guard let saved = store.load() else { return }
        restoring = true
        text = saved.text; language = saved.language; level = saved.level
        care = saved.care; barriers = saved.barriers; zip = saved.zip; note = saved.note
        plan = saved.plan; done = saved.done; removed = saved.removed
        restoring = false
        if saved.care != nil || saved.plan != nil { restoredAt = saved.savedAt }
    }

    private func persist() {
        guard !restoring, care != nil || plan != nil else { return }
        let session = SavedSession(text: text, language: language, level: level, care: care, barriers: barriers,
                                   zip: zip, note: note, plan: plan, done: done, removed: removed, savedAt: Date())
        try? store.save(session)
    }

    func openSaved() {
        path = plan != nil ? [.steps, .plan] : [.steps]
    }

    /// "Clear from this phone": saved plan, typed text and ATLAS reminders.
    func clearFromPhone() async {
        cancel()
        store.clear()
        restoring = true
        text = ""; care = nil; plan = nil; barriers = []; zip = ""; note = ""; done = [:]; removed = [:]
        restoring = false
        location = nil
        restoredAt = nil
        path = []
        await Reminders.removeAll()
    }
}

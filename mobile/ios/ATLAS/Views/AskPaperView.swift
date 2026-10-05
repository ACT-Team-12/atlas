import Accessibility
import SwiftUI

/// "Ask my paper" (web/src/ui/AskPaper.tsx): a question answered only with the paper's own words, checked on the server
/// word for word (POST /api/ask). Paper first: the quotes lead, labelled "Copied word for word from your paper"; the one
/// line lead-in (fixed words around a topic taken from a quote) comes after, smaller, under "not double-checked yet".
/// Nothing survives: the fixed refusal and a ready question built from the person's own words. An urgent question gets
/// 911 / 211 guidance and the paper's own warning lines, never an AI answer, and is caught here before anything is sent.
/// The parent gives this a new identity on any new paper or language, which clears it.
struct AskPaperView: View {
    @Environment(AppModel.self) private var model
    let care: CarePlanResponse
    let items: [VerifiedItem]
    let language: Language

    enum Phase: Equatable {
        case idle, loading
        case error(String)
        case done(question: String, res: AskPaper.Response)
    }

    @State private var question = ""
    @State private var phase: Phase = .idle
    @State private var task: Task<Void, Never>?
    @State private var copied = false

    private var t: AskPaper.Strings { AskPaper.strings(language) }

    /// Fixed words tagged with the person's language, so VoiceOver reads them in that voice.
    private func lt(_ s: String) -> Text {
        var a = AttributedString(s)
        a.languageIdentifier = Speaker.code(for: language)
        return Text(a)
    }

    var body: some View {
        Card(border: Palette.teal) {
            lt(t.title).font(.title3.weight(.heavy)).accessibilityAddTraits(.isHeader)
            lt(t.intro).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
            TextField(t.placeholder, text: $question, axis: .vertical)
                .lineLimit(1...4)
                .font(.body.weight(.semibold))
                .padding(10)
                .background(Palette.paper, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.ink.opacity(0.7), lineWidth: 2))
                .accessibilityLabel(lt(t.label))
                .submitLabel(.send)
                // Medicine names must stay as typed ("metformin", not "met form in").
                .autocorrectionDisabled()
                .onSubmit { ask() }
                .onChange(of: question) { _, new in
                    // The route accepts at most 300 characters (counted as the website counts them).
                    if (new as NSString).length > AskPaper.maxQuestion {
                        question = (new as NSString).substring(to: AskPaper.maxQuestion)
                        return
                    }
                    // A new question: the one in flight is cancelled and an answer on screen is cleared, so an answer is
                    // never shown under a question it wasn't for.
                    task?.cancel()
                    task = nil
                    if phase != .idle { phase = .idle }
                }
            Button { ask() } label: { lt(t.button) }
                .buttonStyle(PillButtonStyle(fill: Palette.teal, text: Palette.paper))
                .disabled(phase == .loading || AskPaper.cleanQuestion(question).count < 3)

            switch phase {
            case .idle:
                EmptyView()
            case .loading:
                HStack(spacing: 8) {
                    ProgressView()
                    lt(t.asking).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                }
            case .error(let message):
                lt(message).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.red).wraps()
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.redSoft, in: RoundedRectangle(cornerRadius: 12))
            case let .done(asked, res):
                Text("\u{201C}\(asked)\u{201D}").font(.subheadline.weight(.bold)).wraps()
                result(asked, res)
            }
        }
        .onDisappear { task?.cancel() }
    }

    @ViewBuilder
    private func result(_ asked: String, _ res: AskPaper.Response) -> some View {
        switch res {
        case .urgent:
            let warnings = AskPaper.warningLines(items)
            VStack(alignment: .leading, spacing: 8) {
                lt(t.urgentTitle).font(.headline.weight(.heavy)).foregroundStyle(Palette.red)
                lt(t.urgentBody).font(.subheadline.weight(.semibold)).wraps()
                if !warnings.isEmpty {
                    lt(t.urgentPaper).font(.subheadline.weight(.bold))
                    ForEach(warnings) { w in
                        Text("\u{201C}\(w.source_quote)\u{201D}").font(.subheadline.weight(.semibold)).wraps().sunRule()
                    }
                }
                if let url = URL(string: "tel:911") {
                    Link(destination: url) { Label("911", systemImage: "phone.fill") }
                        .buttonStyle(OutlinePillStyle(fill: Palette.paper))
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.redSoft, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.red, lineWidth: 2))
        case .notInPaper:
            let ready = AskPaper.askAboutQuestion(asked, language: language.rawValue)
            VStack(alignment: .leading, spacing: 8) {
                lt(t.refusal).font(.headline.weight(.heavy)).wraps()
                VStack(alignment: .leading, spacing: 6) {
                    lt("\(t.readyLabel). \(t.readyHint)").font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft).wraps()
                    lt(ready.question).font(.subheadline.weight(.semibold)).wraps()
                    Button { UIPasteboard.general.string = ready.question; copied = true } label: { lt(copied ? t.copied : t.copy) }
                        .buttonStyle(OutlinePillStyle())
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.paper, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.ink.opacity(0.4), style: StrokeStyle(lineWidth: 2, dash: [5])))
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.peach, in: RoundedRectangle(cornerRadius: 16))
            heldLine(res)
        case let .answer(quotes, topic, _):
            VStack(alignment: .leading, spacing: 6) {
                lt(t.paperLabel).font(.caption2.weight(.heavy)).foregroundStyle(Palette.tealDeep).textCase(.uppercase)
                ForEach(Array(quotes.enumerated()), id: \.offset) { _, q in
                    Text("\u{201C}\(q.text)\u{201D}").font(.body.weight(.semibold)).foregroundStyle(Palette.ink).wraps()
                }
            }
            .sunRule()
            .accessibilityElement(children: .combine)
            if let topic {
                VStack(alignment: .leading, spacing: 2) {
                    lt(t.leadNote).font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft).wraps()
                    lt(t.about(topic)).font(.subheadline).foregroundStyle(Palette.inkSoft).wraps()
                }
                .accessibilityElement(children: .combine)
            }
            heldLine(res)
        }
    }

    @ViewBuilder
    private func heldLine(_ res: AskPaper.Response) -> some View {
        let n = AskPaper.held(res)
        if n > 0 { lt(t.held(n)).font(.caption2.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps() }
    }

    private func announce(_ s: String) {
        var said = AttributedString(s)
        said.languageIdentifier = Speaker.code(for: language)
        said.accessibilitySpeechAnnouncementPriority = .low
        AccessibilityNotification.Announcement(said).post()
    }

    private func ask() {
        let q = AskPaper.cleanQuestion(question)
        guard (q as NSString).length >= 3, phase != .loading else { return }
        task?.cancel()
        copied = false
        // An emergency question is never sent: 911 / 211 guidance instead.
        if AskPaper.isUrgentQuestion(q) {
            phase = .done(question: q, res: .urgent)
            announce(t.urgentTitle)
            return
        }
        phase = .loading
        announce(t.asking)
        let source = care.source_text, language = self.language, t = self.t
        task = Task {
            let next: Phase
            do {
                switch try await model.askPaper(sourceText: source, language: language, question: q) {
                case .refused(let status, let limit):
                    next = .error(AskPaper.errorMessage(status: status, limitHeader: limit, language: language))
                case .answer(let res):
                    next = .done(question: q, res: AskPaper.onThisPaper(res, source: source))
                }
            } catch {
                if (error as? APIError) == .cancelled { return }
                next = .error(t.error)
            }
            guard !Task.isCancelled else { return }
            phase = next
            switch next {
            case .error(let m): announce(m)
            case .done(_, .urgent): announce(t.urgentTitle)
            case .done(_, .notInPaper): announce(t.refusal)
            case .done(_, .answer(let quotes, _, _)): announce("\(t.paperLabel): \(quotes.map(\.text).joined(separator: " "))")
            default: break
            }
        }
    }
}

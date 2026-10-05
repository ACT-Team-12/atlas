import Accessibility
import SwiftUI

/// The care steps found in the paper, each one quoting the paper word for word. Paper first: unless the second check
/// certified a step's explanation, the paper's own words lead it.
struct CareStepsView: View {
    @Environment(AppModel.self) private var model
    @State private var speaker = Speaker()
    @State private var reminder: ReminderTarget?
    // Pip (Support/Pip.swift): the step just marked done, cheered for a moment, and whether the first-view heading
    // greeting is over (for good once a step is marked done here).
    @State private var cheering: String?
    @State private var greetOver = false
    @AppStorage(Pip.calmKey) private var calmSaved = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// "Walk me through it" (WalkThroughView): open while set. Its order is fixed when it starts.
    @State private var walk: WalkState?
    @AccessibilityFocusState private var walkButtonFocused: Bool

    var body: some View {
        ScrollView {
            if let care = model.care {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Your steps", note: "Each one is quoted from your paper.")
                    if model.careOutdated {
                        OutdatedNote(text: model.provenanceUnknown
                            ? "These steps were saved by an older version of ATLAS, so we can't tell which text, language or reading level they were read with. Read your paper again to update them."
                            : "You changed the text, language or reading level since this was read. Read your paper again to update these steps.")
                    }
                    // One warning section, as on the website: the pinned steps' own heading below when there are any; this banner only
                    // when the reading flags warnings but no shown step is pinned.
                    if model.hasWarnings && model.warningItems.isEmpty { WarningBanner() }

                    Text("\(care.stats.grounded) steps found in your paper · \(care.stats.refused) held back because we couldn't show their words from your paper · \(String(format: "%.1f", Double(care.stats.ms) / 1000))s")
                        .font(.footnote.weight(.bold)).foregroundStyle(Palette.inkSoft)

                    switch model.meaning.status {
                    case .loading:
                        Text("Double-checking each explanation against your paper...")
                            .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                    case .error:
                        Text("The double-check is not available right now, so each step shows your paper's own words first.")
                            .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                    case .idle, .done:
                        EmptyView()
                    }

                    // Paper first: read aloud carries an explanation only when it was certified; otherwise the paper's words.
                    // Always in the steps' own language, even while they are outdated.
                    // Unknown language (a plan saved by 1.0): no voice at all rather than a wrong one.
                    if let language = model.stepsLanguage {
                        ReadAloudBar(speaker: speaker, language: language, lines: readLines)
                    }

                    // "Walk me through it": the same steps, one at a time, in big type (web/src/lib/walkThrough.ts).
                    if !shownItems.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Button { startWalk() } label: {
                                Text(walkTagged(WalkThrough.line(model.language, .open)))
                            }
                            .buttonStyle(PillButtonStyle(fill: Palette.teal, text: Palette.paper))
                            .accessibilityHint(Text(walkTagged(WalkThrough.line(model.language, .openHint))))
                            .accessibilityFocused($walkButtonFocused)
                            Text(walkTagged(WalkThrough.line(model.language, .openHint)))
                                .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                                .accessibilityHidden(true)
                        }
                    }

                    // As on the website (CareSteps.tsx): warning signs pinned on top, then every other step in a time
                    // group read from the paper's own words (StepsWhen), "Right away" first.
                    let layout = self.layout(care)
                    if !layout.warnings.isEmpty {
                        StepGroupHeader(title: "Warning signs from your paper", count: layout.warnings.count,
                                        note: "If you have any of them right now, do what your paper says: call your clinic, or call 911.",
                                        warning: true)
                        ForEach(layout.warnings) { card($0, warning: true) }
                    }
                    // Pip's heading spot: the first-view greeting, or every step done. Reserved either way, beside the
                    // Calm mode switch, so nothing shifts when he comes or goes. Never beside the warning signs.
                    let pip = pipState(layout)
                    if !pip.order.isEmpty {
                        VStack(alignment: .trailing, spacing: 4) {
                            HStack(spacing: 8) {
                                Spacer()
                                CalmToggle()
                                PipSlot {
                                    if let mood = pip.drawn.heading {
                                        PipMarker(mood: mood, calm: pip.calm).id("\(model.readingCount):\(Pip.announceKey(pip.spot))")
                                    }
                                }
                            }
                            if pip.drawn.heading != nil && !pip.text.isEmpty {
                                PipBubble(text: pip.text, pointDown: pip.spot.isGreet)
                            }
                        }
                    }
                    ForEach(layout.groups) { g in
                        StepGroupHeader(title: g.group.label, count: g.items.count, note: g.group.note)
                        ForEach(g.items) { card($0, pip: pip) }
                    }

                    if !model.removedItems.isEmpty {
                        Card(border: Palette.ink.opacity(0.3)) {
                            Text("You removed \(model.removedItems.count)").font(.headline.weight(.heavy))
                            ForEach(model.removedItems) { r in
                                let label = KindStyle.of(r.kind).label
                                HStack {
                                    Text("\(label): your paper says \u{201C}\(r.source_quote)\u{201D}").font(.subheadline).wraps()
                                    Spacer()
                                    Button("Undo") { model.removed[r.id] = nil }
                                        .font(.subheadline.weight(.bold))
                                        .accessibilityLabel("Undo removing \(label): \(r.source_quote)")
                                }
                            }
                        }
                    }

                    if !care.not_in_document.isEmpty {
                        Card {
                            Text("What your paper does not say").font(.headline.weight(.heavy))
                            Text("Worth asking your clinic about.").font(.caption).foregroundStyle(Palette.inkSoft)
                            ForEach(Array(care.not_in_document.enumerated()), id: \.offset) { _, q in
                                Label(q, systemImage: "questionmark.bubble").font(.subheadline)
                            }
                        }
                    }

                    if !care.refused.isEmpty {
                        Card(border: Palette.ink.opacity(0.3)) {
                            Text("Held back to protect you (\(care.refused.count))").font(.headline.weight(.heavy))
                            Text("The AI suggested these, but the words aren't in your paper.").font(.caption).foregroundStyle(Palette.inkSoft)
                            ForEach(care.refused) { r in Text("• \(r.title)").font(.subheadline) }
                        }
                    }

                    // Where the website puts it: after the steps and the removed, not-in-paper and held-back lists, before moving on.
                    MissedLinesSection(view: model.missedLines)

                    // "Ask my paper": answers only in the paper's own words, checked, or "your paper doesn't say". Off while
                    // the text on screen differs from the one read: it would answer from the old text. A new reading or
                    // language starts it fresh.
                    if !model.careOutdated {
                        AskPaperView(care: care, items: model.items, language: model.language)
                            .id("\(model.readingCount):\(model.language.rawValue):\(care.source_text.count)")
                    }

                    if model.careOutdated {
                        Button("Read my paper again") {
                            speaker.stop()
                            model.readPaper()
                        }
                        .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper, shadow: Palette.mint))
                        .disabled(!model.canRead)
                    } else {
                        Button("Next: what gets in the way?") {
                            speaker.stop()
                            model.path.append(.barriers)
                        }
                        .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper, shadow: Palette.mint))
                    }
                }
                .padding(16)
            } else {
                Text("No steps yet. Go back and read your paper.").padding()
            }
        }
        .screenBackground()
        .navigationTitle("Step 1 of 3")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { speaker.stop() }
        .sheet(item: $reminder) { ReminderSheet(target: $0) }
        .fullScreenCover(isPresented: Binding(get: { walk != nil }, set: { if !$0 { walk = nil } })) {
            if let care = model.care {
                let pip = pipState(layout(care))
                WalkThroughView(state: $walk, spot: pip.spot, calm: pip.calm, markDone: markDone)
                    .environment(model)
            }
        }
        // Back on the list: VoiceOver returns to the button that opened the walk-through.
        .onChange(of: walk == nil) { _, closed in if closed { walkButtonFocused = true } }
        // A new reading ("Read my paper again" replaces the steps in place) is a new first view, as on the website, which
        // keys its steps on the run.
        .onChange(of: model.readingCount) { cheering = nil; greetOver = false }
        // A cheer lasts a moment, then Pip moves on.
        .task(id: cheering) {
            guard cheering != nil else { return }
            try? await Task.sleep(for: .seconds(Pip.cheerSeconds))
            if !Task.isCancelled { cheering = nil }
        }
        // What Pip says is read once, politely (queued behind what VoiceOver is already saying). Keyed on where he is too,
        // so a second "Nice, that's done" on another step is still read.
        .task(id: pipAnnouncement) {
            guard let text = pipAnnouncement?.text, !text.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            var said = AttributedString(text)
            said.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(said).post()
        }
    }

    private func layout(_ care: CarePlanResponse) -> (warnings: [VerifiedItem], groups: [StepGroup]) {
        StepsWhen.grouped(model.items, check: { model.check(for: $0) }, paper: care.source_text)
    }

    /// Where Pip is on this screen (pipSpot on the website): on the first step not done in the order shown, earliest
    /// group first; warning signs are never his spot.
    struct PipState {
        let order: [Pip.Step]
        let spot: Pip.Spot
        let drawn: Pip.Drawn
        let text: String
        let calm: Bool
    }

    private func pipState(_ layout: (warnings: [VerifiedItem], groups: [StepGroup])) -> PipState {
        let order = layout.groups.flatMap(\.items).map { Pip.Step(id: $0.id, kind: $0.kind) }
        let spot = Pip.spot(order, done: model.done, check: { model.check(for: $0) }, cheering: cheering,
                            greet: Pip.greetAllowed(greetOver: greetOver, done: model.done))
        return PipState(order: order, spot: spot, drawn: Pip.drawn(spot), text: spot.line.map { Pip.line(model.language, $0) } ?? "",
                        calm: Pip.calm(reduceMotion: reduceMotion, saved: calmSaved))
    }

    private struct Announcement: Equatable { let key: String; let text: String }

    private var pipAnnouncement: Announcement? {
        guard let care = model.care else { return nil }
        let s = pipState(layout(care))
        return Announcement(key: "\(model.readingCount):\(Pip.announceKey(s.spot))", text: s.text)
    }

    /// Numbered and read in the order shown, so "step 3" is the third card a person sees.
    private var shownItems: [VerifiedItem] {
        guard let care = model.care else { return [] }
        let l = layout(care)
        return l.warnings + l.groups.flatMap(\.items)
    }

    /// `warning`: a pinned warning sign, which has no Pip slot at all (Pip is never on or beside them).
    private func card(_ item: VerifiedItem, warning: Bool = false, pip: PipState? = nil) -> some View {
        let check = model.check(for: item.id)
        let here = pip?.drawn.card.flatMap { $0.id == item.id ? $0 : nil }
        return CareItemCard(item: item, check: check, result: model.meaning.result(for: item.id),
                            checking: model.meaning.status == .loading, errored: model.meaning.status == .error,
                            pipSlot: !warning, pip: here, pipText: here?.line == nil ? "" : (pip?.text ?? ""),
                            calm: pip?.calm ?? false, reading: model.readingCount,
                            done: doneBinding(item.id)) {
            // A reminder never carries the AI's title; its "when" only when certified (bookSafe in paperFirst.ts).
            reminder = ReminderTarget(title: PaperFirst.bookTitle(kind: item.kind), quote: item.source_quote,
                                      detail: PaperFirst.bookWhen(item, check: check))
        } onRemove: {
            model.removed[item.id] = true
        }
    }

    private var readLines: [String] {
        shownItems.enumerated().flatMap { i, it in
            ["\(i + 1)."] + PaperFirst.lines(PaperFirst.careStep(it, check: model.check(for: it.id)))
        }
    }

    /// Marking a step done also starts Pip's short cheer there (only on a non-quiet step, Pip.spot decides), and ends the
    /// first-view greeting for good.
    private func doneBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { model.done[id] == true }, set: { markDone(id, $0) })
    }

    /// One way to mark a step done, for the list and the walk-through alike: the same saved record, Pip's cheer, the end
    /// of the first-view greeting.
    private func markDone(_ id: String, _ value: Bool) {
        model.done[id] = value
        cheering = value ? id : nil
        if value { greetOver = true }
    }

    /// Starts on the first step not done (or the first step when all are), with the order fixed from here on.
    private func startWalk() {
        let ids = shownItems.map(\.id)
        guard !ids.isEmpty else { return }
        speaker.stop()
        let at = WalkThrough.nextOpen(ids, done: model.done, from: 0)
        walk = WalkState(ids: ids, at: ids[at < 0 ? 0 : at])
    }

    /// A walk-through line tagged with the person's language, so VoiceOver reads it in that voice.
    private func walkTagged(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        a.languageIdentifier = Speaker.code(for: model.language)
        return a
    }
}

/// A time group's heading (CareSteps.tsx): its label, how many steps, and its note when it has one.
struct StepGroupHeader: View {
    let title: String
    let count: Int
    var note: String?
    var warning = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.weight(.heavy)).foregroundStyle(warning ? Palette.red : Palette.ink).wraps()
                Spacer()
                Text("\(count) \(count == 1 ? "step" : "steps")").font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
            }
            if let note { Text(note).font(.caption.weight(.semibold)).foregroundStyle(warning ? Palette.red : Palette.inkSoft).wraps() }
        }
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct CareItemCard: View {
    let item: VerifiedItem
    let check: Check
    let result: MeaningResult?
    let checking: Bool
    /// The second check failed: the step still says "Checked once", as on the website.
    var errored = false
    /// Pip's reserved spot on the trailing edge (every step card but a warning sign keeps it, so text never moves when he
    /// hops), Pip himself when he is on this card, what he says here, and calm mode.
    var pipSlot = false
    var pip: Pip.Drawn.Card?
    var pipText = ""
    var calm = false
    /// The reading this card belongs to, so Pip arrives again on a new reading even when step ids repeat.
    var reading = 0
    @Binding var done: Bool
    let onRemind: () -> Void
    let onRemove: () -> Void

    var body: some View {
        let style = KindStyle.of(item.kind)
        // Styled as a warning exactly when it is pinned as one: the model's kind or the paper's own words.
        let warning = WarningPin.isWarning(item)
        let certified = check == .certified
        // The AI's title is only a label once it is certified; otherwise the card is named by its kind.
        let name = certified ? item.title : style.label
        Card(background: warning ? Palette.redSoft.opacity(0.6) : Palette.paper, border: warning ? Palette.red : Palette.ink.opacity(0.75)) {
            HStack(alignment: .top, spacing: 12) {
                Button { done.toggle() } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.title2).foregroundStyle(done ? Palette.teal : Palette.ink.opacity(0.6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(done ? "Done: \(name)" : "Mark \(name) done")
                .accessibilityAddTraits(done ? .isSelected : [])

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Chip(text: style.label, background: style.background, foreground: style.foreground)
                        if certified && !item.when.isEmpty {
                            Text(item.when).font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
                        }
                    }
                    if certified {
                        Text(item.title).font(.headline.weight(.heavy)).foregroundStyle(Palette.ink)
                            .strikethrough(done, color: Palette.ink.opacity(0.4)).wraps()
                    }
                    PaperFirstBlock(view: PaperFirst.careStep(item, check: check), done: done && !certified)
                    // Not certified: the AI's question stays off the card; AskPersonBox below offers the paper's words instead.
                    if certified && item.needs_clarification && !item.question_for_clinic.isEmpty {
                        Text("Ask your clinic: \(item.question_for_clinic)")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.peachDeep).wraps()
                            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.peach, in: RoundedRectangle(cornerRadius: 12))
                    }
                    CheckStatus(result: result, checking: checking, errored: errored)
                    if let ask = PaperFirst.askPerson(kind: item.kind, quote: item.source_quote, check: check) {
                        AskPersonBox(ask: ask)
                    }
                    HStack {
                        Button { onRemind() } label: { Label("Remind me", systemImage: "bell.badge") }
                            .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                            .accessibilityLabel("Remind me about \(name)")
                        Spacer()
                        Button("Remove") { onRemove() }
                            .font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
                            .accessibilityLabel("Remove \(name)")
                    }
                }
                if pipSlot {
                    PipSlot {
                        if let pip { PipMarker(mood: pip.mood, calm: calm).id("\(reading):\(pip.id):\(pip.mood.rawValue)") }
                    }
                }
            }
            if pip?.line != nil && !pipText.isEmpty {
                HStack { Spacer(); PipBubble(text: pipText) }
            }
        }
    }
}

/// "Ask your pharmacist" / "Ask your clinic" (askPerson in web/src/lib/askPerson.ts): a question in the paper's own
/// words, opened on tap, to show, read out or copy.
struct AskPersonBox: View {
    let ask: PaperFirst.AskPerson
    @State private var open = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { open.toggle() } label: { Label(ask.label, systemImage: "person.bubble") }
                .buttonStyle(OutlinePillStyle(fill: Palette.sun))
                .accessibilityAddTraits(open ? .isSelected : [])
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    Text(ask.who == "pharmacist" ? "Show or read this to your pharmacist. It uses only your paper's words."
                                                 : "Show or read this to your clinic. It uses only your paper's words.")
                        .font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft).wraps()
                    Text(ask.question).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).wraps()
                    Button(copied ? "Copied" : "Copy question") {
                        UIPasteboard.general.string = ask.question
                        copied = true
                    }
                    .font(.caption.weight(.bold))
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.ink.opacity(0.4), style: StrokeStyle(lineWidth: 2, dash: [5])))
            }
        }
    }
}

/// The second check's verdict for one step, in the same words as the website (web/src/ui/CarePlanTool.tsx).
struct CheckStatus: View {
    let result: MeaningResult?
    let checking: Bool
    var errored = false

    var body: some View {
        if checking {
            Text("Double-checking this against your paper...").font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft)
        } else if let result {
            if result.flagged {
                Text(Self.flaggedText(result))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.peachDeep).wraps()
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.peach, in: RoundedRectangle(cornerRadius: 12))
            } else if result.certified {
                Text("\u{2713} \(Self.checkedTwice)").font(.caption.weight(.bold)).foregroundStyle(Palette.tealDeep).wraps()
            } else {
                // Checked once: the long reason waits behind "Why?" (the website's details element).
                DisclosureGroup {
                    Text("\(PaperFirst.checkedOnce) Our second check couldn't confirm this one.")
                        .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                } label: {
                    Text("Checked once · Why?").font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
                }
                .tint(Palette.inkSoft)
            }
        } else if errored {
            // The check failed (SEAL_TEXT.once on the website, with no result to add to it).
            DisclosureGroup {
                Text(PaperFirst.checkedOnce)
                    .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
            } label: {
                Text("Checked once · Why?").font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
            }
            .tint(Palette.inkSoft)
        }
    }

    /// SEAL_TEXT.twice in web/src/lib/stepsView.ts.
    nonisolated static let checkedTwice = "Checked twice: the words are on your paper, and a second check agrees with the explanation."

    nonisolated static func flaggedText(_ r: MeaningResult) -> String {
        var text = "Double-check this one with your clinic: our second check says the explanation may not match your paper."
        let what = r.what_differs
        if !what.isEmpty { text += " " + what.prefix(1).uppercased() + what.dropFirst() }
        if !r.unexpected_numbers.isEmpty { text += " (Number not in your paper: \(r.unexpected_numbers.joined(separator: ", ")).)" }
        return text
    }
}

/// Paper first (web/src/ui/PaperFirst.tsx). Certified: the explanation leads and the quote follows. Otherwise the
/// paper's words lead, labelled, and the explanation is secondary with its note.
struct PaperFirstBlock: View {
    let view: PaperFirst.StepView
    var done = false

    var body: some View {
        if view.quote.isEmpty {
            EmptyView()
        } else if view.explanationLeads {
            if let e = view.explanation { Text(e).font(.body).foregroundStyle(Palette.ink).wraps() }
            PaperQuote(quote: view.quote)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text(view.screenLabel.uppercased())
                    .font(.caption2.weight(.heavy)).foregroundStyle(Palette.tealDeep)
                Text("\u{201C}\(view.quote)\u{201D}")
                    .font(.body.weight(.semibold)).foregroundStyle(Palette.ink)
                    .strikethrough(done, color: Palette.ink.opacity(0.4))
                    .wraps()
            }
            .sunRule()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(view.screenLabel): \(view.quote)")
            if let e = view.explanation {
                VStack(alignment: .leading, spacing: 2) {
                    if let note = view.note { Text(note).font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft).wraps() }
                    Text(e).font(.subheadline).foregroundStyle(Palette.inkSoft).wraps()
                }
            }
        }
    }
}

/// Shown when what is on screen no longer matches what was entered (StaleGuard).
struct OutdatedNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.peachDeep).wraps()
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.peach, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Read aloud with a visible Stop button.
struct ReadAloudBar: View {
    let speaker: Speaker
    let language: Language
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if speaker.isSpeaking {
                Button { speaker.stop() } label: { Label("Stop reading", systemImage: "stop.fill") }
                    .buttonStyle(OutlinePillStyle(fill: Palette.peach))
                    .accessibilityLabel("Stop reading out loud")
            } else {
                Button { speaker.speak(lines: lines, language: language) } label: {
                    Label("Read it out loud", systemImage: "speaker.wave.2.fill")
                }
                .buttonStyle(OutlinePillStyle(fill: Palette.sun))
                .accessibilityHint("Reads in \(language.rawValue)")
            }
            if let note = speaker.missingVoiceNote {
                Text(note).font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft)
            }
        }
    }
}

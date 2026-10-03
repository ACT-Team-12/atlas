import SwiftUI

/// The care steps found in the paper, each one quoting the paper word for word. Paper first: unless the second check
/// certified a step's explanation, the paper's own words lead it.
struct CareStepsView: View {
    @Environment(AppModel.self) private var model
    @State private var speaker = Speaker()
    @State private var reminder: ReminderTarget?

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
                    if care.has_warning_signs { WarningBanner() }

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

                    ForEach(model.items) { item in
                        let check = model.check(for: item.id)
                        CareItemCard(item: item, check: check, result: model.meaning.result(for: item.id),
                                     checking: model.meaning.status == .loading, done: doneBinding(item.id)) {
                            // A reminder never carries the AI's title; its "when" only when certified (bookSafe in paperFirst.ts).
                            reminder = ReminderTarget(title: PaperFirst.bookTitle(kind: item.kind), quote: item.source_quote,
                                                      detail: PaperFirst.bookWhen(item, check: check))
                        } onRemove: {
                            model.removed[item.id] = true
                        }
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
    }

    private var readLines: [String] {
        model.items.enumerated().flatMap { i, it in
            ["\(i + 1)."] + PaperFirst.lines(PaperFirst.careStep(it, check: model.check(for: it.id)))
        }
    }

    private func doneBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { model.done[id] == true }, set: { model.done[id] = $0 })
    }
}

struct CareItemCard: View {
    let item: VerifiedItem
    let check: Check
    let result: MeaningResult?
    let checking: Bool
    @Binding var done: Bool
    let onRemind: () -> Void
    let onRemove: () -> Void

    var body: some View {
        let style = KindStyle.of(item.kind)
        let warning = item.itemKind == .warning_sign
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
                    if item.needs_clarification && !item.question_for_clinic.isEmpty {
                        Text("Ask your clinic: \(item.question_for_clinic)")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.peachDeep).wraps()
                            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.peach, in: RoundedRectangle(cornerRadius: 12))
                    }
                    CheckStatus(result: result, checking: checking)
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
            }
        }
    }
}

/// The second check's verdict for one step, in the same words as the website (web/src/ui/CarePlanTool.tsx).
struct CheckStatus: View {
    let result: MeaningResult?
    let checking: Bool

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
                Text("\u{2713} Double-checked: the explanation matches this line").font(.caption.weight(.bold)).foregroundStyle(Palette.tealDeep)
            } else {
                Text("Not double-checked: our second check couldn't confirm this one. Read the line from your paper above.")
                    .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
            }
        }
    }

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
            Text("\(view.quoteLabel) \u{201C}\(view.quote)\u{201D}")
                .font(.body.weight(.semibold)).foregroundStyle(Palette.ink)
                .strikethrough(done, color: Palette.ink.opacity(0.4))
                .wraps().sunRule()
                .accessibilityLabel("\(view.quoteLabel) \(view.quote)")
            if let e = view.explanation {
                Text("\(view.note ?? "") \(e)".trimmingCharacters(in: .whitespaces))
                    .font(.subheadline).foregroundStyle(Palette.inkSoft).wraps()
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

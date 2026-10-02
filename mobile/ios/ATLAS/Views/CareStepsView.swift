import SwiftUI

/// The care steps found in the paper, each one quoting the paper word for word.
struct CareStepsView: View {
    @Environment(AppModel.self) private var model
    @State private var speaker = Speaker()
    @State private var reminder: ReminderTarget?

    var body: some View {
        ScrollView {
            if let care = model.care {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Your steps", note: "Each one is quoted from your paper.")
                    if care.has_warning_signs { WarningBanner() }

                    Text("\(care.stats.grounded) steps found in your paper · \(care.stats.refused) held back because we couldn't find the words · \(String(format: "%.1f", Double(care.stats.ms) / 1000))s")
                        .font(.footnote.weight(.bold)).foregroundStyle(Palette.inkSoft)

                    ReadAloudBar(speaker: speaker, language: model.language, lines: readLines)

                    ForEach(model.items) { item in
                        CareItemCard(item: item, done: doneBinding(item.id)) {
                            reminder = ReminderTarget(title: item.title, quote: item.source_quote)
                        } onRemove: {
                            model.removed[item.id] = true
                        }
                    }

                    if !model.removedItems.isEmpty {
                        Card(border: Palette.ink.opacity(0.3)) {
                            Text("You removed \(model.removedItems.count)").font(.headline.weight(.heavy))
                            ForEach(model.removedItems) { r in
                                HStack {
                                    Text(r.title).font(.subheadline)
                                    Spacer()
                                    Button("Undo") { model.removed[r.id] = nil }
                                        .font(.subheadline.weight(.bold))
                                        .accessibilityLabel("Undo removing \(r.title)")
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

                    Button("Next: what gets in the way?") {
                        speaker.stop()
                        model.path.append(.barriers)
                    }
                    .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper, shadow: Palette.mint))
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
        model.items.enumerated().map { i, it in "\(i + 1). \(it.title). \(it.plain_language)" }
    }

    private func doneBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { model.done[id] == true }, set: { model.done[id] = $0 })
    }
}

struct CareItemCard: View {
    let item: VerifiedItem
    @Binding var done: Bool
    let onRemind: () -> Void
    let onRemove: () -> Void

    var body: some View {
        let style = KindStyle.of(item.kind)
        let warning = item.itemKind == .warning_sign
        Card(background: warning ? Palette.redSoft.opacity(0.6) : Palette.paper, border: warning ? Palette.red : Palette.ink.opacity(0.75)) {
            HStack(alignment: .top, spacing: 12) {
                Button { done.toggle() } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.title2).foregroundStyle(done ? Palette.teal : Palette.ink.opacity(0.6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(done ? "Done: \(item.title)" : "Mark \(item.title) done")
                .accessibilityAddTraits(done ? .isSelected : [])

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Chip(text: style.label, background: style.background, foreground: style.foreground)
                        if !item.when.isEmpty {
                            Text(item.when).font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
                        }
                    }
                    Text(item.title).font(.headline.weight(.heavy)).foregroundStyle(Palette.ink)
                        .strikethrough(done, color: Palette.ink.opacity(0.4))
                    Text(item.plain_language).font(.body).foregroundStyle(Palette.ink)
                    if item.needs_clarification && !item.question_for_clinic.isEmpty {
                        Text("Ask your clinic: \(item.question_for_clinic)")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.peachDeep)
                            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.peach, in: RoundedRectangle(cornerRadius: 12))
                    }
                    PaperQuote(quote: item.source_quote)
                    HStack {
                        Button { onRemind() } label: { Label("Remind me", systemImage: "bell.badge") }
                            .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                            .accessibilityLabel("Remind me about \(item.title)")
                        Spacer()
                        Button("Remove") { onRemove() }
                            .font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft)
                            .accessibilityLabel("Remove \(item.title)")
                    }
                }
            }
        }
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

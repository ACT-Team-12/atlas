import Accessibility
import SwiftUI

/// Where the walk-through is: a step (by id, so a check that lands and regroups the list never swaps the step under the
/// person) or the closing screen. The order is fixed when the walk starts (`ids`): a late check can move a step to
/// another time group, and the walk must neither skip it nor show it twice. Each step still shows its current group.
struct WalkState: Equatable, Identifiable {
    var ids: [String]
    /// The step shown, or nil for the closing screen.
    var at: String?
    var id: String { "walk" }
}

/// "Walk me through it" (web/src/ui/CareSteps.tsx, WalkThrough and WalkCard): one step per screen, big type. The step's
/// own words follow the paper-first rule exactly as the list does (PaperFirstBlock), so unconfirmed AI words keep their
/// "not double-checked yet" label. Done marks the step done the same way the list's tick does; Not yet moves on and leaves
/// it open; Ask a person opens the step's own "Ask your pharmacist / clinic" help. VoiceOver focus moves to the step's
/// heading on every change; the escape gesture (two-finger scrub) goes back to the list.
struct WalkThroughView: View {
    @Environment(AppModel.self) private var model
    @Binding var state: WalkState?
    /// The list's own Pip spot (CareStepsView.pipState), so Pip follows exactly one set of rules.
    let spot: Pip.Spot
    let calm: Bool
    let markDone: (String, Bool) -> Void
    @State private var speaker = Speaker()
    @State private var asking = false
    @AccessibilityFocusState private var headingFocused: Bool

    private var walk: [WalkThrough.Step<VerifiedItem>] {
        guard let care = model.care else { return [] }
        return WalkThrough.steps(model.items, isWarning: WarningPin.isWarning,
                                 groupOf: { StepsWhen.step($0, check: model.check(for: $0.id), paper: care.source_text).group })
    }

    /// The walk's own order, each step with its current group. A step removed meanwhile drops out.
    private var seq: [WalkThrough.Step<VerifiedItem>] {
        let now = walk
        return (state?.ids ?? []).compactMap { id in now.first { $0.it.id == id } }
    }

    private var language: Language { model.language }

    var body: some View {
        let seq = self.seq
        let index = state?.at.flatMap { at in seq.firstIndex { $0.it.id == at } } ?? -1
        let step = index >= 0 ? seq[index] : nil
        let shownPip = step.flatMap { s in
            WalkThrough.pip(spot, shownID: s.it.id, shownKind: s.it.kind, check: model.check(for: s.it.id), warning: s.group == .warning)
        }
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Color.clear.frame(height: 0).id("top")
                        if let step {
                            card(step, index: index, seq: seq, pip: shownPip)
                        } else {
                            end(seq)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: state?.at) {
                    asking = false
                    speaker.stop()
                    // Each new step starts at the top, with VoiceOver on its heading. No animation.
                    proxy.scrollTo("top", anchor: .top)
                    headingFocused = true
                }
            }
            .screenBackground()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { exit() } label: { Label { tl(.back) } icon: { Image(systemName: "chevron.left") } }
                        .labelStyle(.titleAndIcon)
                }
            }
        }
        .accessibilityAction(.escape) { exit() }
        .onAppear { headingFocused = true }
        .onDisappear { speaker.stop() }
        // The step's check changed while it was read (a late check that disagrees): the queued lines no longer match.
        .onChange(of: step.map { model.check(for: $0.it.id) }) { speaker.stop() }
        // While walking, Pip speaks only about the step on screen, by the same quiet rules, politely.
        .task(id: "\(state?.at ?? "end"):\(shownPip?.mood.rawValue ?? "none")") {
            guard let line = shownPip?.line else { return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            var said = AttributedString(Pip.line(language, line))
            said.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(said).post()
        }
    }

    // MARK: Pieces

    /// A fixed walk-through line in the person's language, tagged with that language for VoiceOver (the paper's words
    /// around it keep their own).
    private func tl(_ line: WalkThrough.Line, _ values: [String: Int] = [:]) -> Text {
        Text(tagged(WalkThrough.line(language, line, values)))
    }

    private func tagged(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        a.languageIdentifier = Speaker.code(for: language)
        return a
    }

    private func announce(_ line: WalkThrough.Line) {
        AccessibilityNotification.Announcement(tagged(WalkThrough.line(language, line))).post()
    }

    private func go(_ at: String?) {
        speaker.stop()
        state?.at = at
    }

    private func exit() {
        speaker.stop()
        state = nil
    }

    private func bigButton(fill: Color, text: Color = Palette.ink) -> some ButtonStyle {
        BigWalkButtonStyle(fill: fill, text: text)
    }

    @ViewBuilder
    private func card(_ step: WalkThrough.Step<VerifiedItem>, index: Int, seq: [WalkThrough.Step<VerifiedItem>], pip: WalkThrough.ShownPip?) -> some View {
        let it = step.it
        let warn = step.group == .warning
        let check = model.check(for: it.id)
        let done = model.done[it.id] == true
        let style = KindStyle.of(it.kind)
        let next = index + 1 < seq.count ? seq[index + 1].it.id : nil
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    tl(.progress, ["n": index + 1, "total": seq.count])
                        .font(.headline.weight(.heavy)).foregroundStyle(Palette.inkSoft).textCase(.uppercase)
                    Group {
                        switch step.group {
                        case .warning: tl(.warningLabel)
                        case .when(let g): Text(g.label)
                        }
                    }
                    .font(.system(.title, design: .rounded).weight(.black))
                    .foregroundStyle(warn ? Palette.red : Palette.ink).wraps()
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($headingFocused)
                Spacer()
                // Pip's reserved spot, as on a list card; never on a warning sign.
                if !warn {
                    PipSlot { if let pip { PipMarker(mood: pip.mood, calm: calm).id("walk:\(it.id):\(pip.mood.rawValue)") } }
                }
            }
            if let line = pip?.line {
                HStack { Spacer(); PipBubble(text: Pip.line(language, line)) }
            }
            ProgressView(value: Double(index + 1), total: Double(max(seq.count, 1)))
                .tint(Palette.teal).accessibilityHidden(true)
            if case .when(let g) = step.group, let note = g.note {
                Text(note).font(.body.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
            }
            HStack(spacing: 8) {
                Chip(text: style.label, background: style.background, foreground: style.foreground)
                Text(Self.sealShort(check)).font(.subheadline.weight(.bold))
                    .foregroundStyle(check == .flagged ? Palette.peachDeep : Palette.inkSoft)
            }
            // The paper's words, by the same rule as the list (PaperFirstBlock), only bigger.
            PaperFirstBlock(view: PaperFirst.careStep(it, check: check))
                .dynamicTypeSize(.xxLarge ... .accessibility5)
            // After the paper's words, never before them: the paper says what to do; this line only points back to it.
            if warn {
                tl(.warningDo).font(.title3.weight(.bold)).foregroundStyle(Palette.red).wraps()
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.redSoft, in: RoundedRectangle(cornerRadius: 14))
            }
            if check == .certified, let q = PaperFirst.stepVisitQuestion(it, check: check) {
                Text("On your questions list: \(q)").font(.body.weight(.semibold)).foregroundStyle(Palette.peachDeep).wraps()
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.peach, in: RoundedRectangle(cornerRadius: 14))
            }
            if done {
                HStack(spacing: 12) {
                    (Text("\u{2713} ") + tl(.doneAlready)).font(.title3.weight(.heavy)).foregroundStyle(Palette.tealDeep)
                    Button {
                        markDone(it.id, false)
                        announce(.undoDone)
                        headingFocused = true
                    } label: { tl(.undoDone) }
                    .buttonStyle(OutlinePillStyle())
                }
            }
            // Read aloud by the paper-first rule (the explanation only when certified), in the steps' own language.
            // Unknown language (steps saved by 1.0): no voice at all rather than a wrong one, as on the list.
            if let voice = model.stepsLanguage {
                Button {
                    if speaker.isSpeaking { speaker.stop() } else { speaker.speak(lines: PaperFirst.lines(PaperFirst.careStep(it, check: check)), language: voice) }
                } label: {
                    Label { speaker.isSpeaking ? tl(.stop) : tl(.readAloud) } icon: { Image(systemName: speaker.isSpeaking ? "stop.fill" : "speaker.wave.2.fill") }
                }
                .buttonStyle(OutlinePillStyle(fill: speaker.isSpeaking ? Palette.peach : Palette.paper))
                .frame(minHeight: 48)
                if let note = speaker.missingVoiceNote { Text(note).font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps() }
            }
            VStack(spacing: 12) {
                Button {
                    markDone(it.id, true)
                    announce(.doneAlready)
                    go(next)
                } label: { (Text("\u{2713} ") + tl(.done)) }
                .buttonStyle(bigButton(fill: Palette.teal, text: Palette.paper))
                Button { go(next) } label: { (tl(.notYet) + Text(" \u{2192}")) }
                    .buttonStyle(bigButton(fill: Palette.paper))
                Button { asking.toggle() } label: { tl(.askPerson) }
                    .buttonStyle(bigButton(fill: Palette.sun))
                    .accessibilityAddTraits(asking ? .isSelected : [])
            }
            if asking {
                VStack(alignment: .leading, spacing: 8) {
                    tl(.askTitle).font(.headline.weight(.heavy))
                    if warn {
                        tl(.warningDo).font(.body.weight(.bold)).foregroundStyle(Palette.red).wraps()
                    } else {
                        if let ask = PaperFirst.askPerson(kind: it.kind, quote: it.source_quote, check: check) {
                            AskPersonBody(ask: ask)
                        } else {
                            tl(.askClinicCall).font(.body.weight(.semibold)).wraps()
                        }
                        tl(.ask211).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.ink.opacity(0.4), style: StrokeStyle(lineWidth: 2, dash: [5])))
            }
            if index > 0 {
                Button { go(seq[index - 1].it.id) } label: { Text("\u{2190} ") + tl(.previous) }
                    .font(.body.weight(.bold)).underline().foregroundStyle(Palette.ink).frame(minHeight: 48)
            }
        }
        .padding(warn ? 12 : 0)
        .overlay {
            if warn { RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.red, lineWidth: 4) }
        }
    }

    @ViewBuilder
    private func end(_ seq: [WalkThrough.Step<VerifiedItem>]) -> some View {
        let ids = seq.map(\.it.id)
        let doneCount = ids.filter { model.done[$0] == true }.count
        let firstOpen = WalkThrough.nextOpen(ids, done: model.done, from: 0)
        VStack(alignment: .leading, spacing: 14) {
            tl(.finished).font(.system(.largeTitle, design: .rounded).weight(.black)).foregroundStyle(Palette.ink).wraps()
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($headingFocused)
            tl(.finishedCount, ["done": doneCount, "total": seq.count]).font(.title3.weight(.bold)).wraps()
            if firstOpen >= 0 {
                Button { go(ids[firstOpen]) } label: { tl(.startOver) }
                    .buttonStyle(bigButton(fill: Palette.sun))
            }
            Button { exit() } label: { tl(.back) }
                .buttonStyle(bigButton(fill: Palette.teal, text: Palette.paper))
        }
    }

    /// SEAL_SHORT in web/src/lib/stepsView.ts.
    static func sealShort(_ check: Check) -> String {
        switch check {
        case .certified: "Checked twice"
        case .flagged: "Double-check this"
        case .unchecked: "Checked once"
        }
    }
}

/// The walk-through's big buttons: at least 56 points tall, full width, ink border and a hard shadow.
struct BigWalkButtonStyle: ButtonStyle {
    var fill: Color
    var text: Color = Palette.ink

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.heavy))
            .foregroundStyle(text)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.ink, lineWidth: 2.5))
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.ink).offset(y: configuration.isPressed ? 1 : 3))
            .offset(y: configuration.isPressed ? 2 : 0)
    }
}

/// What "Ask your pharmacist" / "Ask your clinic" shows (AskPersonBody on the website): who to show it to, the question
/// in the paper's own words, and a copy button.
struct AskPersonBody: View {
    let ask: PaperFirst.AskPerson
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(ask.who == "pharmacist" ? "Show or read this to your pharmacist. It uses only your paper's words."
                                         : "Show or read this to your clinic. It uses only your paper's words.")
                .font(.subheadline.weight(.bold)).foregroundStyle(Palette.inkSoft).wraps()
            Text(ask.question).font(.body.weight(.semibold)).foregroundStyle(Palette.ink).wraps()
            Button(copied ? "Copied" : "Copy question") {
                UIPasteboard.general.string = ask.question
                copied = true
            }
            .buttonStyle(OutlinePillStyle())
            .frame(minHeight: 48)
        }
    }
}

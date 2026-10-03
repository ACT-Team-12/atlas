import SwiftUI

/// "Lines on your paper we didn't turn into steps" (web/src/ui/MissedLines.tsx): instruction-like sentences no kept step
/// quotes, collapsed behind one heading. Shows nothing when the server could not check the paper (or sent no check), so
/// it never claims "all covered" for a paper it could not read.
struct MissedLinesSection: View {
    let view: MissedLinesView
    @State private var open = false

    var body: some View {
        let message = MissedLines.announcement(view)
        Group { content }
        // Like the website's polite live region: the message is spoken a moment after it appears, and again whenever a
        // removed or restored step changes it (same 400 ms). Queued behind what VoiceOver is saying, never interrupting.
        .task(id: message) {
            guard !message.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            var spoken = AttributedString(message)
            spoken.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(spoken).post()
        }
    }

    @ViewBuilder private var content: some View {
        if case let .shown(_, _, _, lines) = view {
            if lines.isEmpty {
                Card(background: Palette.mintSoft, border: Palette.ink.opacity(0.7)) {
                    Text("\u{2713} \(MissedLines.allInAStep)").font(.headline.weight(.heavy)).wraps()
                        .accessibilityLabel(MissedLines.allInAStep)
                    Text(MissedLines.allInAStepNote).font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                }
            } else {
                let badge = MissedLines.lineCountLabel(lines.count)
                Card(border: Palette.ink.opacity(0.7)) {
                    Button { open.toggle() } label: {
                        HStack(spacing: 10) {
                            Text(MissedLines.title).font(.headline.weight(.heavy)).foregroundStyle(Palette.ink)
                                .multilineTextAlignment(.leading).wraps()
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(badge).font(.caption.weight(.heavy)).foregroundStyle(Palette.ink)
                                .padding(.horizontal, 10).padding(.vertical, 3)
                                .background(Palette.sun, in: Capsule())
                                .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2))
                            Image(systemName: open ? "chevron.up" : "chevron.down").foregroundStyle(Palette.ink)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(MissedLines.title), \(badge)")
                    .accessibilityValue(open ? "Expanded" : "Collapsed")
                    .accessibilityHint(open ? "Hides the lines" : "Shows the lines")
                    .accessibilityAddTraits([.isHeader, .isButton])

                    if open {
                        Text(MissedLines.readThese).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            Text("\u{201C}\(line.text)\u{201D}").font(.subheadline).foregroundStyle(Palette.ink).wraps()
                                .frame(maxWidth: .infinity, alignment: .leading).sunRule()
                        }
                        Text(MissedLines.canMiss).font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                    }
                }
            }
        }
    }
}

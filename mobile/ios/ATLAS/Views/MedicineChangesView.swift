import SwiftUI

/// "Your medicine changes" (web/src/ui/MedicineChanges.tsx): every medicine step sorted into Stop, Change, Start (and
/// Keep taking, only when the paper says to continue), Stop first. Each line shows the paper's own words, never the AI's.
/// A Change line shows an old and a new dose only when both are written in the paper's line; the strike-through is also
/// said in words ("was 10 mg, now 20 mg"). Each line goes to its step in the list below. No Pip here: Pip stays quiet
/// around medicine.
struct MedicineChangesView: View {
    let items: [VerifiedItem]
    let paper: String
    let onGo: (String) -> Void

    private static func look(_ row: MedicineChanges.Row) -> (mark: String, border: Color, fill: Color, text: Color, dashed: Bool) {
        switch row {
        case .stop: ("\u{2715}", Palette.red, Palette.redSoft, Palette.red, false)
        case .change: ("\u{21BB}", Palette.peachDeep, Palette.peach, Palette.peachDeep, false)
        case .start: ("+", Palette.teal, Palette.mintSoft, Palette.tealDeep, false)
        case .keep: ("=", Palette.ink.opacity(0.4), Palette.paper, Palette.ink, false)
        case .ask: ("?", Palette.ink.opacity(0.4), Palette.paper, Palette.ink, true)
        }
    }

    /// ROW_NOTE in MedicineChanges.tsx.
    static let askNote = "Your paper's words don't say clearly whether to stop, change, start or keep these. Ask your pharmacist before you change anything."

    var body: some View {
        let groups = MedicineChanges.groups(items, paper: paper)
        if !groups.isEmpty {
            Card {
                Text("Your medicine changes").font(.title3.weight(.heavy)).accessibilityAddTraits(.isHeader)
                Text("Sorted by your paper's own words. Stop comes first: it is the easiest one to miss.")
                    .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                ForEach(groups) { g in
                    let look = Self.look(g.row)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text(look.mark).font(.subheadline.weight(.heavy))
                                .frame(width: 26, height: 26)
                                .overlay(Circle().strokeBorder(look.text, lineWidth: 2))
                                .accessibilityHidden(true)
                            Text(MedicineChanges.label(g.row)).font(.headline.weight(.heavy))
                            Text("(\(g.list.count) \(g.list.count == 1 ? "medicine" : "medicines"))").font(.caption.weight(.bold))
                        }
                        .foregroundStyle(look.text)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                        if g.row == .ask {
                            Text(Self.askNote).font(.caption.weight(.semibold)).foregroundStyle(look.text).wraps()
                        }
                        ForEach(g.list) { c in line(c) }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(look.fill, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(look.border, style: StrokeStyle(lineWidth: 2, dash: look.dashed ? [5] : [])))
                }
            }
        }
    }

    private func line(_ c: MedicineChanges.Change) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let name = c.name { Text(name).font(.headline.weight(.heavy)).wraps() }
            if let dose = c.dose {
                // The strike-through is never the only signal: the words "was" and "now" say it, on screen and aloud.
                (Text("Dose on your paper: was ") + Text(dose.was).strikethrough() + Text(", now ") + Text(dose.now).bold())
                    .font(.subheadline.weight(.semibold)).wraps()
                    .accessibilityLabel("Dose on your paper: \(MedicineChanges.doseWords(dose))")
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("COPIED WORD FOR WORD FROM YOUR PAPER").font(.caption2.weight(.heavy)).foregroundStyle(Palette.tealDeep)
                Text("\u{201C}\(c.quote)\u{201D}").font(.body.weight(.semibold)).foregroundStyle(Palette.ink).wraps()
            }
            .sunRule()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Copied word for word from your paper: \(c.quote)")
            Button { onGo(c.id) } label: { Text("Go to this step").underline() }
                .font(.caption.weight(.bold)).foregroundStyle(Palette.ink)
                .frame(minHeight: 44)
                .accessibilityLabel("Go to this step: \(String(c.quote.prefix(50)))")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 10))
        .foregroundStyle(Palette.ink)
    }
}

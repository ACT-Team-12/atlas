import SwiftUI

struct PlanView: View {
    @Environment(AppModel.self) private var model
    @State private var speaker = Speaker()
    @State private var reminder: ReminderTarget?
    @State private var web: IdentifiedURL?
    @State private var confirmClear = false

    var body: some View {
        ScrollView {
            if let plan = model.plan {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Your plan", note: plan.located.label)
                    MedicalNote()
                    if model.care?.has_warning_signs == true { WarningBanner() }

                    Text(plan.summary).font(.title3.weight(.semibold)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    ReadAloudBar(speaker: speaker, language: model.language, lines: readLines(plan))
                    Text("\(plan.stats.steps) steps · \(plan.stats.candidates) verified options checked · \(plan.stats.dropped_refs) unverified suggestions removed")
                        .font(.footnote.weight(.bold)).foregroundStyle(Palette.inkSoft)

                    if plan.ask_a_person {
                        Card(background: Palette.peach, border: Palette.peachDeep) {
                            Text("This needs a person too").font(.headline.weight(.heavy)).foregroundStyle(Palette.peachDeep)
                            Text("\(plan.ask_a_person_reason) Call 211 (United Way of Greater Atlanta) or your community health worker.")
                                .font(.subheadline.weight(.semibold)).wraps()
                            CallButton(label: "Call 211", number: "211")
                        }
                    }

                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { i, step in
                        PlanStepCard(index: i + 1, step: step, plan: plan, careByID: model.careByID, open: { web = IdentifiedURL(url: $0) }) {
                            let quote = step.care_ids.compactMap { model.careByID[$0]?.source_quote }.first ?? ""
                            reminder = ReminderTarget(title: step.title, quote: quote, detail: step.action)
                        }
                    }

                    if let care = model.care, !care.questions_for_doctor.isEmpty {
                        Card {
                            Text("Questions for your next visit").font(.title3.weight(.black))
                            ForEach(Array(care.questions_for_doctor.enumerated()), id: \.offset) { _, q in
                                Label(q, systemImage: "questionmark.circle").font(.subheadline)
                            }
                        }
                    }

                    Text("ATLAS explains your own paperwork and points to verified public resources. It is not medical advice. Model: \(plan.model).")
                        .font(.caption).foregroundStyle(Palette.inkSoft)

                    Button("Clear from this phone") { confirmClear = true }
                        .buttonStyle(OutlinePillStyle())
                }
                .padding(16)
            } else {
                Text("No plan yet.").padding()
            }
        }
        .screenBackground()
        .navigationTitle("Step 3 of 3")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { speaker.stop() }
        .sheet(item: $reminder) { ReminderSheet(target: $0) }
        .sheet(item: $web) { SafariView(url: $0.url).ignoresSafeArea() }
        .confirmationDialog("Clear your saved plan and ATLAS reminders from this phone?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear from this phone", role: .destructive) { Task { await model.clearFromPhone() } }
        }
    }

    private func readLines(_ plan: PlanResponse) -> [String] {
        [plan.summary] + plan.steps.enumerated().map { i, s in "\(i + 1). \(s.title). \(s.action)" }
    }
}

struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct PlanStepCard: View {
    let index: Int
    let step: PlanStep
    let plan: PlanResponse
    let careByID: [String: VerifiedItem]
    let open: (URL) -> Void
    let onRemind: () -> Void

    var body: some View {
        Card(background: Palette.paper) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(index)").font(.system(.title, design: .rounded).weight(.black)).foregroundStyle(Palette.teal)
                    .accessibilityHidden(true)
                Text(step.title).font(.title3.weight(.black)).foregroundStyle(Palette.ink).wraps()
                    .accessibilityLabel("Step \(index): \(step.title)")
                    .accessibilityAddTraits(.isHeader)
            }
            if !step.barrier.isEmpty {
                Chip(text: Barrier(rawValue: step.barrier)?.label ?? step.barrier, background: Palette.mintSoft, foreground: Palette.ink)
            }
            Text(step.action).font(.body.weight(.semibold)).wraps()
            if !step.why.isEmpty { Text("Why: \(step.why)").font(.subheadline).foregroundStyle(Palette.inkSoft).wraps() }

            ForEach(step.care_ids, id: \.self) { id in
                if let item = careByID[id] {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(item.title, systemImage: "doc.text").font(.caption.weight(.bold))
                        PaperQuote(quote: item.source_quote)
                    }
                }
            }

            Button { onRemind() } label: { Label("Remind me", systemImage: "bell.badge") }
                .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                .accessibilityLabel("Remind me about \(step.title)")

            ForEach(step.resource_ids, id: \.self) { id in
                if let r = plan.resources[id] { ResourceView(card: r, open: open) }
            }
        }
    }
}

struct ResourceView: View {
    let card: ResourceCard
    let open: (URL) -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch card {
        case let .clinic(_, km, c):
            Card(background: Palette.mintSoft, border: Palette.ink.opacity(0.8), lineWidth: 2) {
                HStack {
                    Chip(text: "Health center")
                    if let km { Text("\(km, specifier: "%.1f") km away").font(.caption.weight(.bold)).foregroundStyle(Palette.inkSoft) }
                }
                Text(c.name).font(.headline.weight(.heavy)).wraps()
                Text("\(c.address), \(c.city) \(c.zip)").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                Text("Fees adjust to your income and family size (federal health center rule).").font(.subheadline.weight(.semibold))
                if let rail = c.nearest_rail {
                    Label("\(rail.name), \(String(format: "%.1f", rail.meters / 1000)) km straight-line", systemImage: "tram.fill").font(.subheadline)
                }
                if let bus = c.nearest_bus { Label("Bus stop: \(bus.name)", systemImage: "bus.fill").font(.subheadline) }
                FlowLayout(spacing: 8) {
                    CallButton(label: "Call \(c.phone)", number: c.phone)
                    Button { openURL(Links.transit(to: c)) } label: { Label("Transit directions", systemImage: "map") }
                        .buttonStyle(OutlinePillStyle())
                        .accessibilityHint("Opens Apple Maps")
                    if let site = c.website, let url = URL(string: site), !site.isEmpty {
                        Button { open(url) } label: { Label("Website", systemImage: "safari") }
                            .buttonStyle(OutlinePillStyle())
                    }
                }
                Text("Source: HRSA health center data · \(c.hours_per_week.map { "\($0.formatted(.number.locale(Locale(identifier: "en_US")))) hrs/week listed" } ?? "hours not listed")")
                    .font(.caption2).foregroundStyle(Palette.inkSoft)
            }
        case let .program(_, p):
            Card(background: Palette.sky.opacity(0.5), border: Palette.ink.opacity(0.8), lineWidth: 2) {
                Chip(text: "Program", background: Palette.sky, foreground: Palette.skyDeep)
                Text(p.name).font(.headline.weight(.heavy)).wraps()
                Text("\u{201C}\(p.evidence_quote)\u{201D}").font(.footnote.italic()).foregroundStyle(Palette.inkSoft)
                    .wraps().sunRule()
                FlowLayout(spacing: 8) {
                    // The server sends "" for a missing phone or link; the web hides those, so do we.
                    if let phone = p.access.phone.nonEmpty { CallButton(label: "Call \(phone)", number: phone) }
                    if let s = p.access.url.nonEmpty, let url = URL(string: s) {
                        Button { open(url) } label: { Label("Open", systemImage: "safari") }
                            .buttonStyle(OutlinePillStyle())
                            .accessibilityLabel("Open \(p.name) website")
                    }
                }
                if let text = p.access.text.nonEmpty { Text(text).font(.subheadline).wraps() }
                if let url = URL(string: p.source_url), let host = url.host() {
                    Button { open(url) } label: { Text("Verified on the official page: \(host)").underline() }
                        .font(.caption2).foregroundStyle(Palette.inkSoft)
                }
            }
        }
    }
}

struct CallButton: View {
    let label: String
    let number: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let url = Links.tel(number) { openURL(url) }
        } label: { Label(label, systemImage: "phone.fill") }
            .buttonStyle(OutlinePillStyle(fill: Palette.ink, text: Palette.paper))
            .accessibilityLabel(label)
    }
}

extension Optional where Wrapped == String {
    /// nil for nil, "" or whitespace, matching how the web treats empty strings as absent.
    var nonEmpty: String? {
        guard let s = self?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }
}

enum Links {
    static func tel(_ number: String) -> URL? {
        let digits = number.filter(\.isNumber)
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }

    /// Apple Maps transit directions to the clinic's street address.
    static func transit(to c: Clinic) -> URL {
        var comps = URLComponents(string: "https://maps.apple.com/")!
        comps.queryItems = [
            URLQueryItem(name: "daddr", value: "\(c.address), \(c.city), GA \(c.zip)"),
            URLQueryItem(name: "dirflg", value: "r"),
        ]
        return comps.url!
    }
}

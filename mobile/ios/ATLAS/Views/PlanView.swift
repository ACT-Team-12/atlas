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
                // Every grounded step the plan could point at, removed or not: a plan step's paper quote never drops out.
                let planItems = (model.care?.items ?? []).filter(\.grounded)
                let outdated = model.planOutdated
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Your plan", note: plan.located.label)
                    MedicalNote()
                    if outdated {
                        OutdatedNote(text: model.provenanceUnknown
                            ? "This plan was saved by an older version of ATLAS, so we can't tell what it was made from. Read your paper again first; until then reading aloud, sharing and reminders are off."
                            : model.careOutdated
                            ? "You changed your paper's text, language or reading level since this plan was made. Read your paper again first; until then reading aloud, sharing and reminders are off."
                            : "You changed your steps, barriers, language, note or place since this plan was made. Update the plan; until then reading aloud, sharing and reminders are off.")
                        if !model.careOutdated {
                            Button("Update the plan") {
                                speaker.stop()
                                model.makePlan()
                            }
                            .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper, shadow: Palette.mint))
                            .disabled(!model.canPlan)
                        }
                    }
                    if model.hasWarnings { WarningBanner() }

                    Text(PaperFirst.planIsASuggestion).font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                    Text(plan.summary).font(.title3.weight(.semibold)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    // The plan is a suggestion and never certified: each step is followed by the paper's own words for it.
                    // Off while outdated, like the website: the plan was built in a language that may no longer be the one picked.
                    if model.planCanReadAloud {
                        ReadAloudBar(speaker: speaker, language: model.language, lines: PaperFirst.planSpeechLines(plan, items: planItems))
                    }
                    if !outdated {
                        ShareLink(item: ShareText.plan(items: model.items, plan: plan, questions: model.care.map(PaperFirst.readingGeneralQuestions) ?? [],
                                                       meaning: model.meaning, planItems: planItems),
                                  subject: Text(ShareText.title), preview: SharePreview(ShareText.title)) {
                            Label("Send to family", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                        .accessibilityHint("Opens the share sheet to text or email the plan. ATLAS does not see or keep it.")
                        Text("Send to family goes from your own phone. ATLAS doesn't see or keep it.")
                            .font(.caption).foregroundStyle(Palette.inkSoft)
                    }
                    Text("\(plan.stats.steps) steps · \(plan.stats.candidates) verified options checked · \(plan.stats.dropped_refs) unverified suggestions removed")
                        .font(.footnote.weight(.bold)).foregroundStyle(Palette.inkSoft)

                    if plan.ask_a_person {
                        Card(background: Palette.peach, border: Palette.peachDeep) {
                            Text("This needs a person too").font(.headline.weight(.heavy)).foregroundStyle(Palette.peachDeep)
                            Text("\(plan.ask_a_person_reason) Call 211 or your community health worker.")
                                .font(.subheadline.weight(.semibold)).wraps()
                            CallButton(label: "Call 211", number: "211")
                        }
                    }

                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { i, step in
                        let quotes = PaperFirst.planStepQuotes(step, items: planItems)
                        PlanStepCard(index: i + 1, step: step, plan: plan, quotes: quotes, remindEnabled: !outdated,
                                     open: { web = IdentifiedURL(url: $0) }) {
                            // A plan step is the AI's suggestion: the reminder says so, and carries the paper's words.
                            reminder = ReminderTarget(title: "Step \(i + 1) of your plan", quote: quotes.first ?? "",
                                                      detail: "Suggestion from ATLAS (follow your paper first): \(step.title). \(step.action)")
                        }
                    }

                    // Paper first (PaperFirst.visitQuestions): a step's own question only when certified.
                    let nextVisit = PaperFirst.visitQuestions(items: model.items.filter(\.grounded), general: model.care.map(PaperFirst.readingGeneralQuestions) ?? [],
                                                              also: model.removedItems, check: { model.check(for: $0) })
                    if !nextVisit.isEmpty {
                        Card {
                            Text("Questions for your next visit").font(.title3.weight(.black))
                            ForEach(Array(nextVisit.enumerated()), id: \.offset) { _, q in
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
        // A plan that turns outdated while it is being read stops being read (its button is hidden too).
        .onChange(of: model.planOutdated) { _, outdated in if outdated { speaker.stop() } }
        .sheet(item: $reminder) { ReminderSheet(target: $0) }
        .sheet(item: $web) { SafariView(url: $0.url).ignoresSafeArea() }
        .confirmationDialog("Clear your saved plan and ATLAS reminders from this phone?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear from this phone", role: .destructive) { Task { await model.clearFromPhone() } }
        }
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
    /// The paper's own words behind this step (PaperFirst.planStepQuotes).
    let quotes: [String]
    let remindEnabled: Bool
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

            ForEach(quotes, id: \.self) { q in
                Text("Your paper says: \u{201C}\(q)\u{201D}").font(.subheadline).foregroundStyle(Palette.ink)
                    .wraps().sunRule()
                    .accessibilityLabel("Your paper says: \(q)")
            }

            if remindEnabled {
                Button { onRemind() } label: { Label("Remind me", systemImage: "bell.badge") }
                    .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                    .accessibilityLabel("Remind me about step \(index)")
            }

            // Who picked these places: ATLAS (caregiver's try, Oct 4; web lib/provenance.ts).
            if step.resource_ids.contains(where: { plan.resources[$0] != nil }) {
                Text("Suggested by ATLAS from checked records. Follow your paper first.").font(.caption.weight(.heavy)).foregroundStyle(Palette.inkSoft)
            }
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
                    if !c.phone.isEmpty { CallButton(label: "Call \(c.phone)", number: c.phone) }
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
            // Clinics outside Atlanta come with "City, ST"; Atlanta records have the city only.
            URLQueryItem(name: "daddr", value: c.city.contains(",") ? "\(c.address), \(c.city) \(c.zip)" : "\(c.address), \(c.city), GA \(c.zip)"),
            URLQueryItem(name: "dirflg", value: "r"),
        ]
        return comps.url!
    }
}

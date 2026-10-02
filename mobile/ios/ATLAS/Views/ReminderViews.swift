import SwiftUI

/// What a "Remind me" button is about.
struct ReminderTarget: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let quote: String
    var detail: String = ""
}

/// Date and time picker that schedules one local notification.
struct ReminderSheet: View {
    let target: ReminderTarget
    @Environment(\.dismiss) private var dismiss
    @State private var date = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    @State private var message: String?
    @State private var saving = false
    @State private var showCalendar = false

    private var draft: ReminderDraft { ReminderDraft(stepTitle: target.title, quote: target.quote, date: date, detail: target.detail) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Remind me", note: target.title)
                    DatePicker("When", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.graphical)
                        .tint(Palette.teal)
                        .accessibilityLabel("Reminder date and time")

                    Card(background: Palette.mintSoft) {
                        Text("Your reminder will say").font(.caption.weight(.heavy)).foregroundStyle(Palette.inkSoft)
                        Text(draft.notificationTitle).font(.subheadline.weight(.heavy))
                        Text(draft.notificationBody).font(.subheadline)
                    }
                    Text("Reminders live on this phone and work without internet.")
                        .font(.footnote.weight(.semibold)).foregroundStyle(Palette.inkSoft)

                    if let message {
                        Text(message).font(.subheadline.weight(.bold)).foregroundStyle(Palette.peachDeep)
                            .accessibilityAddTraits(.updatesFrequently)
                    }

                    Button {
                        saving = true
                        Task {
                            let problem = await Reminders.schedule(draft)
                            saving = false
                            if let problem { message = problem } else { dismiss() }
                        }
                    } label: { Text(saving ? "Saving..." : "Set reminder") }
                        .buttonStyle(PillButtonStyle())
                        .disabled(saving)

                    Button { showCalendar = true } label: { Label("Add to my calendar", systemImage: "calendar.badge.plus") }
                        .buttonStyle(PillButtonStyle(fill: Palette.paper, text: Palette.ink))
                        .accessibilityHint("Opens your calendar with this step filled in. You save it yourself; ATLAS never reads your calendar.")
                    Text("The calendar event carries the line from your paper and reminds you the day before and 2 hours before.")
                        .font(.footnote.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                }
                .padding(16)
            }
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sheet(isPresented: $showCalendar) {
                CalendarEditor(draft: CalendarDraft(title: target.title, start: date, quote: target.quote, detail: target.detail)) { saved in
                    showCalendar = false
                    if saved { message = "Added to your calendar." }
                }
                .ignoresSafeArea()
            }
        }
    }
}

/// Every ATLAS reminder still waiting to go off, with delete.
struct RemindersListView: View {
    @State private var pending: [Reminders.Pending] = []
    @State private var loaded = false

    var body: some View {
        List {
            Section {
                if loaded && pending.isEmpty {
                    Text("No reminders yet. Tap \u{201C}Remind me\u{201D} on any step.")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                }
                ForEach(pending) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        if let date = r.date {
                            Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption.weight(.heavy)).foregroundStyle(Palette.tealDeep)
                        }
                        Text(r.title).font(.subheadline.weight(.heavy))
                        Text(r.body).font(.footnote).foregroundStyle(Palette.inkSoft)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    .swipeActions {
                        Button("Delete", role: .destructive) { delete([r.id]) }
                    }
                }
                .onDelete { idx in delete(idx.map { pending[$0].id }) }
            } footer: {
                Text("Reminders are stored on this phone only. Swipe left to delete one.")
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Your reminders")
        .toolbar { if !pending.isEmpty { EditButton() } }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        pending = await Reminders.pending()
        loaded = true
    }

    private func delete(_ ids: [String]) {
        Reminders.remove(ids: ids)
        pending.removeAll { ids.contains($0.id) }
    }
}

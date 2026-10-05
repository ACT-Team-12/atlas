import Accessibility
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var showAbout = false

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            HomeView(showAbout: $showAbout)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .check: CheckTextView()
                    case .steps: CareStepsView()
                    case .barriers: BarriersView()
                    case .plan: PlanView()
                    case .reminders: RemindersListView()
                    case .labs: LabResultsView()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { model.path.append(.reminders) } label: { Image(systemName: "bell") }
                            .accessibilityLabel("Your reminders")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAbout = true } label: { Image(systemName: "info.circle") }
                            .accessibilityLabel("About ATLAS and privacy")
                    }
                }
        }
        .sheet(isPresented: $showAbout) { AboutSheet() }
        .overlay { if model.busy != nil && !model.lookingAround { BusyOverlay() } }
        // Looking around while a read or plan runs: a small note with a way out, then the ready cue when it lands.
        .overlay(alignment: .bottom) {
            if let what = model.readyCue {
                ReadyCueButton(what: what) { model.showReady() }
            } else if model.busy != nil && model.lookingAround {
                StillWorkingPill()
            }
        }
        // The cue's result was opened another way: it is no longer needed (onSeen on the website).
        .onChange(of: model.path.last) { _, top in
            if let mark = model.readyMark, top == ReadyCue.route(mark.what) { model.clearReady() }
        }
        .alert("Something went wrong", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: {
            Text(model.error ?? "")
        }
    }
}

/// Progress for the 10 to 25 second calls, with a way out.
struct BusyOverlay: View {
    @Environment(AppModel.self) private var model

    private var message: (String, String) {
        switch model.busy {
        case .recognizing: ("Reading your photo on this phone...", "The photo stays on your phone.")
        case .reading: ("Reading your paper...", "Finding each step and checking it against your paper. This takes 10 to 25 seconds.")
        case .planning: ("Building your plan...", "Matching your steps with verified clinics and programs near you. This takes 10 to 25 seconds.")
        case nil: ("", "")
        }
    }

    var body: some View {
        ZStack {
            Palette.ink.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().controlSize(.large).tint(Palette.teal)
                Text(message.0).font(.title3.weight(.heavy)).foregroundStyle(Palette.ink)
                Text(message.1).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center)
                Button("Cancel") { model.cancel() }
                    .buttonStyle(OutlinePillStyle())
                    .accessibilityHint("Stops this and keeps what you entered")
                // Reading and planning run on the server: the person may keep using the app, and the ready cue brings
                // them back. Reading a photo happens on this phone and is quick, so it keeps the card.
                if model.busy == .reading || model.busy == .planning {
                    Button("Look around while you wait") { model.lookingAround = true }
                        .font(.subheadline.weight(.bold)).underline().foregroundStyle(Palette.ink)
                        .frame(minHeight: 44)
                        .accessibilityHint("We will show a button when it is ready")
                }
            }
            .padding(24)
            .background(Palette.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Palette.ink, lineWidth: 2.5))
            .padding(28)
            .accessibilityElement(children: .contain)
        }
        .accessibilityAddTraits(.isModal)
    }
}

/// While the person looks around: what is still running, with Cancel.
struct StillWorkingPill: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            ProgressView().tint(Palette.teal)
            Text(model.busy == .planning ? "Building your plan..." : "Reading your paper...")
                .font(.subheadline.weight(.bold)).foregroundStyle(Palette.ink)
            Button("Cancel") { model.cancel() }
                .font(.subheadline.weight(.bold)).underline().foregroundStyle(Palette.ink)
                .accessibilityHint("Stops this and keeps what you entered")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Palette.paper, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2))
        .padding(.bottom, 12)
        .accessibilityElement(children: .contain)
    }
}

/// "Your plan is ready: show me" (web/src/ui/ReadyCue.tsx): floats at the bottom of every screen until it is used or
/// the result is opened. Its arrival is said once, politely.
struct ReadyCueButton: View {
    let what: ReadyCue.What
    let onGo: () -> Void

    var body: some View {
        Button(action: onGo) {
            (Text("\u{2713} ") + Text(ReadyCue.label(what)) + Text(": ") + Text("show me").underline())
                .font(.headline.weight(.heavy))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 20).padding(.vertical, 14)
                .frame(minHeight: 52)
                .background(Palette.sun, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2.5))
                .background(Capsule().fill(Palette.ink).offset(y: 4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(ReadyCue.label(what)): show me")
        .padding(.bottom, 16)
        .task(id: what) {
            var said = AttributedString(ReadyCue.label(what))
            said.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(said).post()
        }
    }
}

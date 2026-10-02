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
        .overlay { if model.busy != nil { BusyOverlay() } }
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
        case .planning: ("Building your plan...", "Matching your steps with verified Atlanta clinics and programs. This takes 10 to 25 seconds.")
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

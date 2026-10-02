import SwiftUI

struct AboutSheet: View {
    static let privacyURL = URL(string: "https://atlas-team12.vercel.app/privacy")!
    static let websiteURL = URL(string: "https://atlas-team12.vercel.app")!

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var web: IdentifiedURL?
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        AppMark(size: 44)
                        VStack(alignment: .leading) {
                            Text("ATLAS").font(.headline.weight(.black))
                            Text("ATL Innovation Cup 2026, Team 12").font(.caption).foregroundStyle(Palette.inkSoft)
                        }
                    }
                    Text("ATLAS reads your after-visit paper, turns it into steps that quote your paper word for word, and builds a plan with verified Atlanta clinics and programs.")
                        .font(.subheadline)
                    MedicalNote()
                }
                Section("Your privacy") {
                    Button { web = IdentifiedURL(url: Self.privacyURL) } label: {
                        Label("Privacy", systemImage: "hand.raised.fill")
                    }
                    Label("Photos are read on this phone and never sent.", systemImage: "lock.iphone").font(.subheadline)
                    Label("Only the text you check is sent to make your steps.", systemImage: "text.badge.checkmark").font(.subheadline)
                    Label("Your plan and reminders are saved on this phone only.", systemImage: "iphone").font(.subheadline)
                    Label("No tracking and no ads.", systemImage: "eye.slash").font(.subheadline)
                    Button(role: .destructive) { confirmClear = true } label: {
                        Label("Clear from this phone", systemImage: "trash")
                    }
                }
                Section {
                    Button { web = IdentifiedURL(url: Self.websiteURL) } label: { Label("ATLAS on the web", systemImage: "safari") }
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
                }
            }
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $web) { SafariView(url: $0.url).ignoresSafeArea() }
            .confirmationDialog("Clear your saved plan and ATLAS reminders from this phone?", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("Clear from this phone", role: .destructive) {
                    Task { await model.clearFromPhone(); dismiss() }
                }
            }
        }
    }
}

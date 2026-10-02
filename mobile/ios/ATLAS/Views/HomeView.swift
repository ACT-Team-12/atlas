import PhotosUI
import SwiftUI
import VisionKit

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Binding var showAbout: Bool
    @State private var showScanner = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var showPrivacy = false
    @State private var confirmClear = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    AppMark(size: 52)
                    Text("ATLAS").font(.system(.title, design: .rounded).weight(.black)).foregroundStyle(Palette.ink)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("ATLAS")

                ScreenTitle(title: "Your visit paper", note: "Turn it into steps you can finish, with help near you.")
                MedicalNote()

                if let restoredAt = model.restoredAt {
                    Card(border: Palette.teal) {
                        Text("Welcome back. Your last plan is saved on this phone (\(restoredAt.formatted(date: .abbreviated, time: .shortened))).")
                            .font(.subheadline.weight(.bold))
                        HStack {
                            Button("Open it") { model.openSaved() }.buttonStyle(OutlinePillStyle(fill: Palette.mint))
                            Button("Clear from this phone") { confirmClear = true }.buttonStyle(OutlinePillStyle())
                        }
                    }
                }

                Card {
                    Text("How do you want to share it?").font(.headline.weight(.heavy))
                    Button { startScan() } label: {
                        Label("Scan my paper", systemImage: "doc.viewfinder")
                    }
                    .buttonStyle(PillButtonStyle())
                    .accessibilityHint("Uses the camera. The photo stays on your phone, only the words you check are sent.")

                    Button { showPhotoPicker = true } label: {
                        Label("Choose a photo", systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(PillButtonStyle(fill: Palette.paper, text: Palette.ink))

                    Button { model.startTyping() } label: {
                        Label("Type or paste the text", systemImage: "text.cursor")
                    }
                    .buttonStyle(PillButtonStyle(fill: Palette.paper, text: Palette.ink))

                    Button { model.useSample() } label: {
                        Label("Use the sample paper", systemImage: "doc.text")
                    }
                    .buttonStyle(PillButtonStyle(fill: Palette.sun, text: Palette.ink))
                    Text("\(Sample.label).").font(.caption).foregroundStyle(Palette.inkSoft)
                }

                Card(background: Palette.peach, border: Palette.ink) {
                    Text("Lab results full of jargon?").font(.headline.weight(.heavy))
                    Text("See only what your report marks outside its range, in plain words, with questions for your clinic.")
                        .font(.subheadline.weight(.semibold)).wraps()
                    Button { model.path = [.labs] } label: { Label("Explain my lab results", systemImage: "list.bullet.clipboard") }
                        .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper))
                }

                Card(background: Palette.mint, border: Palette.ink) {
                    Label("Your photo never leaves this phone.", systemImage: "lock.iphone").font(.subheadline.weight(.heavy))
                    Text("ATLAS reads the words on your phone. You check them, and only the text you confirm is sent to make your steps.")
                        .font(.subheadline.weight(.semibold))
                }

                HStack(spacing: 16) {
                    Button("Privacy") { showPrivacy = true }
                    Button("About ATLAS") { showAbout = true }
                }
                .font(.footnote.weight(.bold))
                .foregroundStyle(Palette.tealDeep)
                .padding(.top, 4)
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { pages in
                showScanner = false
                model.recognize(pages: pages, source: .scan)
            } onCancel: {
                showScanner = false
            }
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images, photoLibrary: .shared())
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self), let image = ImageLoader.cgImage(from: data) else {
                    model.error = "We could not open that photo. Try another one."
                    return
                }
                model.recognize(pages: [image], source: .photo)
            }
        }
        .sheet(isPresented: $showPrivacy) { SafariView(url: AboutSheet.privacyURL).ignoresSafeArea() }
        .confirmationDialog("Clear your saved plan and ATLAS reminders from this phone?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear from this phone", role: .destructive) { Task { await model.clearFromPhone() } }
        }
    }

    /// The document camera cannot see anything in the Simulator (iOS 26 reports it as supported but shows a
    /// black view), so the Simulator build and any device without it fall back to the photo picker.
    private func startScan() {
        if Self.documentCameraWorks {
            showScanner = true
        } else {
            showPhotoPicker = true
        }
    }

    private static var documentCameraWorks: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        VNDocumentCameraViewController.isSupported
        #endif
    }
}

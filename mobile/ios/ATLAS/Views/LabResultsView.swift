import PhotosUI
import SwiftUI
import VisionKit

/// Same labeled sample as web/src/lib/sampleLabs.ts. Describes no real patient.
enum LabSample {
    static let label = "Sample lab report (written by Team ATLAS, not a real patient)"
    static let text = """
    SAMPLE LAB REPORT (written by Team ATLAS, not a real patient)
    Collected: 10/01/2026   Ordering provider: Sample Provider, MD

    COMPREHENSIVE METABOLIC PANEL
    Test                     Result    Units      Reference Range   Flag
    Glucose, fasting         126       mg/dL      70-99             H
    Sodium                   139       mmol/L     136-145
    Potassium                3.2       mmol/L     3.5-5.1           L
    Creatinine               1.1       mg/dL      0.6-1.2
    eGFR                     68        mL/min     >=60

    HEMOGLOBIN A1C
    Hemoglobin A1c           7.4       %          <5.7              H

    LIPID PANEL
    Total Cholesterol        214       mg/dL      <200              H
    LDL Cholesterol          142       mg/dL      <100              H
    HDL Cholesterol          44        mg/dL      >40
    Triglycerides            148       mg/dL      <150

    """
}

/// "Explain my lab results": paste, scan or pick a screenshot. The photo is read on this phone; the person checks the
/// words, and only that text is sent. The server's code (not the AI) decides what is outside the printed range.
struct LabResultsView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var busy = false
    @State private var reading = false
    @State private var result: ResultsResponse?
    @State private var problem: String?
    @State private var showAll = false
    @State private var showScanner = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var fromPhoto = false
    @State private var task: Task<Void, Never>?

    private var flagged: [ResultRow] { result?.rows.filter { $0.status == "outside" } ?? [] }
    private var others: [ResultRow] { result?.rows.filter { $0.status != "outside" } ?? [] }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Explain my lab results", note: "a patient asked us for this")
                Text("See only the lines your report itself marks High or Low, or where the number is outside the range printed on that line. The AI explains each test in plain words. Our code decides what is outside the range. No advice, only questions for your clinic.")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()

                Card {
                    FlowLayout(spacing: 8) {
                        Button { startScan() } label: { Label("Scan report", systemImage: "doc.viewfinder") }
                            .buttonStyle(OutlinePillStyle(fill: Palette.mint))
                        Button { showPhotoPicker = true } label: { Label("Screenshot or photo", systemImage: "photo.on.rectangle") }
                            .buttonStyle(OutlinePillStyle())
                        Button { text = LabSample.text; fromPhoto = false; result = nil } label: { Label("Use the sample", systemImage: "doc.text") }
                            .buttonStyle(OutlinePillStyle(fill: Palette.sun))
                    }
                    if fromPhoto {
                        Text("This is how we read your photo on this phone. Check the numbers against your report before you continue.")
                            .font(.subheadline.weight(.bold)).foregroundStyle(Palette.peachDeep).wraps()
                    }
                    TextEditor(text: $text)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 180)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.ink.opacity(0.6), lineWidth: 2))
                        .accessibilityLabel("Lab report text")
                    Text("\(LabSample.label). Nothing you paste here is stored.").font(.caption).foregroundStyle(Palette.inkSoft)
                    Picker("Explain it in", selection: $model.language) {
                        ForEach(Language.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Button { explain() } label: { Text(busy ? "Reading..." : "Show what's flagged") }
                        .buttonStyle(PillButtonStyle())
                        .disabled(busy || reading || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 20)
                    if busy || reading {
                        ProgressView(reading ? "Reading your photo on this phone..." : "Checking each line against your report...")
                    }
                }

                if let problem {
                    Text(problem).font(.subheadline.weight(.bold)).foregroundStyle(Palette.peachDeep).wraps()
                        .accessibilityAddTraits(.updatesFrequently)
                }

                if let result {
                    Text(result.counts.outside == 0
                         ? "Nothing on this report is marked or printed as outside its range."
                         : "\(result.counts.outside) \(result.counts.outside == 1 ? "result is" : "results are") outside the range on your report.")
                        .font(.title3.weight(.black)).foregroundStyle(Palette.ink).wraps()
                        .accessibilityAddTraits(.isHeader)
                    Text("\(result.counts.inside) inside the range\(result.counts.unknown > 0 ? ", \(result.counts.unknown) with no range we could read" : "").\(result.dropped.isEmpty ? "" : " \(result.dropped.count) left out because the AI's copy didn't match your report.")")
                        .font(.caption.weight(.semibold)).foregroundStyle(Palette.inkSoft).wraps()
                    ForEach(Array(flagged.enumerated()), id: \.offset) { _, r in ResultRowCard(row: r) }
                    if !others.isEmpty {
                        Button(showAll ? "Hide the others" : "Show the other \(others.count)") { showAll.toggle() }
                            .buttonStyle(OutlinePillStyle())
                        if showAll { ForEach(Array(others.enumerated()), id: \.offset) { _, r in ResultRowCard(row: r) } }
                    }
                    Text("Ranges differ between labs and people. Only your clinic can say what a result means for you.")
                        .font(.caption).foregroundStyle(Palette.inkSoft).wraps()
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Lab results")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { task?.cancel() }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { pages in showScanner = false; recognize(pages) } onCancel: { showScanner = false }
                .ignoresSafeArea()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images, photoLibrary: .shared())
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self), let image = ImageLoader.cgImage(from: data) else {
                    problem = "We could not open that picture. Try another one."
                    return
                }
                recognize([image])
            }
        }
    }

    private func startScan() {
        #if targetEnvironment(simulator)
        showPhotoPicker = true
        #else
        if VNDocumentCameraViewController.isSupported { showScanner = true } else { showPhotoPicker = true }
        #endif
    }

    /// On-device OCR. The picture never leaves the phone.
    private func recognize(_ pages: [CGImage]) {
        problem = nil; result = nil; reading = true
        Task {
            defer { reading = false }
            do {
                let words = try await TextRecognizer.recognize(pages: pages)
                if words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    problem = "We could not find any words in that picture. Try again in good light, or paste the text."
                } else {
                    text = words; fromPhoto = true
                }
            } catch {
                problem = "We could not read that picture. Try again, or paste the text."
            }
        }
    }

    private func explain() {
        problem = nil; result = nil; showAll = false; busy = true
        let text = self.text, language = model.language
        task = Task {
            do {
                let r = try await APIClient().results(text: text, language: language)
                result = r
            } catch {
                if (error as? APIError) != .cancelled { problem = error.localizedDescription }
            }
            busy = false
        }
    }
}

struct ResultRowCard: View {
    let row: ResultRow

    private var badge: String {
        switch row.status {
        case "outside": row.direction == "high" ? "Above range" : row.direction == "low" ? "Below range" : "Flagged"
        case "inside": "In range"
        default: "No range"
        }
    }

    var body: some View {
        Card(background: row.status == "outside" ? Palette.peach : Palette.paper,
             border: row.status == "outside" ? Palette.peachDeep : Palette.ink.opacity(0.3), lineWidth: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(row.test): \(row.value) \(row.unit)").font(.headline.weight(.heavy)).wraps()
                Spacer(minLength: 8)
                Chip(text: badge, background: Palette.ink, foreground: Palette.paper)
            }
            Text(row.plain_name).font(.subheadline).wraps()
            Text(row.reason).font(.subheadline.weight(.semibold)).wraps()
            Text(row.quote).font(.system(.caption, design: .monospaced)).wraps().sunRule()
            (Text("Ask your clinic: ").bold() + Text(row.ask)).font(.subheadline).wraps()
        }
        .accessibilityElement(children: .combine)
    }
}

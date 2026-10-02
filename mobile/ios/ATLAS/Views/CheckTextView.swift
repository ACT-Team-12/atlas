import SwiftUI

/// "Check the text": the only text ever sent to ATLAS is what the person confirms here.
struct CheckTextView: View {
    @Environment(AppModel.self) private var model
    @FocusState private var editing: Bool

    private var sourceNote: String {
        switch model.textSource {
        case .scan, .photo: "We read this on your phone. The photo was not sent anywhere."
        case .sample: Sample.label
        case .typed: "Paste or type the words from your after-visit summary."
        }
    }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Check the text", note: sourceNote)
                Text("Every step has to quote this text word for word. If a word or number is wrong, fix it here. Only this text is sent to ATLAS.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.inkSoft)

                TextEditor(text: $model.text)
                    .focused($editing)
                    .font(.callout)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .frame(height: 320)
                    .background(Palette.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.ink.opacity(0.7), lineWidth: 2))
                    .accessibilityLabel("After-visit summary text")
                    .overlay(alignment: .topLeading) {
                        if model.text.isEmpty {
                            Text("Paste the after-visit summary here...")
                                .font(.callout).foregroundStyle(Palette.inkSoft.opacity(0.6))
                                .padding(16).allowsHitTesting(false)
                        }
                    }

                Card {
                    HStack {
                        Text("Explain it in").font(.subheadline.weight(.bold))
                        Spacer()
                        Picker("Explain it in", selection: $model.language) {
                            ForEach(Language.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.menu)
                    }
                    Text("Reading level").font(.subheadline.weight(.bold))
                    Picker("Reading level", selection: $model.level) {
                        ForEach(ReadingLevel.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel("Reading level")
                }

                Button {
                    editing = false
                    model.readPaper()
                } label: {
                    Text("Read my paper")
                }
                .buttonStyle(PillButtonStyle())
                .disabled(!model.canRead)
                .accessibilityHint("Sends only this text to ATLAS. Takes 10 to 25 seconds.")

                if model.text.trimmingCharacters(in: .whitespacesAndNewlines).count <= 20 {
                    Text("Add a few lines from your paper first.").font(.footnote.weight(.semibold)).foregroundStyle(Palette.inkSoft)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Step 1 of 3")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { editing = false }
            }
        }
    }
}

import SwiftUI

struct BarriersView: View {
    @Environment(AppModel.self) private var model
    @State private var locator = LocationProvider()
    @State private var locating = false
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "What gets in the way?", note: "Pick any that fit.")

                FlowLayout(spacing: 10) {
                    ForEach(Barrier.allCases) { b in
                        let on = model.barriers.contains(b)
                        Button { model.toggle(b) } label: {
                            Text((on ? "✓ " : "") + b.label)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(on ? Palette.paper : Palette.ink)
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(on ? Palette.teal : Palette.paper, in: Capsule())
                                .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2))
                                .background(Capsule().fill(Palette.ink).offset(y: on ? 3 : 0))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(b.label)
                        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                    }
                }

                Card {
                    Text("Your ZIP (metro Atlanta)").font(.subheadline.weight(.bold))
                    TextField("e.g. 30340", text: Binding(
                        get: { model.zip },
                        set: { v in model.zip = String(v.filter(\.isNumber).prefix(5)); model.location = nil }
                    ))
                    .keyboardType(.numberPad)
                    .focused($focused)
                    .padding(12)
                    .background(Palette.paper, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.ink.opacity(0.7), lineWidth: 2))
                    .accessibilityLabel("Your ZIP code")

                    Button { useMyLocation() } label: {
                        if locating {
                            Label("Finding you...", systemImage: "location")
                        } else if model.location != nil {
                            Label("Using your location (not saved)", systemImage: "checkmark.circle.fill")
                        } else {
                            Label("Or use my location", systemImage: "location")
                        }
                    }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Palette.tealDeep)
                    .disabled(locating)
                }

                Card {
                    Text("Anything else we should know? (optional)").font(.subheadline.weight(.bold))
                    TextField("e.g. no car, I work mornings", text: $model.note, axis: .vertical)
                        .lineLimit(3...6)
                        .focused($focused)
                        .padding(12)
                        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.ink.opacity(0.7), lineWidth: 2))
                }

                Button("Make my plan") {
                    focused = false
                    model.makePlan()
                }
                .buttonStyle(PillButtonStyle(fill: Palette.ink, text: Palette.paper, shadow: Palette.mint))
                .disabled(!model.canPlan)
                .accessibilityHint("Takes 10 to 25 seconds.")
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Step 2 of 3")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = false }
            }
        }
    }

    private func useMyLocation() {
        locating = true
        Task {
            defer { locating = false }
            do {
                let c = try await locator.currentLocation()
                let point = LatLng(lat: c.latitude, lng: c.longitude)
                guard point.isInServiceArea else {
                    model.error = "Your location is outside metro Atlanta, where ATLAS has verified clinics. Type a metro Atlanta ZIP instead."
                    return
                }
                model.location = point
                model.zip = ""
            } catch {
                model.error = error.localizedDescription
            }
        }
    }
}

/// Wraps chips onto as many lines as needed.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + s.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += s.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, s.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(s.width, bounds.width), height: s.height))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}

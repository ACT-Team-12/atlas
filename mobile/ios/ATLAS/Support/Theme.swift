import SwiftUI

/// Palette from web/src/app/globals.css. Red is used for warning signs only.
enum Palette {
    static let paper = Color(hex: 0xFBF8F3)
    static let ink = Color(hex: 0x102A43)
    static let inkSoft = Color(hex: 0x334E68)
    static let teal = Color(hex: 0x0B7A75)
    static let tealDeep = Color(hex: 0x075E5A)
    static let mint = Color(hex: 0xBFE9DC)
    static let mintSoft = Color(hex: 0xE6F6F0)
    static let sky = Color(hex: 0xD6E9F8)
    static let skyDeep = Color(hex: 0x1D5FA8)
    static let peach = Color(hex: 0xFFE0C2)
    static let peachDeep = Color(hex: 0xB85A0E)
    static let sun = Color(hex: 0xFFC94D)
    static let red = Color(hex: 0xD64545)
    static let redSoft = Color(hex: 0xFBE3E3)
    static let lilac = Color(hex: 0xE6DEFA)
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

/// Kind chips, same labels and colors as the KIND map in web/src/ui/CarePlanTool.tsx.
struct KindStyle {
    let label: String
    let background: Color
    let foreground: Color

    static func of(_ kind: String) -> KindStyle {
        switch ItemKind(rawValue: kind) {
        case .medication: KindStyle(label: "Medicine", background: Palette.sky, foreground: Palette.skyDeep)
        case .lab_test: KindStyle(label: "Lab test", background: Palette.lilac, foreground: Palette.ink)
        case .referral: KindStyle(label: "Referral", background: Palette.peach, foreground: Palette.peachDeep)
        case .follow_up_visit: KindStyle(label: "Next visit", background: Palette.mint, foreground: Palette.tealDeep)
        case .self_care: KindStyle(label: "Daily care", background: Palette.mintSoft, foreground: Palette.tealDeep)
        case .warning_sign: KindStyle(label: "Warning sign", background: Palette.redSoft, foreground: Palette.red)
        case nil: KindStyle(label: "Step", background: Palette.mintSoft, foreground: Palette.ink)
        }
    }
}

// MARK: - Building blocks

struct Card<Content: View>: View {
    var background: Color = Palette.paper
    var border: Color = Palette.ink
    var lineWidth: CGFloat = 2.5
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(border, lineWidth: lineWidth))
    }
}

struct Chip: View {
    let text: String
    var background: Color = Palette.mint
    var foreground: Color = Palette.tealDeep

    var body: some View {
        Text(text)
            .font(.caption.weight(.heavy))
            .foregroundStyle(foreground)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(background, in: Capsule())
    }
}

/// Chunky pill button with an ink border and a hard shadow, like the web SquashButton.
struct PillButtonStyle: ButtonStyle {
    var fill: Color = Palette.teal
    var text: Color = Palette.paper
    var shadow: Color = Palette.ink
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.heavy))
            .foregroundStyle(text)
            .padding(.horizontal, 22).padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(fill, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2.5))
            .background(Capsule().fill(shadow).offset(y: configuration.isPressed ? 1 : 4))
            .offset(y: configuration.isPressed ? 3 : 0)
            .opacity(isEnabled ? 1 : 0.45)
            .animation(.spring(response: 0.25, dampingFraction: 0.5), value: configuration.isPressed)
    }
}

/// Smaller outlined pill for secondary actions.
struct OutlinePillStyle: ButtonStyle {
    var fill: Color = Palette.paper
    var text: Color = Palette.ink

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(text)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(configuration.isPressed ? Palette.mint : fill, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2))
    }
}

/// "From your paper" quote block with the sun-yellow rule from the web.
struct PaperQuote: View {
    let quote: String

    var body: some View {
        Text("From your paper: \u{201C}\(quote)\u{201D}")
            .font(.footnote.italic())
            .foregroundStyle(Palette.ink.opacity(0.75))
            .fixedSize(horizontal: false, vertical: true)
            .sunRule()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("From your paper, quote: \(quote)")
    }
}

/// Required on the first screen and the plan screen (App Review Guideline 1.4.1).
struct MedicalNote: View {
    var body: some View {
        Text("ATLAS explains your paper. It is not medical advice. Check with your doctor or clinic before changing anything.")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Palette.inkSoft)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct WarningBanner: View {
    var body: some View {
        Card(background: Palette.redSoft, border: Palette.red) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your paper lists warning signs (marked red).").font(.headline.weight(.heavy))
                    Text("If you have any of them right now, do what your paper says: call your clinic, or call 911.")
                        .font(.subheadline.weight(.semibold))
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Palette.red)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ScreenTitle: View {
    let title: String
    var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(.largeTitle, design: .rounded).weight(.black))
                .foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            if let note {
                Text(note).font(.callout.weight(.semibold)).foregroundStyle(Palette.tealDeep)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// Sun-yellow rule on the left, sized to the content (used for quotes).
    func sunRule() -> some View {
        padding(.leading, 12)
            .overlay(alignment: .leading) { Rectangle().fill(Palette.sun).frame(width: 4) }
    }

    /// Lets body text wrap to as many lines as it needs instead of truncating.
    func wraps() -> some View {
        fixedSize(horizontal: false, vertical: true)
    }

    func screenBackground() -> some View {
        background(Palette.mintSoft.ignoresSafeArea())
    }
}

import SwiftUI

/// Pip drawn natively from Akhil's rig (video/assets/pip-rig.svg, the same geometry as web/src/ui/Pip.tsx): the path data
/// below is the rig's, word for word, in its own viewBox (-12 -12 88 92). Faces: normal and happy (a quiet Pip is the
/// normal face, still). Accessory: the flag, for the cheer. The app is light only, so these are the rig's light colors.
/// Decorative to VoiceOver: what Pip says is announced by the steps screen, once, politely.
enum PipRig {
    static let viewBox = CGRect(x: -12, y: -12, width: 88, height: 92)

    // Colors from the rig (video/DECISIONS.md "Pip art: RECEIVED").
    static let ink = Color(hex: 0x14283A)
    static let pin = Color(hex: 0xFFA47E)
    static let pin2 = Color(hex: 0xF0606A)
    static let deep = Color(hex: 0xD2543F)
    static let leaf = Color(hex: 0x3F9A52)
    static let go = Color(hex: 0x24895D)
    static let face = Color(hex: 0xFFFDF7)
    static let cheek = Color(hex: 0xF58C7A)

    static let body = "M32 78 C26 66 6 50 6 30 A26 26 0 0 1 58 30 C58 50 38 66 32 78 Z"
    static let crease = "M32 5 C25 12 24 20 26 24"
    static let stem = "M32 5 L33 -2"
    static let leafShape = "M33 -1 C38 -9 48 -9 52 -5 C46 1 38 2 33 -1 Z"
    static let shine = "M14 22 A20 20 0 0 1 26 10"
    static let flagPole = "M56 36 L56 4"
    static let flag = "M56 5 L74 11 L56 17 Z"
    static let eyesHappy = "M23 28 q3 -4 6 0 M35 28 q3 -4 6 0"
    static let mouth = "M27 34 q5 4.5 10 0"
}

/// A small SVG path reader for the commands the rig uses (M L H V C Q A Z, absolute and relative). Arcs are circular,
/// as in the rig, and converted to a center and angles the SVG way (endpoint to center, SVG 1.1 F.6.5).
enum SVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var tokens = tokenize(d)[...]
        var cmd: Character = "M"
        var cur = CGPoint.zero, start = CGPoint.zero
        func num() -> CGFloat {
            guard case .number(let n)? = tokens.popFirst() else { return 0 }
            return CGFloat(n)
        }
        func point(_ rel: Bool) -> CGPoint {
            let x = num(), y = num()
            return rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y)
        }
        while let t = tokens.first {
            if case .command(let c) = t { cmd = c; tokens.removeFirst() }
            let rel = cmd.isLowercase
            switch cmd.uppercased().first! {
            case "M":
                cur = point(rel); start = cur; path.move(to: cur)
                cmd = rel ? "l" : "L" // later pairs are lines
            case "L":
                cur = point(rel); path.addLine(to: cur)
            case "H":
                let x = num(); cur.x = rel ? cur.x + x : x; path.addLine(to: cur)
            case "V":
                let y = num(); cur.y = rel ? cur.y + y : y; path.addLine(to: cur)
            case "C":
                let c1 = point(rel), c2 = point(rel), p = point(rel)
                path.addCurve(to: p, control1: c1, control2: c2); cur = p
            case "Q":
                let c1 = point(rel), p = point(rel)
                path.addQuadCurve(to: p, control: c1); cur = p
            case "A":
                let rx = num(); _ = num(); _ = num() // ry and x-axis rotation: the rig's arcs are circles
                let large = num() != 0, sweep = num() != 0
                let p = point(rel)
                addArc(&path, from: cur, to: p, radius: rx, large: large, sweep: sweep); cur = p
            case "Z":
                path.closeSubpath(); cur = start
            default:
                _ = tokens.popFirst() // unknown: skip rather than loop
            }
        }
        return path
    }

    /// Endpoint to center for a circular arc.
    static func addArc(_ path: inout Path, from p1: CGPoint, to p2: CGPoint, radius rx: CGFloat, large: Bool, sweep: Bool) {
        let x1p = (p1.x - p2.x) / 2, y1p = (p1.y - p2.y) / 2
        var r = abs(rx)
        let lambda = (x1p * x1p + y1p * y1p) / (r * r)
        if lambda > 1 { r *= lambda.squareRoot() }
        let num = max(0, r * r * r * r - r * r * y1p * y1p - r * r * x1p * x1p)
        let den = r * r * y1p * y1p + r * r * x1p * x1p
        let coef = (large != sweep ? 1 : -1) * (den == 0 ? 0 : (num / den).squareRoot())
        let cxp = coef * y1p, cyp = -coef * x1p
        let center = CGPoint(x: cxp + (p1.x + p2.x) / 2, y: cyp + (p1.y + p2.y) / 2)
        let a1 = atan2((y1p - cyp) / r, (x1p - cxp) / r)
        var delta = atan2((-y1p - cyp) / r, (-x1p - cxp) / r) - a1
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        path.addRelativeArc(center: center, radius: r, startAngle: .radians(a1), delta: .radians(delta))
    }

    enum Token: Equatable { case command(Character), number(Double) }

    static func tokenize(_ d: String) -> [Token] {
        var out: [Token] = []
        var buf = ""
        func flush() { if let n = Double(buf) { out.append(.number(n)) }; buf = "" }
        for ch in d {
            if ch.isLetter && ch != "e" && ch != "E" {
                flush(); out.append(.command(ch))
            } else if ch == "-" {
                // A minus starts a new number unless it follows an exponent.
                if !(buf.last == "e" || buf.last == "E") { flush() }
                buf.append(ch)
            } else if ch == "," || ch.isWhitespace {
                flush()
            } else if ch == "." && buf.contains(".") {
                flush(); buf.append(ch)
            } else {
                buf.append(ch)
            }
        }
        flush()
        return out
    }
}

/// The drawing itself, scaled to fit (preserveAspectRatio meet, centered).
struct PipArt: View {
    var happy = false
    var flag = false
    /// Vertical scale of the eyes for the blink (1 open, 0.1 shut), around the eyes' center (32, 28).
    var eyes: CGFloat = 1

    var body: some View {
        Canvas { ctx, size in
            let vb = PipRig.viewBox
            let s = min(size.width / vb.width, size.height / vb.height)
            ctx.translateBy(x: (size.width - vb.width * s) / 2, y: (size.height - vb.height * s) / 2)
            ctx.scaleBy(x: s, y: s)
            ctx.translateBy(x: -vb.minX, y: -vb.minY)
            let rounded = { (w: CGFloat) in StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round) }
            let ink = PipRig.ink

            if flag {
                ctx.stroke(SVGPath.parse(PipRig.flagPole), with: .color(ink), style: rounded(2.5))
                let f = SVGPath.parse(PipRig.flag)
                ctx.fill(f, with: .color(PipRig.go))
                ctx.stroke(f, with: .color(ink), lineWidth: 1.5)
            }
            let body = SVGPath.parse(PipRig.body)
            let box = body.boundingRect
            ctx.fill(body, with: .linearGradient(Gradient(colors: [PipRig.pin, PipRig.pin2]),
                                                 startPoint: CGPoint(x: box.minX, y: box.minY), endPoint: CGPoint(x: box.maxX, y: box.maxY)))
            ctx.stroke(body, with: .color(ink), style: StrokeStyle(lineWidth: 2.5, lineJoin: .round))
            ctx.stroke(SVGPath.parse(PipRig.crease), with: .color(PipRig.deep.opacity(0.55)), style: rounded(2))
            ctx.stroke(SVGPath.parse(PipRig.stem), with: .color(ink), style: rounded(2.5))
            let leaf = SVGPath.parse(PipRig.leafShape)
            ctx.fill(leaf, with: .color(PipRig.leaf))
            ctx.stroke(leaf, with: .color(ink), style: StrokeStyle(lineWidth: 1.8, lineJoin: .round))
            ctx.stroke(SVGPath.parse(PipRig.shine), with: .color(.white.opacity(0.55)), style: rounded(3))
            let face = Path(ellipseIn: CGRect(x: 16, y: 14, width: 32, height: 32))
            ctx.fill(face, with: .color(PipRig.face))
            ctx.stroke(face, with: .color(ink), lineWidth: 2)

            // Eyes (the blink scales them around their center, as the website's keyframes do).
            var eyeCtx = ctx
            eyeCtx.translateBy(x: 32, y: 28)
            eyeCtx.scaleBy(x: 1, y: eyes)
            eyeCtx.translateBy(x: -32, y: -28)
            if happy {
                eyeCtx.stroke(SVGPath.parse(PipRig.eyesHappy), with: .color(ink), style: rounded(2.2))
            } else {
                eyeCtx.fill(Path(ellipseIn: CGRect(x: 26 - 2.7, y: 27 - 2.7, width: 5.4, height: 5.4)), with: .color(ink))
                eyeCtx.fill(Path(ellipseIn: CGRect(x: 38 - 2.7, y: 27 - 2.7, width: 5.4, height: 5.4)), with: .color(ink))
            }
            for cx in [21.0, 43.0] {
                ctx.fill(Path(ellipseIn: CGRect(x: cx - 2.6, y: 33 - 2.6, width: 5.2, height: 5.2)), with: .color(PipRig.cheek.opacity(0.55)))
            }
            ctx.stroke(SVGPath.parse(PipRig.mouth), with: .color(ink), style: rounded(2.2))
        }
        .accessibilityHidden(true)
    }
}

/// Pip in place, with his mood: arrive hops in, cheer bounces with the happy face and the flag, quiet never moves.
/// Calm mode fades instead and stops the blink. Give it an `.id` per spot so each arrival plays once.
struct PipMarker: View {
    let mood: Pip.Mood
    let calm: Bool
    @State private var shown = false

    var body: some View {
        let motion = Pip.motion(mood, calm: calm)
        let blinks = Pip.blinks(mood, calm: calm)
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !blinks)) { t in
            PipArt(happy: mood == .cheer, flag: mood == .cheer,
                   eyes: blinks ? CGFloat(Pip.blinkScale(at: t.date.timeIntervalSinceReferenceDate)) : 1)
        }
        .opacity(motion == .fade || motion == .hop ? (shown ? 1 : 0) : 1)
        .offset(y: motion == .hop && !shown ? -14 : 0)
        .scaleEffect(motion == .bounce && !shown ? 0.82 : 1, anchor: .bottom)
        .onAppear {
            switch motion {
            case .still: shown = true
            case .fade: withAnimation(.easeOut(duration: 0.4)) { shown = true }
            case .hop: withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { shown = true }
            case .bounce: withAnimation(.spring(response: 0.35, dampingFraction: 0.4)) { shown = true }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The reserved spot on a card's trailing edge. Always takes its space, so text never moves when Pip comes or goes.
struct PipSlot<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack { content }
            .frame(width: 44, height: 48)
            .accessibilityHidden(true)
    }
}

/// What Pip says, as a small bubble under his spot. Hidden from VoiceOver: the screen announces the same words once.
/// `pointDown` adds a small caret under it, pointing at the list below (the heading greeting).
struct PipBubble: View {
    let text: String
    var pointDown = false

    var body: some View {
        VStack(spacing: 0) {
            Text(text)
                .font(.caption.weight(.heavy)).foregroundStyle(Palette.ink)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Palette.paper, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.ink, lineWidth: 2))
            if pointDown {
                Triangle().fill(Palette.ink).frame(width: 12, height: 7)
            }
        }
        .fixedSize()
        .accessibilityHidden(true)
    }

    private struct Triangle: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
            p.closeSubpath()
            return p
        }
    }
}

/// The "Calm mode" switch (the website's toggle, saved on this phone): Pip fades instead of hopping, and stops blinking.
/// Already on, and not changeable here, when Reduce Motion is on.
struct CalmToggle: View {
    @AppStorage(Pip.calmKey) private var saved = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Toggle("Calm mode", isOn: Binding(get: { Pip.calm(reduceMotion: reduceMotion, saved: saved) }, set: { saved = $0 }))
            .toggleStyle(.switch)
            .font(.caption.weight(.bold))
            .tint(Palette.teal)
            .fixedSize()
            .disabled(reduceMotion)
            .accessibilityHint(reduceMotion ? "Your device already asks for less motion" : "Pip fades instead of hopping")
    }
}

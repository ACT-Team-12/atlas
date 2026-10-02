import SafariServices
import SwiftUI
import UIKit
import VisionKit

/// VisionKit document camera. Pages are handed straight to on-device OCR.
struct DocumentScanner: UIViewControllerRepresentable {
    let onScan: ([CGImage]) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan, onCancel: onCancel) }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
        let onScan: ([CGImage]) -> Void
        let onCancel: () -> Void
        init(onScan: @escaping ([CGImage]) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan; self.onCancel = onCancel
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pages = (0..<scan.pageCount).compactMap { ImageLoader.cgImage(from: scan.imageOfPage(at: $0)) }
            onScan(pages)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onCancel() }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onCancel() }
    }
}

enum ImageLoader {
    /// Decodes and upright-orients a photo, capped at 3000 px on the long side for OCR.
    static func cgImage(from data: Data) -> CGImage? {
        guard let image = UIImage(data: data) else { return nil }
        return cgImage(from: image)
    }

    static func cgImage(from image: UIImage) -> CGImage? {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { return nil }
        let scale = min(1, 3000 / longest)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.cgImage
    }
}

/// In-app browser for the privacy page and program links.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Palette.teal)
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// The ATLAS mark from web/src/ui/Mark.tsx: teal rounded square, folded paper, check.
struct AppMark: View {
    var size: CGFloat = 40

    var body: some View {
        Canvas { ctx, sz in
            let s = sz.width / 64
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            ctx.fill(Path(roundedRect: CGRect(x: 2 * s, y: 2 * s, width: 60 * s, height: 60 * s), cornerRadius: 18 * s), with: .color(Palette.teal))
            var paper = Path()
            paper.move(to: p(20, 14)); paper.addLine(to: p(37, 14)); paper.addLine(to: p(46, 23))
            paper.addLine(to: p(46, 50)); paper.addQuadCurve(to: p(43, 53), control: p(46, 53))
            paper.addLine(to: p(20, 53)); paper.addQuadCurve(to: p(17, 50), control: p(17, 53))
            paper.addLine(to: p(17, 17)); paper.addQuadCurve(to: p(20, 14), control: p(17, 14)); paper.closeSubpath()
            ctx.fill(paper, with: .color(Palette.paper))
            var fold = Path()
            fold.move(to: p(37, 14)); fold.addLine(to: p(37, 23)); fold.addLine(to: p(46, 23)); fold.closeSubpath()
            ctx.fill(fold, with: .color(Palette.mint))
            var check = Path()
            check.move(to: p(23.5, 37.5)); check.addLine(to: p(29, 43)); check.addLine(to: p(40, 31))
            ctx.stroke(check, with: .color(Palette.teal), style: StrokeStyle(lineWidth: 4.5 * s, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

import CoreGraphics
import Foundation
import Vision

/// Reads text from photos on the phone with Apple's Vision framework. Nothing is uploaded.
enum TextRecognizer {
    /// Recognizes every page and joins them, one recognized line per text line, pages separated by a blank line.
    static func recognize(pages: [CGImage]) async throws -> String {
        var out: [String] = []
        for page in pages {
            try Task.checkCancellation()
            let text = try await recognize(page)
            if !text.isEmpty { out.append(text) }
        }
        return out.joined(separator: "\n\n")
    }

    static func recognize(_ image: CGImage) async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.automaticallyDetectsLanguage = true
                do {
                    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                    let observations = request.results ?? []
                    cont.resume(returning: lines(from: observations).joined(separator: "\n"))
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    /// Top to bottom, then left to right. Vision's boundingBox origin is bottom-left.
    static func lines(from observations: [VNRecognizedTextObservation]) -> [String] {
        let rows = observations.compactMap { obs -> (CGRect, String)? in
            guard let s = obs.topCandidates(1).first?.string, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return (obs.boundingBox, s)
        }
        // Group pieces that sit on the same visual line, then read each group left to right.
        var groups: [[(CGRect, String)]] = []
        for row in rows.sorted(by: { $0.0.midY > $1.0.midY }) {
            if let anchor = groups.last?.first, abs(anchor.0.midY - row.0.midY) < min(anchor.0.height, row.0.height) * 0.5 {
                groups[groups.count - 1].append(row)
            } else {
                groups.append([row])
            }
        }
        return groups.map { $0.sorted { $0.0.minX < $1.0.minX }.map(\.1).joined(separator: "   ") }
    }
}

import AVFoundation
import Observation

/// Read aloud with the phone's own voices. One utterance per line so it pauses between steps.
@MainActor
@Observable
final class Speaker: NSObject {
    /// Same map as SPEECH_LANG in web/src/ui/CarePlanTool.tsx.
    nonisolated static let voiceCode: [Language: String] = [
        .English: "en-US", .Spanish: "es-US", .Vietnamese: "vi-VN", .Korean: "ko-KR",
        .Chinese: "zh-CN", .Amharic: "am-ET", .French: "fr-FR",
    ]

    nonisolated static func code(for language: Language) -> String { voiceCode[language] ?? "en-US" }

    private(set) var isSpeaking = false
    /// Set when the phone has no voice for the chosen language, so the screen can say so.
    private(set) var missingVoiceNote: String?

    @ObservationIgnored private let synth = AVSpeechSynthesizer()
    @ObservationIgnored private var remaining = 0

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(lines: [String], language: Language) {
        stop()
        let code = Self.code(for: language)
        let voice = AVSpeechSynthesisVoice(language: code)
        missingVoiceNote = voice == nil
            ? "This phone has no \(language.rawValue) voice installed, so it reads with its default voice. You can add voices in Settings, Accessibility, Spoken Content."
            : nil
        let clean = lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !clean.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        remaining = clean.count
        isSpeaking = true
        for line in clean {
            let u = AVSpeechUtterance(string: line)
            u.voice = voice
            u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
            u.postUtteranceDelay = 0.25
            synth.speak(u)
        }
    }

    func stop() {
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
        remaining = 0
        isSpeaking = false
    }

    private func finishedOne() {
        remaining = max(0, remaining - 1)
        if remaining == 0 { isSpeaking = false }
    }
}

extension Speaker: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finishedOne() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.isSpeaking = false }
    }
}

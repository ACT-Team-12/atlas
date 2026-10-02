import Foundation
import Testing
import UIKit
import UserNotifications
@testable import ATLAS

struct ReminderTests {
    @Test func contentIsStepTitlePlusQuote() {
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        let draft = ReminderDraft(stepTitle: "Start metformin",
                                  quote: "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.",
                                  date: date)
        let content = Reminders.content(for: draft)
        #expect(content.title == "ATLAS reminder: Start metformin")
        #expect(content.body == "Start metformin\nFrom your paper: \u{201C}metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.\u{201D}")
        #expect(content.sound != nil)
    }

    @Test func noQuoteNeverClaimsToBeFromThePaper() {
        let draft = ReminderDraft(stepTitle: "Apply for Medicaid", quote: "  ", date: Date(), detail: "Apply through Georgia Gateway.")
        #expect(!draft.notificationBody.contains("From your paper"))
        #expect(draft.notificationBody == "Apply for Medicaid\nApply through Georgia Gateway.")
    }

    @Test func triggerMatchesChosenMinuteAndDoesNotRepeat() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        let date = try #require(cal.date(from: DateComponents(year: 2026, month: 10, day: 9, hour: 8, minute: 30)))
        let req = Reminders.request(for: ReminderDraft(stepTitle: "Lab", quote: "Basic metabolic panel", date: date),
                                    id: "atlas-reminder-test", calendar: cal)
        let trigger = try #require(req.trigger as? UNCalendarNotificationTrigger)
        #expect(!trigger.repeats)
        #expect(trigger.dateComponents.year == 2026)
        #expect(trigger.dateComponents.month == 10)
        #expect(trigger.dateComponents.day == 9)
        #expect(trigger.dateComponents.hour == 8)
        #expect(trigger.dateComponents.minute == 30)
        #expect(req.identifier.hasPrefix(Reminders.identifierPrefix))
    }
}

struct SpeechTests {
    @Test func languageToVoiceMapMatchesWeb() {
        let expected: [Language: String] = [
            .English: "en-US", .Spanish: "es-US", .Vietnamese: "vi-VN", .Korean: "ko-KR",
            .Chinese: "zh-CN", .Amharic: "am-ET", .French: "fr-FR",
        ]
        for lang in Language.allCases { #expect(Speaker.code(for: lang) == expected[lang]) }
        #expect(Speaker.voiceCode.count == Language.allCases.count)
    }
}

struct SampleTests {
    /// The app's sample must be byte-identical to the web sample (web/src/lib/sample.ts).
    /// Reads the repo file through #filePath, which the Simulator can see.
    @Test func sampleMatchesWebSource() throws {
        let here = URL(fileURLWithPath: #filePath)
        let web = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("web/src/lib/sample.ts")
        let src = try String(contentsOf: web, encoding: .utf8)
        let start = try #require(src.range(of: "SAMPLE_AVS = `"))
        let end = try #require(src.range(of: "`;", range: start.upperBound..<src.endIndex))
        #expect(String(src[start.upperBound..<end.lowerBound]) == Sample.text)
    }
}

struct StoreTests {
    @Test func savesLoadsAndClears() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = SessionStore(directory: dir)
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Fixture.data("extract_sample_live"))
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let session = SavedSession(text: Sample.text, language: .Spanish, level: .simple, care: care, barriers: [.transport],
                                   zip: "30303", note: "", plan: plan, done: ["item-0": true], removed: [:],
                                   savedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try store.save(session)
        #expect(store.load() == session)
        store.clear()
        #expect(store.load() == nil)
    }
}

struct OCRTests {
    /// Renders a few real lines of the sample paper and reads them back with Vision, on device.
    @Test func recognizesRenderedSampleLines() async throws {
        let lines = ["AFTER VISIT SUMMARY", "Return to clinic in 3 months, or sooner if needed."]
        let image = try #require(Self.render(lines))
        let text = try await TextRecognizer.recognize(image)
        #expect(text.contains("AFTER VISIT SUMMARY"))
        #expect(text.contains("Return to clinic in 3 months"))
    }

    static func render(_ lines: [String]) -> CGImage? {
        let size = CGSize(width: 1400, height: 120 * lines.count + 80)
        let renderer = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
        let img = renderer.image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            for (i, line) in lines.enumerated() {
                (line as NSString).draw(at: CGPoint(x: 40, y: 40 + 120 * i),
                                        withAttributes: [.font: UIFont.systemFont(ofSize: 48), .foregroundColor: UIColor.black])
            }
        }
        return img.cgImage
    }
}

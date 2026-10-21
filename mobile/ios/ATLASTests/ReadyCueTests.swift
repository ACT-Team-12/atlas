import Foundation
import Testing
@testable import ATLAS

/// The ready cue's rules (web/src/ui/ReadyCue.tsx and cueFor in web/src/ui/CarePlanTool.tsx), on iPhone.
struct ReadyCueTests {
    @Test func labelsAreTheWebsites() {
        #expect(ReadyCue.label(.steps) == "Your steps are ready")
        #expect(ReadyCue.label(.plan) == "Your plan is ready")
    }

    @Test func showsOnlyForTheExactCurrentResultAndNotOnItsOwnScreen() {
        let steps = ReadyCue.Mark(what: .steps, run: 2)
        #expect(ReadyCue.shown(steps, readingCount: 2, planCount: 0, careCurrent: true, planCurrent: false, top: nil) == .steps)
        #expect(ReadyCue.shown(steps, readingCount: 2, planCount: 0, careCurrent: true, planCurrent: false, top: .reminders) == .steps)
        // Already on the steps screen: nothing to show.
        #expect(ReadyCue.shown(steps, readingCount: 2, planCount: 0, careCurrent: true, planCurrent: false, top: .steps) == nil)
        // Outdated (the text, language or level changed meanwhile): never a cue for it.
        #expect(ReadyCue.shown(steps, readingCount: 2, planCount: 0, careCurrent: false, planCurrent: false, top: nil) == nil)
        // A newer reading replaced the one that raised it.
        #expect(ReadyCue.shown(steps, readingCount: 3, planCount: 0, careCurrent: true, planCurrent: false, top: nil) == nil)
        let plan = ReadyCue.Mark(what: .plan, run: 1)
        #expect(ReadyCue.shown(plan, readingCount: 5, planCount: 1, careCurrent: true, planCurrent: true, top: .barriers) == .plan)
        #expect(ReadyCue.shown(plan, readingCount: 5, planCount: 1, careCurrent: true, planCurrent: false, top: .barriers) == nil)
        #expect(ReadyCue.shown(plan, readingCount: 5, planCount: 2, careCurrent: true, planCurrent: true, top: .barriers) == nil)
        #expect(ReadyCue.shown(nil, readingCount: 0, planCount: 0, careCurrent: true, planCurrent: true, top: nil) == nil)
    }

    @Test func showMeGoesToTheResultScreen() {
        #expect(ReadyCue.path(showing: .steps, from: []) == [.steps])
        #expect(ReadyCue.path(showing: .steps, from: [.check]) == [.check, .steps])
        #expect(ReadyCue.path(showing: .steps, from: [.check, .steps, .barriers]) == [.check, .steps])
        #expect(ReadyCue.path(showing: .plan, from: [.check, .steps, .barriers]) == [.check, .steps, .barriers, .plan])
        #expect(ReadyCue.path(showing: .plan, from: []) == [.steps, .plan])
        #expect(ReadyCue.path(showing: .plan, from: [.steps, .plan, .reminders]) == [.steps, .plan])
    }
}

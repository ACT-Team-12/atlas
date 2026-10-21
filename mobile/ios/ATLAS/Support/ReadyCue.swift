import Foundation

/// "Your plan is ready: show me" (web/src/ui/ReadyCue.tsx). Reading the paper and building the plan take 15 to 25
/// seconds. A person may choose to look around the app meanwhile; when the result lands, the app does not move them.
/// Instead this cue floats at the bottom of every screen until they use it or open the result themselves. The rules
/// here are pure and tested in ReadyCueTests.
enum ReadyCue {
    enum What: String, Sendable { case steps, plan }

    /// The exact result that raised the cue: which kind, and which reading or plan (counted in this run of the app).
    struct Mark: Equatable, Sendable {
        let what: What
        let run: Int
    }

    /// LABEL in ReadyCue.tsx, also said once, politely, when the cue appears.
    static func label(_ what: What) -> String {
        switch what {
        case .steps: "Your steps are ready"
        case .plan: "Your plan is ready"
        }
    }

    /// The screen the cue takes the person to.
    static func route(_ what: What) -> Route { what == .steps ? .steps : .plan }

    /// cueFor in CarePlanTool.tsx: the cue shows only for the exact result that raised it and only while that result
    /// is still current (never for outdated steps or an outdated plan), and hides once its screen is open.
    static func shown(_ mark: Mark?, readingCount: Int, planCount: Int, careCurrent: Bool, planCurrent: Bool, top: Route?) -> What? {
        guard let mark, top != route(mark.what) else { return nil }
        switch mark.what {
        case .steps: return mark.run == readingCount && careCurrent ? .steps : nil
        case .plan: return mark.run == planCount && planCurrent ? .plan : nil
        }
    }

    /// Where "show me" goes: back to the result's screen if it is already in the stack, otherwise on top of where the
    /// person is (the back button then returns them there).
    static func path(showing what: What, from path: [Route]) -> [Route] {
        let target = route(what)
        if let i = path.firstIndex(of: target) { return Array(path.prefix(i + 1)) }
        if what == .plan && !path.contains(.steps) { return path + [.steps, .plan] }
        return path + [target]
    }
}

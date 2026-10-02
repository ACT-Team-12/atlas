import Foundation
import os
import UserNotifications

/// One reminder the person asked for. Built from a step title plus the exact line from their paper.
struct ReminderDraft: Equatable, Sendable {
    let stepTitle: String
    /// The exact line from the person's paper. Empty when a plan step cites no care step.
    let quote: String
    let date: Date
    /// Used only when there is no quote, so the reminder never pretends a line came from the paper.
    var detail: String = ""

    var notificationTitle: String { "ATLAS reminder: \(stepTitle)" }

    var notificationBody: String {
        let q = quote.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty { return "\(stepTitle)\nFrom your paper: \u{201C}\(q)\u{201D}" }
        let d = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        return d.isEmpty ? stepTitle : "\(stepTitle)\n\(d)"
    }
}

/// Local notifications only. Works with no internet, nothing leaves the phone.
enum Reminders {
    static let log = Logger(subsystem: "com.stephensookra.atlas", category: "reminders")
    static let identifierPrefix = "atlas-reminder-"

    static func content(for draft: ReminderDraft) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = draft.notificationTitle
        content.body = draft.notificationBody
        content.sound = .default
        content.userInfo = ["stepTitle": draft.stepTitle, "quote": draft.quote]
        return content
    }

    static func request(for draft: ReminderDraft, id: String = identifierPrefix + UUID().uuidString,
                        calendar: Calendar = .current) -> UNNotificationRequest {
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: draft.date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        return UNNotificationRequest(identifier: id, content: content(for: draft), trigger: trigger)
    }

    /// Asks for permission if needed, then schedules. Returns a plain-words error message on failure.
    static func schedule(_ draft: ReminderDraft) async -> String? {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .denied:
            return "Notifications are off for ATLAS. Turn them on in Settings to get reminders."
        case .notDetermined:
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if !granted { return "Without notification permission ATLAS cannot remind you. You can turn it on in Settings." }
        default:
            break
        }
        if draft.date <= Date() { return "Pick a time in the future." }
        let req = request(for: draft)
        do {
            try await center.add(req)
            log.info("Scheduled reminder \(req.identifier, privacy: .public) for \(draft.date, privacy: .public)")
            let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(identifierPrefix) }
            log.info("Pending ATLAS reminders: \(pending.count, privacy: .public)")
            return nil
        } catch {
            return "The reminder could not be saved. Try again."
        }
    }

    struct Pending: Identifiable, Hashable, Sendable {
        let id: String
        let title: String
        let body: String
        let date: Date?
    }

    static func pending() async -> [Pending] {
        let reqs = await UNUserNotificationCenter.current().pendingNotificationRequests()
        return reqs
            .filter { $0.identifier.hasPrefix(identifierPrefix) }
            .map { r in
                Pending(id: r.identifier, title: r.content.title, body: r.content.body,
                        date: (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate())
            }
            .sorted { ($0.date ?? .distantFuture) < ($1.date ?? .distantFuture) }
    }

    static func remove(ids: [String]) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }

    static func removeAll() async {
        let ids = await pending().map(\.id)
        remove(ids: ids)
    }
}

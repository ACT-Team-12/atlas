import EventKit
import EventKitUI
import SwiftUI

/// What goes into the calendar event. Pure data so it can be tested without a calendar.
struct CalendarDraft: Equatable {
    let title: String
    let start: Date
    let quote: String
    let detail: String
    var minutes = 60

    var end: Date { start.addingTimeInterval(TimeInterval(minutes * 60)) }
    /// Same wording idea as the web .ics: the line from the paper rides along with the event.
    var notes: String {
        var lines: [String] = []
        if !detail.isEmpty { lines.append(detail) }
        if !quote.isEmpty { lines.append("Your paper says: \"\(quote)\"") }
        lines.append("From ATLAS. Not medical advice.")
        return lines.joined(separator: "\n\n")
    }
    /// Reminders the day before and 2 hours before, like the web .ics file.
    let alarmOffsets: [TimeInterval] = [-24 * 3600, -2 * 3600]
}

/// Apple's own "New Event" screen, filled in. Since iOS 17 an app can add an event this way without asking for
/// calendar access: the person saves it themselves and ATLAS never reads their calendar.
struct CalendarEditor: UIViewControllerRepresentable {
    let draft: CalendarDraft
    let onDone: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        event.startDate = draft.start
        event.endDate = draft.end
        event.notes = draft.notes
        event.alarms = draft.alarmOffsets.map { EKAlarm(relativeOffset: $0) }
        let vc = EKEventEditViewController()
        vc.eventStore = store
        vc.event = event
        vc.editViewDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onDone: (Bool) -> Void
        init(onDone: @escaping (Bool) -> Void) { self.onDone = onDone }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onDone(action == .saved)
        }
    }
}

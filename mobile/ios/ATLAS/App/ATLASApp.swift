import SwiftUI
import UserNotifications

@main
struct ATLASApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Palette.teal)
                .preferredColorScheme(.light)
                // Helper links (https://atlas-team12.vercel.app/#try&via=helper&lang=es&level=simple&zip=30310) are
                // Universal Links for the site's root page (Associated Domains + web/public/.well-known/
                // apple-app-site-association). Anything that is not a valid helper link is ignored. Applying one is
                // idempotent, so it is safe if both handlers see the same link.
                .onOpenURL { model.open($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { model.open(url) }
                }
        }
    }
}

/// Shows ATLAS reminders as banners even when the app is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification)
        async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}

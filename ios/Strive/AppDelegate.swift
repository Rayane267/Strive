import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore
import FirebaseMessaging
import ActivityKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()

    // Push notifications
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
    application.registerForRemoteNotifications()
    Messaging.messaging().delegate = self

    // Notif "résultat de scan" actionnable : boutons Accepter / Refuser. Permet
    // au chauffeur de taguer la course sans ouvrir l'app (gros point de friction
    // remonté en test). La décision est écrite dans l'App Group puis réconciliée
    // côté JS via ScanBridge → updateRideStatus. Voir AnalyzeRideIntent.
    registerScanResultCategory()
    UNUserNotificationCenter.current().delegate = self

    if #available(iOS 16.2, *) {
      let info = ActivityAuthorizationInfo()
      NSLog("[Strive] Live Activities enabled: %d, active: %d",
            info.areActivitiesEnabled ? 1 : 0,
            Activity<StriveActivityAttributes>.activities.count)
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Strive",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // MARK: - URL Scheme (strive://)

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.scheme == "strive" {
      NotificationCenter.default.post(
        name: UIApplication.didBecomeActiveNotification,
        object: nil
      )
      return true
    }
    return false
  }

  // MARK: - Push Notifications

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    Messaging.messaging().apnsToken = deviceToken
  }
}

// MARK: - Firebase Messaging

extension AppDelegate: MessagingDelegate {
  func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
    // Le token est géré côté JS par notificationService.ts
  }
}

// MARK: - Notifications actionnables (Accepter / Refuser un scan)

extension AppDelegate: UNUserNotificationCenterDelegate {

  private static let appGroupId =
    Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
      ?? "group.com.striveapp.app"
  private static let scanCategoryId = "STRIVE_SCAN_RESULT"
  private static let acceptActionId = "STRIVE_ACCEPT"
  private static let declineActionId = "STRIVE_DECLINE"
  private static let decisionsKey = "pendingRideDecisions"

  private func registerScanResultCategory() {
    let fr = (UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
      ?? Locale.current.languageCode ?? "en").hasPrefix("fr")
    let accept = UNNotificationAction(
      identifier: Self.acceptActionId,
      title: fr ? "✅ Course prise" : "✅ Ride taken",
      options: []
    )
    let decline = UNNotificationAction(
      identifier: Self.declineActionId,
      title: fr ? "❌ Refusée" : "❌ Declined",
      options: [.destructive]
    )
    let category = UNNotificationCategory(
      identifier: Self.scanCategoryId,
      actions: [accept, decline],
      intentIdentifiers: [],
      options: []
    )
    UNUserNotificationCenter.current().setNotificationCategories([category])
  }

  // Affiche la notif même app au premier plan (sinon le testeur ne la verrait
  // pas en debug). Inoffensif pour les notifs FCM.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound, .badge])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let action = response.actionIdentifier
    if action == Self.acceptActionId || action == Self.declineActionId,
       let ts = (response.notification.request.content.userInfo["scanTs"] as? NSNumber)?.doubleValue,
       ts > 0 {
      appendRideDecision(scanTs: ts, status: action == Self.acceptActionId ? "ACCEPTED" : "DECLINED")
    }
    completionHandler()
  }

  /// Empile la décision dans l'App Group (survit au cold start) puis notifie
  /// l'app via Darwin → ScanBridge la draine et l'émet au JS.
  private func appendRideDecision(scanTs: Double, status: String) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    var arr: [[String: Any]] = []
    if let data = defaults.data(forKey: Self.decisionsKey),
       let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      arr = existing
    }
    arr.append(["scanTs": scanTs, "status": status])
    if let data = try? JSONSerialization.data(withJSONObject: arr) {
      defaults.set(data, forKey: Self.decisionsKey)
    }
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterPostNotification(
      center,
      CFNotificationName("com.striveapp.app.rideDecision" as CFString),
      nil, nil, true
    )
  }
}

// MARK: - React Native

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

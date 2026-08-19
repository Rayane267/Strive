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

  /// Le pont React Native n'est démarré qu'une fois, éventuellement en différé.
  private var reactNativeStarted = false
  /// Conservées quand le démarrage est différé, pour les passer au vrai départ.
  private var pendingLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

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

    window = UIWindow(frame: UIScreen.main.bounds)

    // ── Lancement en ARRIÈRE-PLAN : on ne démarre pas React Native ───────────
    //
    // AssistiveTouch → raccourci → AnalyzeRideIntent lance l'app en arrière-plan.
    // Or `AnalyzeRideIntent` est compilé dans CE target (pas dans une extension),
    // donc iOS démarrait l'application ENTIÈRE — pont React Native compris — pour
    // un pipeline de scan qui est 100 % Swift (ScanProcessor, OcrParser,
    // TomTomService, GeminiVisionService) et n'utilise pas une ligne de JS.
    // Mesuré : ~2 s à froid, immédiat à chaud. En usage réel le chauffeur n'ouvre
    // jamais l'app, elle est donc évincée en permanence : le coût était payé à
    // presque chaque scan. Ce lancement se fait de surcroît sous un budget serré,
    // où le process se fait déjà tuer par iOS (« Strive a quitté inopinément »
    // remonté par Raccourcis) : y rajouter le pont ne ferait qu'aggraver.
    //
    // Ce qui avait motivé un retour en arrière ici — la course enregistrée dès
    // le scan, et non à l'ouverture de l'app — est assuré sans le pont :
    // `RideUploader` confie l'écriture à une session URLSession de FOND, que le
    // démon système mène à terme même ce process mort.
    //
    // Et si elle échoue, rien n'est perdu : la course reste dans
    // `pendingScanResults` (App Group), drainée à la prochaine ouverture. Une
    // entrée ne quitte la file que sur `ackScan`, et elle porte `scanTs`, dont
    // `createRide` dérive `created_at` — la course atterrit au jour du scan,
    // pas au jour du drain.
    //
    // Les autres lancements en arrière-plan sont dans le même cas : les actions
    // « Accepter / Refuser » d'une notification écrivent dans l'App Group en Swift,
    // et `ScanBridge.drainAndEmitRideDecisions()` relève la file au prochain
    // passage au premier plan. Aucun `setBackgroundMessageHandler` n'existe côté
    // JS, donc aucune notification silencieuse n'a besoin du pont.
    //
    // Le pont démarre au premier passage au premier plan.
    if application.applicationState == .background {
      pendingLaunchOptions = launchOptions
      NSLog("[Strive] lancement en arrière-plan — démarrage de React Native différé")
      return true
    }

    startReactNativeIfNeeded(launchOptions: launchOptions)
    return true
  }

  /// Démarre le pont React Native. Idempotent : les appels suivants ne font rien.
  ///
  /// Quand le démarrage a été différé, la fenêtre n'a encore aucun contenu — iOS
  /// afficherait un écran noir pendant le boot, puisqu'il restaure la capture de
  /// la dernière UI et qu'il n'y en a jamais eu. On y pose donc d'abord le
  /// `LaunchScreen`, exactement ce que l'utilisateur voit sur un lancement à
  /// froid normal ; `startReactNative` le remplace en montant sa rootView.
  private func startReactNativeIfNeeded(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    guard !reactNativeStarted, let window = window else { return }
    reactNativeStarted = true

    if window.rootViewController == nil {
      window.rootViewController = UIStoryboard(name: "LaunchScreen", bundle: nil)
        .instantiateInitialViewController()
      window.makeKeyAndVisible()
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    factory.startReactNative(
      withModuleName: "Strive",
      in: window,
      launchOptions: launchOptions
    )
  }

  func applicationWillEnterForeground(_ application: UIApplication) {
    // Cas nominal du démarrage différé : l'app passe au premier plan après avoir
    // été lancée en arrière-plan pour un scan.
    startReactNativeIfNeeded(launchOptions: pendingLaunchOptions)
    pendingLaunchOptions = nil
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    // Filet : certaines transitions (retour depuis un raccourci, reprise après
    // interruption) n'émettent pas `willEnterForeground`. `startReactNativeIfNeeded`
    // étant idempotent, ce second appel est sans effet dans le cas nominal.
    startReactNativeIfNeeded(launchOptions: pendingLaunchOptions)
    pendingLaunchOptions = nil
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

  // MARK: - Session de fond (écriture immédiate des courses)

  /// iOS relance l'app en arrière-plan quand une session de fond a fini ses
  /// transferts alors que le process qui les avait lancés (Share Extension,
  /// raccourci) était mort.
  ///
  /// On n'a rien à faire de ces événements : `RideUploader` n'exploite aucune
  /// complétion, la réconciliation passe par le drain de l'outbox. Mais le
  /// handler doit exister et son completion doit être appelé — sans quoi iOS
  /// considère l'app en faute et peut la tuer, voire suspendre la session.
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    NSLog("[Strive] session de fond terminée — %@", identifier)
    completionHandler()
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
    // Anglais uniquement si l'app est réglée en anglais, français sinon — même
    // règle que partout ailleurs (la locale système ne fait pas foi).
    let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    let fr = !(appLang?.hasPrefix("en") ?? false)
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

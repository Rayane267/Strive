import Foundation
import UIKit
import React
import ActivityKit
import Sentry

/// Module natif React Native — pont entre JS et le scanner iOS.
/// Équivalent de ScanBridgeModule.kt sur Android.
@objc(ScanBridge)
class ScanBridgeModule: RCTEventEmitter {

  private var isActive = false
  private var hasListeners = false
  private var pendingLiveActivityPayload: [String: Any]?

  // MARK: - App Group (partage données avec Share Extension)

  /// Lu depuis Info.plist (`StriveAppGroupId`) — fallback hardcodé pour les
  /// targets qui ne l'auraient pas encore configuré. Centralise la valeur pour
  /// éviter la dérive entre app principale et Share Extension.
  static let appGroupId: String = {
    Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
      ?? "group.com.striveapp.app"
  }()
  static let scanResultKey = "lastScanResult"
  static let scanTimestampKey = "lastScanTimestamp"

  // MARK: - RCTEventEmitter

  override static func moduleName() -> String! {
    return "ScanBridge"
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onScanResult", "onScanFailed", "onPermissionDenied", "onLiveActivityDismissed"]
  }

  private var laDismissObserver: Any?

  override func startObserving() {
    hasListeners = true
    if #available(iOS 16.2, *) {
      laDismissObserver = NotificationCenter.default.addObserver(
        forName: LiveActivityManager.dismissedNotification,
        object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent(withName: "onLiveActivityDismissed", body: nil)
      }
    }
  }

  override func stopObserving() {
    hasListeners = false
    if let obs = laDismissObserver {
      NotificationCenter.default.removeObserver(obs)
      laDismissObserver = nil
    }
  }

  // MARK: - Lifecycle

  override init() {
    super.init()
    // Écouter les résultats de la Share Extension via Darwin notification
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      center,
      observer,
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let module = Unmanaged<ScanBridgeModule>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async {
          module.handleShareExtensionResult()
        }
      },
      "com.striveapp.app.scanResult" as CFString,
      nil,
      .deliverImmediately
    )

    // Aussi écouter quand l'app revient au premier plan (au cas où la notification Darwin est manquée)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
  }

  deinit {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterRemoveEveryObserver(center, Unmanaged.passUnretained(self).toOpaque())
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func appDidBecomeActive() {
    if isActive {
      handleShareExtensionResult()
    }
    // Si un payload est en attente et qu'une LA IDLE tourne, on l'update
    if #available(iOS 16.2, *), let payload = pendingLiveActivityPayload {
      pendingLiveActivityPayload = nil
      if !Activity<StriveActivityAttributes>.activities.isEmpty {
        LiveActivityManager.shared.update(
          platform: (payload["platform"] as? String) ?? "UNKNOWN",
          fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
          hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
          kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
          distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
          durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
          verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0
        )
      }
    }
  }

  // MARK: - Lecture résultat Share Extension

  private var lastProcessedTimestamp: Double = 0

  private func handleShareExtensionResult() {
    guard hasListeners else { return }
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }

    let timestamp = defaults.double(forKey: Self.scanTimestampKey)
    guard timestamp > lastProcessedTimestamp else { return }
    lastProcessedTimestamp = timestamp

    guard let jsonData = defaults.data(forKey: Self.scanResultKey),
          let result = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
    else {
      sendEvent(withName: "onScanFailed", body: nil)
      return
    }

    // Nettoyer après lecture
    defaults.removeObject(forKey: Self.scanResultKey)
    defaults.removeObject(forKey: Self.scanTimestampKey)

    // Tente de démarrer le Live Activity depuis l'app principale si la
    // Share Extension n'a pas réussi (pas d'activité en cours).
    if #available(iOS 16.2, *) {
      let existing = Activity<StriveActivityAttributes>.activities
      let shareExtStatus = (result["_liveActivityDebug"] as? String) ?? "unknown"
      NSLog("[Strive:Bridge] ShareExt LA status=%@, existing activities=%d, appState=%d",
            shareExtStatus, existing.count, UIApplication.shared.applicationState.rawValue)

      if existing.isEmpty {
        var payload = result
        let fare = (payload["fare"] as? NSNumber)?.doubleValue ?? 0
        let distKm = (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0
        let durMin = (payload["durationMin"] as? NSNumber)?.intValue ?? 0

        if (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0 == 0, fare > 0, durMin > 0 {
          payload["hourlyRate"] = fare / (Double(durMin) / 60.0)
        }
        if (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0 == 0, fare > 0, distKm > 0 {
          payload["kmRate"] = fare / distKm
        }
        if payload["verdictLevel"] == nil {
          let prefs = UserDefaults(suiteName: Self.appGroupId)
          let minH = prefs?.double(forKey: "minHourlyRate") ?? 25.0
          let minK = prefs?.double(forKey: "minKmRate") ?? 1.2
          let hr = (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0
          let km = (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0
          payload["verdictLevel"] = (hr >= minH && km >= minK) ? 2 : (hr >= minH || km >= minK) ? 1 : 0
        }

        LiveActivityManager.shared.update(
          platform: (payload["platform"] as? String) ?? "UNKNOWN",
          fare: fare,
          hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
          kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
          distanceKm: distKm,
          durationMin: durMin,
          verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0
        )
      }

      let defaults = UserDefaults(suiteName: Self.appGroupId)
      let laResult = defaults?.string(forKey: "laLastStep") ?? "none"
      let existingAfter = Activity<StriveActivityAttributes>.activities.count

      SentrySDK.capture(message: "LiveActivity debug") { scope in
        scope.setLevel(.info)
        scope.setTag(value: "live-activity", key: "feature")
        scope.setTag(value: shareExtStatus, key: "share-ext-result")
        scope.setTag(value: String(laResult.prefix(200)), key: "la-result")
        scope.setTag(value: "\(existing.count)>\(existingAfter)", key: "la-count")
        scope.setTag(value: "\(UIApplication.shared.applicationState.rawValue)", key: "la-appstate")
        scope.setContext(value: [
          "shareExtStatus": shareExtStatus,
          "existingBefore": "\(existing.count)",
          "existingAfter": "\(existingAfter)",
          "appState": "\(UIApplication.shared.applicationState.rawValue)",
          "mainAppAuthEnabled": "\(ActivityAuthorizationInfo().areActivitiesEnabled)",
          "laResult": laResult,
        ], key: "live-activity-debug")
      }
      defaults?.removeObject(forKey: "laSteps")
      defaults?.removeObject(forKey: "laLastStep")
    }

    sendEvent(withName: "onScanResult", body: result)
  }

  // MARK: - Bridge Methods (appelées depuis JS)

  @objc func startScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = true
    // Vérifier s'il y a un résultat en attente
    handleShareExtensionResult()
    resolve(nil)
  }

  @objc func stopScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = false
    resolve(nil)
  }

  @objc func isScannerRunning(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(isActive)
  }

  @objc func checkPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // iOS n'a pas besoin d'overlay ni d'accessibility
    // On vérifie juste que la Share Extension est configurée
    let extensionConfigured = UserDefaults(suiteName: Self.appGroupId) != nil
    resolve([
      "overlay": true,                    // pas nécessaire sur iOS
      "accessibility": true,              // pas nécessaire sur iOS
      "needsMediaProjection": false,
      "mediaProjectionGranted": true,
      "shareExtensionReady": extensionConfigured,
    ])
  }

  @objc func showVerdict(_ level: NSNumber) {
    // Sur iOS, le verdict est affiché dans la Share Extension directement
    // On stocke quand même pour que l'extension puisse le récupérer
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(level.intValue, forKey: "lastVerdictLevel")
  }

  @objc func updateDuration(_ minutes: NSNumber) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(minutes.intValue, forKey: "lastDurationMin")
  }

  @objc func setGeminiConfig(_ edgeUrl: String, supabaseAnonKey: String) {
    GeminiVisionService.shared.edgeFunctionUrl = edgeUrl
    GeminiVisionService.shared.supabaseAnonKey = supabaseAnonKey
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(edgeUrl, forKey: "geminiEdgeUrl")
      defaults.set(supabaseAnonKey, forKey: "geminiSupabaseKey")
    }
  }

  /// JWT user — requis par l'edge function durcie (rate-limit + audit).
  /// Stocké dans App Group pour que la Share Extension l'utilise aussi.
  @objc func setSupabaseUserJwt(_ jwt: String) {
    GeminiVisionService.shared.supabaseUserJwt = jwt
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(jwt, forKey: "supabaseUserJwt")
    }
  }

  @objc func setParserConfig(_ configJson: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(configJson, forKey: "parserConfig")
    }
  }

  /// Clé TomTom — partagée avec l'AppIntent (Shortcut) et la Share Extension
  /// via App Group, pour que TomTomService puisse géocoder hors process JS.
  @objc func setTomTomApiKey(_ key: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(key, forKey: "tomTomApiKey")
    }
  }

  /// Quota journalier atteint — sync via App Group pour que la Share Extension
  /// et l'AppIntent puissent court-circuiter le scan sans appeler TomTom/Gemini.
  @objc func setQuotaReached(_ reached: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(reached, forKey: "scanQuotaReached")
    }
  }

  @objc func updateSessionKPI(_ payload: NSDictionary) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.updateSessionKPI(
        todayEarnings: (payload["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
        todayHourlyRate: (payload["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        todayKm: (payload["todayKm"] as? NSNumber)?.doubleValue ?? 0,
        onlineMinutes: (payload["onlineMinutes"] as? NSNumber)?.intValue ?? 0
      )
    }
  }

  @objc func setSessionOnline(_ online: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(online, forKey: "sessionOnline")
    }
  }

  @objc func setUseLiveActivity(_ enabled: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(enabled, forKey: "useLiveActivity")
    }
  }

  /// Préférences utilisateur pour le verdict natif (seuils + include pickup).
  /// Lus par AnalyzeRideIntent au moment du calcul de rentabilité.
  @objc func setScannerPreferences(_ minHourlyRate: NSNumber,
                                    minKmRate: NSNumber,
                                    includePickup: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(minHourlyRate.doubleValue, forKey: "minHourlyRate")
      defaults.set(minKmRate.doubleValue, forKey: "minKmRate")
      defaults.set(includePickup, forKey: "includePickup")
    }
  }

  @objc func openOverlayPermissionSettings() {
    // No-op sur iOS — pas de permission overlay
  }

  @objc func openAccessibilitySettings() {
    // No-op sur iOS — pas de permission accessibility
  }

  @objc func requestMediaProjectionPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // No-op sur iOS
    resolve(nil)
  }

  // MARK: - Live Activity (Dynamic Island)

  @objc func checkLiveActivityPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      let info = ActivityAuthorizationInfo()
      resolve(info.areActivitiesEnabled)
    } else {
      resolve(false)
    }
  }

  @objc func startLiveActivity(_ payload: NSDictionary,
                               resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      let started = LiveActivityManager.shared.start(
        platform: (payload["platform"] as? String) ?? "UNKNOWN",
        fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
        hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
        distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
        durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
        verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0,
        todayEarnings: (payload["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
        todayHourlyRate: (payload["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        todayKm: (payload["todayKm"] as? NSNumber)?.doubleValue ?? 0,
        onlineMinutes: (payload["onlineMinutes"] as? NSNumber)?.intValue ?? 0
      )
      resolve(started)
    } else {
      resolve(false)
    }
  }

  @objc func updateLiveActivity(_ payload: NSDictionary,
                                resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.update(
        platform: (payload["platform"] as? String) ?? "UNKNOWN",
        fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
        hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
        distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
        durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
        verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0
      )
    }
    resolve(nil)
  }

  @objc func stopLiveActivity(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.stop()
    }
    resolve(nil)
  }

  /// Analyse une image directement depuis l'app (ex: depuis la galerie photo)
  @objc func analyzeImage(_ imageUri: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let url = URL(string: imageUri),
          let data = try? Data(contentsOf: url),
          let image = UIImage(data: data)
    else {
      reject("INVALID_IMAGE", "Impossible de charger l'image", nil)
      return
    }

    VisionOCRService.shared.recognizeText(from: image) { [weak self] ocrResult in
      guard let ocrResult = ocrResult, !ocrResult.blocks.isEmpty else {
        // Fallback Gemini
        GeminiVisionService.shared.analyze(image: image) { geminiResult in
          guard let geminiResult = geminiResult else {
            reject("OCR_FAILED", "Échec de l'analyse OCR et Gemini", nil)
            return
          }
          let body: [String: Any] = [
            "platform": geminiResult.platform,
            "fare": geminiResult.fare,
            "distanceKm": geminiResult.distanceKm,
            "durationMin": geminiResult.durationMin as Any,
          ]
          resolve(body)
        }
        return
      }

      // Envoyer les blocs au JS pour parsing par ocrParser.ts
      let blocks = ocrResult.blocks.map { $0.toDictionary() }
      resolve([
        "blocks": blocks,
        "screenHeight": ocrResult.screenHeight,
      ])
    }
  }

  // MARK: - Local Notifications

  @objc func scheduleLocalNotification(_ identifier: String,
                                       title: String,
                                       body: String,
                                       delaySeconds: Double) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let trigger = delaySeconds > 0
      ? UNTimeIntervalNotificationTrigger(timeInterval: max(delaySeconds, 1), repeats: false)
      : nil

    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(request)
  }

  @objc func cancelLocalNotification(_ identifier: String) {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
  }
}

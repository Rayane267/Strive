import AppIntents
import UIKit
import UserNotifications
import ActivityKit

/// App Intent exposé à l'app Shortcuts — flow identique à Android :
///   1. OCR (Vision)
///   2. Parser identique (`OcrParser.swift` ↔ `OcrParser.kt`)
///   3. Live Activity démarrée immédiatement avec valeurs OCR provisoires
///   4. TomTom (geocode + routing) en background
///   5. Live Activity mise à jour avec valeurs TomTom (ou fallback OCR si KO)
///
/// L'intent tourne en arrière-plan — l'utilisateur configure son raccourci :
///   "Prendre une capture d'écran" → "Analyser une course avec Strive"
@available(iOS 16.2, *)
struct AnalyzeRideIntent: AppIntent {

  static var title: LocalizedStringResource = "Analyser une offre de course"
  static var description = IntentDescription(
    "Analyse une capture Uber / Bolt / Heetch et affiche la rentabilité dans la Dynamic Island."
  )

  static var openAppWhenRun: Bool = false

  @Parameter(title: "Capture d'écran")
  var screenshot: IntentFile

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    guard isScannerEnabled else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.scannerOff", fr: "Scanner désactivé — activez-le dans Strive › Préférences.", en: "Scanner disabled — enable it in Strive › Preferences.")
      )
      return .result(value: "scanner_off")
    }
    guard isSessionOnline else {
      sendLocalNotification(
        title: localizedString("notif.session.title", fr: "Session requise", en: "Session required"),
        body: localizedString("notif.session.body", fr: "Veuillez démarrer votre session dans Strive pour commencer à scanner.", en: "Please start your session in Strive to begin scanning.")
      )
      return .result(value: "session_off")
    }

    guard !isQuotaReached else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.quota", fr: "Quota journalier atteint — revenez demain ou achetez des crédits.", en: "Daily quota reached — come back tomorrow or buy credits.")
      )
      return .result(value: "quota_reached")
    }

    guard let image = UIImage(data: screenshot.data) else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.invalidImage", fr: "Image invalide — réessayez avec une capture d'écran.", en: "Invalid image — try again with a screenshot.")
      )
      return .result(value: "invalid_image")
    }

    // Anti double-tap (AssistiveTouch tapé 2-3 fois) : un scan déclenché < 3 s
    // après le précédent est ignoré SILENCIEUSEMENT → pas de quota consommé, pas
    // de course en double, pas de Live Activity parasite. Un re-scan délibéré
    // (plus tard) passe normalement.
    guard !ScanProcessor.shouldThrottleRapidScan() else {
      // Feedback léger plutôt qu'un drop muet : le 1ᵉ tap est déjà en cours de
      // traitement (sinon le testeur croit que « ça scanne mais rien ne s'affiche »).
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.tooSoon",
          fr: "Analyse déjà en cours — patiente une seconde.",
          en: "Analysis already running — hold on a second.")
      )
      return .result(value: "too_soon")
    }

    // Découplage pour minimiser le carré blanc « raccourci en cours » : l'OCR +
    // TomTom (et le fallback Gemini) tournent sous une activité de fond, et
    // `perform()` REND LA MAIN IMMÉDIATEMENT. L'indicateur système disparaît en
    // une fraction de seconde au lieu de rester 5-10 s (durée du pipeline). Le
    // résultat s'affiche seul, une seule fois, quand TomTom a fini — aucune
    // valeur provisoire n'est montrée.
    //
    // performExpiringActivity garde le process vivant (~qq secondes à ~30 s) le
    // temps du pipeline ; le sémaphore maintient l'assertion jusqu'au résultat.
    ProcessInfo.processInfo.performExpiringActivity(withReason: "StriveScanRefine") { expired in
      if expired { return }
      let sem = DispatchSemaphore(value: 0)
      ScanProcessor.shared.process(image: image) { finalResult in
        // Adresses présentes → on présente directement. Sinon (ou aucun
        // résultat) → fallback Gemini (récupère les 2 adresses → TomTom →
        // vraie distance/durée). Si Gemini échoue aussi → « scan échoué »
        // affiché DANS la Live Activity, et RIEN n'est enregistré.
        if let result = finalResult, self.hasBothAddresses(result) {
          _ = self.presentResult(result)
          sem.signal()
          return
        }
        self.geminiFallback(image: image) { recovered in
          if let recovered = recovered {
            _ = self.presentResult(recovered)
          } else {
            self.presentFailure()
          }
          sem.signal()
        }
      }
      // Borne l'attente (watchdog interne ScanProcessor = 20 s ; on laisse une
      // marge). Évite de tenir l'assertion de fond indéfiniment si un callback
      // ne revient jamais.
      _ = sem.wait(timeout: .now() + 25)
    }

    return .result(value: "started")
  }

  // MARK: - Présentation résultat / échec / fallback Gemini

  private func hasBothAddresses(_ result: ScanProcessor.FinalResult) -> Bool {
    let p = result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let d = result.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !p.isEmpty && !d.isEmpty
  }

  /// Affiche le résultat (Live Activity ou notif) + l'enregistre pour l'app.
  /// scanTs : clé de corrélation course ↔ décision (lastScanTimestamp + userInfo).
  private func presentResult(_ result: ScanProcessor.FinalResult) -> String {
    let scanTs = Date().timeIntervalSince1970
    // liveActivityReady (et pas useLiveActivity) : si la LA est coupée dans les
    // réglages, on tombe sur la notification résultat (avec Accepter/Refuser)
    // au lieu d'un affichage qui échouerait en silence.
    if liveActivityReady {
      LiveActivityManager.shared.update(
        platform: result.scan.platform.rawValue, fare: result.scan.fare,
        hourlyRate: result.hourlyRate, kmRate: result.kmRate,
        distanceKm: result.totalDistanceKm, durationMin: result.totalDurationMin,
        verdictLevel: result.verdictLevel, scanTs: scanTs
      )
    } else {
      let verdict = result.verdictLevel == 2 ? "✅" : result.verdictLevel == 1 ? "⚠️" : "❌"
      sendLocalNotification(
        title: "\(result.scan.platform.rawValue) · \(String(format: "%.0f€", result.scan.fare)) · \(verdict)",
        body: String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", result.hourlyRate, result.kmRate, result.totalDurationMin, result.totalDistanceKm),
        category: "STRIVE_SCAN_RESULT", scanTs: scanTs
      )
    }
    incrementScanCount()
    saveResultForMainApp(result, scanTs: scanTs)
    return String(
      format: "%@ · %.2f€ · %.0f€/h · %.2f€/km",
      result.scan.platform.rawValue, result.scan.fare, result.hourlyRate, result.kmRate
    )
  }

  /// « Scan échoué » : affiché DANS la Live Activity (ou notif si LA désactivée).
  /// Rien n'est enregistré → l'app ne reçoit aucun résultat à rejeter.
  private func presentFailure() {
    if liveActivityReady {
      LiveActivityManager.shared.showError()
    } else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.noRide", fr: "Aucune offre détectée — réessayez avec une autre capture.", en: "No ride offer detected — try again with another screenshot.")
      )
    }
  }

  /// Fallback Gemini (Niveau 2) — le chemin AssistiveTouch n'a pas d'OCR-fallback
  /// comme la Share Extension. Gemini récupère les 2 adresses → TomTom → vraie
  /// distance/durée. completion(nil) si ce n'est pas une offre / Gemini KO /
  /// adresses introuvables (→ scan échoué dans la Live Activity).
  private func geminiFallback(image: UIImage, completion: @escaping (ScanProcessor.FinalResult?) -> Void) {
    guard ScanProcessor.shared.lastScanMayBeRide else { completion(nil); return }
    let d = UserDefaults(suiteName: appGroupId)
    GeminiVisionService.shared.edgeFunctionUrl = d?.string(forKey: "geminiEdgeUrl")
    GeminiVisionService.shared.supabaseAnonKey = d?.string(forKey: "geminiSupabaseKey")
    GeminiVisionService.shared.apiKey = d?.string(forKey: "geminiApiKey")
    GeminiVisionService.shared.supabaseUserJwt = d?.string(forKey: "supabaseUserJwt")
    GeminiVisionService.shared.analyze(image: image) { gem in
      guard let gem = gem,
            let pickup = gem.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !pickup.isEmpty,
            let dest = gem.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !dest.isEmpty
      else { completion(nil); return }
      let base = ScanResultModel(
        platform: ScanPlatform(rawValue: gem.platform) ?? .UNKNOWN,
        fare: gem.fare, distanceKm: gem.distanceKm, durationMin: gem.durationMin,
        pickupAddress: pickup, destinationAddress: dest
      )
      guard TomTomService.shared.isReady else {
        completion(ScanProcessor.shared.computeFinal(scan: base)); return
      }
      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        var refined = base
        if let route = route, route.distanceKm >= 0.3, route.distanceKm <= 500, route.durationMin <= 300 {
          let r = gem.fare / route.distanceKm
          if r >= 0.2, r <= 12.0 {
            refined = base.copy(
              distanceKm: route.distanceKm, durationMin: route.durationMin,
              pickupAddress: route.pickupFormatted, destinationAddress: route.destFormatted
            )
          }
        }
        completion(ScanProcessor.shared.computeFinal(scan: refined))
      }
    }
  }

  // MARK: - Preference

  private var isSessionOnline: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)?.bool(forKey: "sessionOnline") ?? false
  }

  /// Scanner activé (toggle "Trip ID actif"). Défaut = activé si la clé est absente.
  private var isScannerEnabled: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let d = UserDefaults(suiteName: appGroupId)
    return d?.object(forKey: "scannerEnabled") == nil ? true : d!.bool(forKey: "scannerEnabled")
  }

  private var useLiveActivity: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let defaults = UserDefaults(suiteName: appGroupId)
    return defaults?.object(forKey: "useLiveActivity") == nil ? true : defaults!.bool(forKey: "useLiveActivity")
  }

  /// Live Activity réellement AFFICHABLE : préférence activée ET autorisation
  /// système ON (Réglages → Strive → Activités en direct). Si l'utilisateur l'a
  /// coupée, `Activity.request()` échoue en silence → la capture est prise, la
  /// course enregistrée, mais RIEN ne s'affiche (bug remonté par les testeurs).
  /// Dans ce cas on bascule sur une notification (résultat + échec).
  private var liveActivityReady: Bool {
    useLiveActivity && ActivityAuthorizationInfo().areActivitiesEnabled
  }

  private var appGroupId: String {
    (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String) ?? "group.com.striveapp.app"
  }

  /// Quota appliqué côté natif (compteur App Group poussé par le JS + incrémenté
  /// localement) OU flag JS — indépendant du JS suspendu pendant le scan.
  private var isQuotaReached: Bool {
    let d = UserDefaults(suiteName: appGroupId)
    if d?.bool(forKey: "scanQuotaReached") == true { return true }
    let isFree = (d?.object(forKey: "isFreeTier") as? Bool) ?? true
    guard isFree else { return false }
    let limit = d?.integer(forKey: "scanQuotaLimit") ?? 0
    if limit <= 0 { return false }
    guard let d = d else { return false }
    return Self.scanCountForToday(d) >= limit
  }

  /// Compteur du jour, en ignorant une valeur datée d'hier.
  private static func scanCountForToday(_ d: UserDefaults) -> Int {
    if d.integer(forKey: "scanCountDay") != currentQuotaDay(d) { return 0 }
    return d.integer(forKey: "scanCountToday")
  }

  /// Jour de quota (yyyymmdd) tenant compte du `quotaResetHour` (0 ou 4h).
  private static func currentQuotaDay(_ d: UserDefaults) -> Int {
    let resetHour = d.integer(forKey: "quotaResetHour")
    let shifted = Date().addingTimeInterval(TimeInterval(-resetHour * 3600))
    let c = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
    return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
  }

  private func incrementScanCount() {
    guard let d = UserDefaults(suiteName: appGroupId) else { return }
    let today = Self.currentQuotaDay(d)
    let base = d.integer(forKey: "scanCountDay") == today ? d.integer(forKey: "scanCountToday") : 0
    d.set(today, forKey: "scanCountDay")
    d.set(base + 1, forKey: "scanCountToday")
  }

  private func localizedString(_ key: String, fr: String, en: String) -> String {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let appLang = UserDefaults(suiteName: appGroupId)?.string(forKey: "appLanguage")
    let lang = appLang ?? Locale.current.language.languageCode?.identifier ?? "en"
    return lang.hasPrefix("fr") ? fr : en
  }

  private func sendLocalNotification(title: String, body: String, category: String? = nil, scanTs: Double? = nil) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    // Boutons Accepter/Refuser : la catégorie STRIVE_SCAN_RESULT est enregistrée
    // par l'app principale (AppDelegate). scanTs corrèle la décision à la course.
    if let category = category { content.categoryIdentifier = category }
    if let scanTs = scanTs { content.userInfo = ["scanTs": scanTs] }
    let request = UNNotificationRequest(identifier: "strive-scan-\(UUID().uuidString)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  // MARK: - App Group

  private func saveResultForMainApp(_ result: ScanProcessor.FinalResult, scanTs: Double) {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let defaults = UserDefaults(suiteName: appGroupId) else { return }

    var body: [String: Any] = [
      "platform": result.scan.platform.rawValue,
      "fare": result.scan.fare,
      "distanceKm": result.totalDistanceKm,
      "durationMin": result.totalDurationMin,
      "hourlyRate": result.hourlyRate,
      "kmRate": result.kmRate,
      "verdictLevel": result.verdictLevel,
      "scanTs": scanTs,
    ]
    if let pickup = result.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = result.scan.destinationAddress { body["destinationAddress"] = dest }

    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: "lastScanResult")
      defaults.set(scanTs, forKey: "lastScanTimestamp")

      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center,
        CFNotificationName("com.striveapp.app.scanResult" as CFString),
        nil, nil, true
      )
    }
  }
}

// MARK: - Commandes vocales « course prise / refusée » (Siri, mains libres)

/// Écrit la décision pour la DERNIÈRE course scannée (`lastScanTimestamp`) dans
/// l'App Group, prévient l'app (Darwin) pour la réconciliation JS, et fait
/// disparaître la carte résultat de la Live Activity. Mains libres → la seule
/// interaction réellement sûre en conduisant. Retourne false si aucune course récente.
/// Langue de l'app (App Group), pour localiser les réponses vocales de Siri.
private func striveIsFrench() -> Bool {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  let lang = UserDefaults(suiteName: appGroupId)?.string(forKey: "appLanguage")
    ?? Locale.current.languageCode ?? "en"
  return lang.hasPrefix("fr")
}

@available(iOS 16.0, *)
private func tagLastScannedRide(accepted: Bool) async -> Bool {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  guard let defaults = UserDefaults(suiteName: appGroupId) else { return false }
  let scanTs = defaults.double(forKey: "lastScanTimestamp")
  guard scanTs > 0 else { return false }

  // Incrément KPI du jour + retour à l'état de base, IMMÉDIAT et sans JS
  // (helpers partagés avec le bouton Live Activity).
  if #available(iOS 16.2, *) {
    let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
    await revertLiveActivityToIdle(addFare: add.fare, addKm: add.km)
  }
  appendRideDecision(scanTs: scanTs, accepted: accepted, appGroupId: appGroupId)
  return true
}

@available(iOS 16.0, *)
struct RideTakenVoiceIntent: AppIntent {
  static var title: LocalizedStringResource = "Course prise"
  static var description = IntentDescription("Marque la dernière course scannée comme prise.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let ok = await tagLastScannedRide(accepted: true)
    let fr = striveIsFrench()
    let dialog: IntentDialog = ok
      ? (fr ? "C'est noté, course prise." : "Got it, ride marked as taken.")
      : (fr ? "Aucune course récente à marquer." : "No recent ride to mark.")
    return .result(dialog: dialog)
  }
}

@available(iOS 16.0, *)
struct RideDeclinedVoiceIntent: AppIntent {
  static var title: LocalizedStringResource = "Course refusée"
  static var description = IntentDescription("Marque la dernière course scannée comme refusée.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let ok = await tagLastScannedRide(accepted: false)
    let fr = striveIsFrench()
    let dialog: IntentDialog = ok
      ? (fr ? "C'est noté, course refusée." : "Got it, ride marked as declined.")
      : (fr ? "Aucune course récente à marquer." : "No recent ride to mark.")
    return .result(dialog: dialog)
  }
}

@available(iOS 16.2, *)
struct StriveAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AnalyzeRideIntent(),
      phrases: [
        "Analyser une course avec \(.applicationName)",
        "\(.applicationName) analyse cette capture",
      ],
      shortTitle: "Analyser une course",
      systemImageName: "car.fill"
    )
    AppShortcut(
      intent: RideTakenVoiceIntent(),
      phrases: [
        "Course prise avec \(.applicationName)",
        "\(.applicationName) course prise",
        "Ride taken with \(.applicationName)",
        "\(.applicationName) ride taken",
      ],
      shortTitle: "Course prise",
      systemImageName: "checkmark.circle.fill"
    )
    AppShortcut(
      intent: RideDeclinedVoiceIntent(),
      phrases: [
        "Course refusée avec \(.applicationName)",
        "\(.applicationName) course refusée",
        "Ride declined with \(.applicationName)",
        "\(.applicationName) ride declined",
      ],
      shortTitle: "Course refusée",
      systemImageName: "xmark.circle.fill"
    )
  }
}

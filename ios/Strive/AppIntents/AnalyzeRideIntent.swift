import AppIntents
import UIKit
import UserNotifications

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

  /// Hard deadline global du Shortcut. Si Vision deadlock ou TomTom hang
  /// au-delà de leur propre timeout interne, on libère quand même le Shortcut.
  private static let overallTimeoutNs: UInt64 = 15_000_000_000

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
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

    let summary: String = await withTaskGroup(of: String?.self) { group in
      group.addTask {
        await withCheckedContinuation { cont in
          ScanProcessor.shared.process(image: image) { finalResult in
            guard let result = finalResult else {
              if self.useLiveActivity {
                LiveActivityManager.shared.showError()
              } else {
                self.sendLocalNotification(
                  title: "Strive",
                  body: self.localizedString("notif.noRide", fr: "Aucune offre détectée — réessayez avec une autre capture.", en: "No ride offer detected — try again with another screenshot.")
                )
              }
              cont.resume(returning: nil)
              return
            }
            if self.useLiveActivity {
              LiveActivityManager.shared.update(
                platform: result.scan.platform.rawValue,
                fare: result.scan.fare,
                hourlyRate: result.hourlyRate,
                kmRate: result.kmRate,
                distanceKm: result.totalDistanceKm,
                durationMin: result.totalDurationMin,
                verdictLevel: result.verdictLevel
              )
            } else {
              let verdict = result.verdictLevel == 2 ? "✅" : result.verdictLevel == 1 ? "⚠️" : "❌"
              self.sendLocalNotification(
                title: "\(result.scan.platform.rawValue) · \(String(format: "%.0f€", result.scan.fare)) · \(verdict)",
                body: String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", result.hourlyRate, result.kmRate, result.totalDurationMin, result.totalDistanceKm)
              )
            }

            self.saveResultForMainApp(result)

            let line = String(
              format: "%@ · %.2f€ · %.0f€/h · %.2f€/km",
              result.scan.platform.rawValue, result.scan.fare,
              result.hourlyRate, result.kmRate
            )
            cont.resume(returning: line)
          }
        }
      }
      group.addTask {
        try? await Task.sleep(nanoseconds: Self.overallTimeoutNs)
        return nil
      }
      var result: String? = nil
      for await value in group {
        if let v = value { result = v; group.cancelAll(); break }
      }
      if result == nil {
        group.cancelAll()
        self.sendLocalNotification(
          title: "Strive",
          body: self.localizedString("notif.timeout", fr: "Analyse trop longue — réessayez.", en: "Analysis took too long — try again.")
        )
      }
      return result ?? "no_result"
    }

    return .result(value: summary)
  }

  // MARK: - Preference

  private var isSessionOnline: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)?.bool(forKey: "sessionOnline") ?? false
  }

  private var useLiveActivity: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)?.bool(forKey: "useLiveActivity") ?? true
  }

  private var isQuotaReached: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)?.bool(forKey: "scanQuotaReached") ?? false
  }

  private func localizedString(_ key: String, fr: String, en: String) -> String {
    let lang = Locale.current.language.languageCode?.identifier ?? "en"
    return lang == "fr" ? fr : en
  }

  private func sendLocalNotification(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(identifier: "strive-scan-\(UUID().uuidString)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  // MARK: - App Group

  private func saveResultForMainApp(_ result: ScanProcessor.FinalResult) {
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
    ]
    if let pickup = result.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = result.scan.destinationAddress { body["destinationAddress"] = dest }

    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: "lastScanResult")
      defaults.set(Date().timeIntervalSince1970, forKey: "lastScanTimestamp")

      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center,
        CFNotificationName("com.striveapp.app.scanResult" as CFString),
        nil, nil, true
      )
    }
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
  }
}

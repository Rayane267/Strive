import AppIntents
import UIKit

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
    guard let image = UIImage(data: screenshot.data) else {
      throw IntentError.invalidImage
    }

    // Pipeline complet via ScanProcessor (OCR + parsing identique Android +
    // TomTom). On enchaîne les deux callbacks (provisoire puis final) sur la
    // Live Activity pour donner le feedback immédiat. Wrappé dans un TaskGroup
    // qui race contre un timeout global pour ne jamais hang le Shortcut.
    let summary: String = try await withThrowingTaskGroup(of: String.self) { group in
      group.addTask {
        try await withCheckedThrowingContinuation { cont in
          ScanProcessor.shared.process(
            image: image,
            onProvisional: { provisional in
              // 1. Démarre la Live Activity avec les valeurs OCR.
              LiveActivityManager.shared.start(
                platform: provisional.scan.platform.rawValue,
                fare: provisional.scan.fare,
                hourlyRate: provisional.hourlyRate,
                kmRate: provisional.kmRate,
                distanceKm: provisional.totalDistanceKm,
                durationMin: provisional.totalDurationMin,
                verdictLevel: provisional.verdictLevel
              )
            },
            onFinal: { finalResult in
              guard let result = finalResult else {
                cont.resume(throwing: IntentError.noRideDetected)
                return
              }
              // 2. Update avec les valeurs TomTom (ou identiques si fallback OCR).
              LiveActivityManager.shared.update(
                platform: result.scan.platform.rawValue,
                fare: result.scan.fare,
                hourlyRate: result.hourlyRate,
                kmRate: result.kmRate,
                distanceKm: result.totalDistanceKm,
                durationMin: result.totalDurationMin,
                verdictLevel: result.verdictLevel
              )

              // 3. Persiste pour que l'app principale picke le résultat.
              self.saveResultForMainApp(result)

              let line = String(
                format: "%@ · %.2f€ · %.0f€/h · %.2f€/km",
                result.scan.platform.rawValue, result.scan.fare,
                result.hourlyRate, result.kmRate
              )
              cont.resume(returning: line)
            }
          )
        }
      }
      group.addTask {
        try await Task.sleep(nanoseconds: Self.overallTimeoutNs)
        throw IntentError.timeout
      }
      defer { group.cancelAll() }
      guard let first = try await group.next() else {
        throw IntentError.noRideDetected
      }
      return first
    }

    return .result(value: summary)
  }

  // MARK: - Errors

  enum IntentError: Error, LocalizedError {
    case invalidImage, noRideDetected, timeout
    var errorDescription: String? {
      switch self {
      case .invalidImage: return "Image invalide"
      case .noRideDetected: return "Aucune offre de course détectée"
      case .timeout: return "Analyse trop longue, réessayez"
      }
    }
  }

  // MARK: - App Group

  private func saveResultForMainApp(_ result: ScanProcessor.FinalResult) {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.strive.app"
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
        CFNotificationName("com.strive.app.scanResult" as CFString),
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

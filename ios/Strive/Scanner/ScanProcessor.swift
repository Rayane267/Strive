import UIKit
import Vision

/// Orchestre l'analyse complète d'un screenshot — mirror du `triggerScan` →
/// `runOcr` → `resolveTomTomAndEmit` côté Android (FloatingBubbleService.kt).
///
/// Flow identique :
///  1. Vision OCR → blocs
///  2. OcrParser.parse → ScanResult provisoire (avec adresses)
///  3. Live Activity démarrée immédiatement avec valeurs OCR
///  4. TomTom (geocode + routing) en background
///  5. Live Activity mise à jour avec valeurs TomTom + verdict final
///  6. Si TomTom échoue → on garde les valeurs OCR (fallback identique Android)
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.
final class ScanProcessor {

  static let shared = ScanProcessor()
  private init() {}

  private var scanInProgress = false

  /// Anti double-tap CROSS-PROCESS : refuse un scan déclenché moins de
  /// `cooldownSec` après le précédent. `scanInProgress` ne suffit pas car chaque
  /// scan (AppIntent AssistiveTouch / Share Extension) tourne dans SON process —
  /// le flag n'est pas partagé. On sérialise via un horodatage dans l'App Group.
  /// Renvoie true s'il faut IGNORER ce scan (quota préservé, pas de doublon).
  static func shouldThrottleRapidScan(cooldownSec: Double = 3.0) -> Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let defaults = UserDefaults(suiteName: appGroupId) else { return false }
    let now = Date().timeIntervalSince1970
    let last = defaults.double(forKey: "lastScanAttemptAt")
    if last > 0, now - last < cooldownSec { return true }
    defaults.set(now, forKey: "lastScanAttemptAt")
    return false
  }

  /// Vrai si le dernier OCR justifie un appel Gemini (signaux d'offre de course
  /// détectés, OU aucun texte lu = bénéfice du doute). Faux uniquement quand
  /// l'OCR a lu du texte mais sans aucun signal VTC (pub / écran quelconque) →
  /// les callers évitent alors un appel Gemini payant inutile.
  private(set) var lastScanMayBeRide = true

  struct FinalResult {
    let scan: ScanResultModel
    let hourlyRate: Double
    let kmRate: Double
    let totalDurationMin: Int
    let totalDistanceKm: Double
    let verdictLevel: Int
  }

  /// Lance le pipeline complet sur l'image. Le callback `onFinal` n'est appelé
  /// qu'UNE seule fois, avec le résultat final (TomTom OK, fallback OCR, ou nil
  /// si OCR n'a rien trouvé). Le caller n'a pas à gérer d'état provisoire — la
  /// bulle/Live Activity reste en loading jusqu'à cet appel.
  func process(
    image: UIImage,
    onFinal: @escaping (FinalResult?) -> Void
  ) {
    guard !scanInProgress else {
      NSLog("[Strive:Scan] scan already in progress — skipped")
      onFinal(nil)
      return
    }
    scanInProgress = true

    // Garde-fou anti-deadlock : `gate` garantit (1) un seul appel à onFinal,
    // (2) le reset systématique de scanInProgress, (3) un watchdog qui libère
    // le scanner même si Vision/TomTom ne rend jamais la main (sinon le flag
    // restait `true` à vie → tous les scans suivants ignorés jusqu'au reboot).
    let gate = CompletionGuard { [weak self] result in
      self?.scanInProgress = false
      onFinal(result)
    }
    let watchdog = DispatchWorkItem { gate.fire(nil) }
    gate.watchdog = watchdog
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 20, execute: watchdog)

    runOcr(image: image) { [weak self] blocks, screenW, screenH in
      guard let self = self else { gate.fire(nil); return }
      guard let blocks = blocks else {
        // Aucun texte lu : on laisse Gemini tenter sur l'image (bénéfice du doute).
        self.lastScanMayBeRide = true
        gate.fire(nil); return
      }

      // Pré-filtre anti-pub : du texte a été lu — ressemble-t-il à une course ?
      self.lastScanMayBeRide = Self.looksLikeRideOffer(
        blocks.map { $0.text }.joined(separator: "\n")
      )

      // Parsing identique à Android
      guard let result = OcrParser.shared.parse(
        blocks: blocks, screenWidth: screenW, screenHeight: screenH, image: image
      ) else {
        gate.fire(nil); return
      }

      // TomTom — uniquement si on a 2 adresses et la clé est configurée
      let pickup = result.pickupAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let dest = result.destinationAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if pickup.isEmpty || dest.isEmpty || !TomTomService.shared.isReady {
        gate.fire(self.computeFinal(scan: result))
        return
      }

      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        guard let route = route,
              route.distanceKm >= 0.3,
              route.distanceKm <= 500,
              route.durationMin <= 300 else {
          gate.fire(self.computeFinal(scan: result))
          return
        }

        let ratio = result.fare / route.distanceKm
        guard ratio >= 0.2 && ratio <= 12.0 else {
          gate.fire(self.computeFinal(scan: result))
          return
        }

        // Affiche les adresses canoniques TomTom (propres) plutôt que le texte
        // OCR bruité (ex: "All AV. … Çueue") — fallback OCR si TomTom n'en fournit pas.
        let updated = result.copy(
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          pickupAddress: route.pickupFormatted,
          destinationAddress: route.destFormatted
        )
        gate.fire(self.computeFinal(scan: updated))
      }
    }
  }

  /// Heuristique légère exécutée sur le texte OCR brut : l'écran ressemble-t-il
  /// à une offre VTC ? Sert à court-circuiter le fallback Gemini (coût) quand
  /// l'utilisateur scanne une pub ou un écran sans rapport.
  /// Permissive volontairement : un faux positif coûte un appel Gemini, un faux
  /// négatif fait rater une course → on privilégie de laisser passer.
  static func looksLikeRideOffer(_ rawText: String) -> Bool {
    let text = rawText.lowercased()
    let hasPlatform = text.contains("uber") || text.contains("bolt") || text.contains("heetch")
    // Mots-clés FR + EN (l'app et les apps VTC peuvent être dans les 2 langues).
    let hasRideWords = [
      // FR
      "course", "trajet", "prise en charge", "dépose", "gains", "accepter", "min de marche",
      // EN
      "trip", "ride", "pickup", "pick-up", "drop-off", "dropoff", "earnings", "accept", "min walk",
    ].contains { text.contains($0) }
    let hasPrice = text.range(of: #"\d{1,3}[.,]\d{2}\s*€"#, options: .regularExpression) != nil
      || text.range(of: #"€\s*\d"#, options: .regularExpression) != nil
    let hasKm = text.range(of: #"\d[\d.,]*\s*km"#, options: .regularExpression) != nil
    let hasMin = text.range(of: #"\d+\s*min"#, options: .regularExpression) != nil
    return hasPlatform || hasRideWords || (hasPrice && (hasKm || hasMin))
  }

  /// Fallback durée quand l'OCR n'a pas pu lire le `min` de la course.
  /// Heuristique vitesse moyenne par tranche de distance — calibration FR/EU.
  /// À garder en sync avec `FloatingBubbleService.kt::estimateDurationMin`
  /// et `DashboardScreen.tsx::estimateDurationMin`.
  private static func estimateDurationMin(distanceKm: Double) -> Double {
    switch distanceKm {
    case ..<5:  return distanceKm / 25.0 * 60.0   // urbain dense
    case ..<20: return distanceKm / 45.0 * 60.0   // mixte ville/péri
    default:    return distanceKm / 60.0 * 60.0   // péri-urbain / autoroute
    }
  }

  // MARK: - Calcul rentabilité + verdict (identique Android)

  /// Exposé (non-private) pour permettre au fallback Gemini de l'AppIntent de
  /// construire un FinalResult à partir d'un ScanResultModel reconstitué.
  func computeFinal(scan: ScanResultModel) -> FinalResult {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let prefs = UserDefaults(suiteName: appGroupId)
    let minHourly = prefs?.double(forKey: "minHourlyRate") ?? 25.0
    let minKm = prefs?.double(forKey: "minKmRate") ?? 1.2
    let includePickup = prefs?.object(forKey: "includePickup") as? Bool ?? true

    let useApproach = includePickup
      && scan.pickupDurationMin != nil
      && scan.pickupDistanceKm != nil

    // courseDuration : OCR ou estimé via heuristique vitesse selon distance
    // (cf. estimateDurationMin — calibration FR/EU urbain/mixte/autoroute).
    let courseDuration = scan.durationMin.map { Double($0) }
      ?? Self.estimateDurationMin(distanceKm: scan.distanceKm)

    let totalDuration = useApproach
      ? courseDuration + Double(scan.pickupDurationMin ?? 0)
      : courseDuration

    let totalDistance = useApproach
      ? scan.distanceKm + (scan.pickupDistanceKm ?? 0)
      : scan.distanceKm

    let hourlyRate = totalDuration > 0 ? scan.fare / (totalDuration / 60.0) : 0
    let kmRate = totalDistance > 0 ? scan.fare / totalDistance : 0

    let hrOk = hourlyRate >= minHourly
    let kmOk = kmRate >= minKm
    let level = (hrOk && kmOk) ? 2 : ((hrOk || kmOk) ? 1 : 0)

    return FinalResult(
      scan: scan,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      totalDurationMin: Int(totalDuration.rounded()),
      totalDistanceKm: totalDistance,
      verdictLevel: level
    )
  }

  // MARK: - Vision OCR

  private func runOcr(
    image: UIImage,
    completion: @escaping ([OcrTextBlock]?, Int, Int) -> Void
  ) {
    guard let cgImage = image.cgImage else { completion(nil, 0, 0); return }
    let imageWidth = Int(cgImage.width)
    let imageHeight = Int(cgImage.height)

    let request = VNRecognizeTextRequest { req, _ in
      guard let observations = req.results as? [VNRecognizedTextObservation], !observations.isEmpty else {
        completion(nil, imageWidth, imageHeight); return
      }

      // Convertit chaque observation en OcrTextBlock avec bbox absolu top-left.
      // Vision : bbox normalisé [0;1], origin bottom-left → on flip Y.
      var blocks: [OcrTextBlock] = []
      for obs in observations {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }
        // Levier 2 : on jette le bruit OCR très basse confiance (< 0.3). En mode
        // .accurate, Vision score >0.5 pour du vrai texte d'écran ; sous 0.3 =
        // artefact illisible. Seuil volontairement TRÈS bas pour ne jamais
        // risquer d'évincer une vraie adresse — on coupe juste le bruit franc.
        if candidate.confidence < 0.3 { continue }
        let bbox = obs.boundingBox
        let left = Int(bbox.origin.x * CGFloat(imageWidth))
        let width = Int(bbox.width * CGFloat(imageWidth))
        let height = Int(bbox.height * CGFloat(imageHeight))
        let topNormalized = 1.0 - bbox.origin.y - bbox.height
        let top = Int(topNormalized * CGFloat(imageHeight))
        blocks.append(OcrTextBlock(
          text: text,
          box: OcrRect(left: left, top: top, right: left + width, bottom: top + height),
          confidence: candidate.confidence
        ))
      }
      completion(blocks, imageWidth, imageHeight)
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["fr-FR", "en-US"]
    request.usesLanguageCorrection = true

    DispatchQueue.global(qos: .userInitiated).async {
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do {
        try handler.perform([request])
      } catch {
        // perform() qui throw n'invoque PAS le completion du request → on doit
        // le rappeler manuellement, sinon scanInProgress resterait bloqué.
        completion(nil, imageWidth, imageHeight)
      }
    }
  }
}

/// Garantit qu'un callback n'est invoqué qu'UNE seule fois (thread-safe) et
/// annule le watchdog associé. Utilisé par ScanProcessor pour éviter les
/// double-callbacks (Vision + watchdog + TomTom) et le deadlock de scanInProgress.
private final class CompletionGuard {
  private var fired = false
  private let lock = NSLock()
  private let body: (ScanProcessor.FinalResult?) -> Void
  var watchdog: DispatchWorkItem?

  init(_ body: @escaping (ScanProcessor.FinalResult?) -> Void) {
    self.body = body
  }

  func fire(_ result: ScanProcessor.FinalResult?) {
    lock.lock()
    if fired { lock.unlock(); return }
    fired = true
    lock.unlock()
    watchdog?.cancel()
    body(result)
  }
}

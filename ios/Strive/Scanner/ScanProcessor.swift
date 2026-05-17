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

  /// Résultat final remonté au caller (AppIntent / ShareExtension) après
  /// tout le pipeline. Utilisé pour persistance App Group + retour Shortcut.
  struct FinalResult {
    let scan: ScanResultModel
    let hourlyRate: Double
    let kmRate: Double
    let totalDurationMin: Int
    let totalDistanceKm: Double
    let verdictLevel: Int
  }

  /// Lance le pipeline complet sur l'image. Le callback `onProvisional` est
  /// appelé dès que l'OCR a renvoyé un résultat (avant TomTom). Le callback
  /// `onFinal` est appelé après TomTom (ou immédiatement si pas d'adresses).
  func process(
    image: UIImage,
    onProvisional: @escaping (FinalResult) -> Void,
    onFinal: @escaping (FinalResult?) -> Void
  ) {
    runOcr(image: image) { [weak self] blocks, screenW, screenH in
      guard let self = self else { onFinal(nil); return }
      guard let blocks = blocks else { onFinal(nil); return }

      // Parsing identique à Android
      guard let result = OcrParser.shared.parse(
        blocks: blocks, screenWidth: screenW, screenHeight: screenH
      ) else {
        onFinal(nil); return
      }

      // 1. Calcul provisoire avec valeurs OCR (incl. pickup add-on si activé)
      let provisional = self.computeFinal(scan: result)
      onProvisional(provisional)

      // 2. TomTom — uniquement si on a 2 adresses et la clé est configurée
      let pickup = result.pickupAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let dest = result.destinationAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if pickup.isEmpty || dest.isEmpty || !TomTomService.shared.isReady {
        onFinal(provisional)
        return
      }

      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        guard let route = route, route.distanceKm >= 0.3, route.distanceKm <= 1000 else {
          // Fallback OCR — exactement comme Android
          onFinal(provisional)
          return
        }

        // Override OCR distance/duration avec valeurs TomTom
        let updated = result.copy(distanceKm: route.distanceKm, durationMin: route.durationMin)
        let final = self.computeFinal(scan: updated)
        onFinal(final)
      }
    }
  }

  // MARK: - Calcul rentabilité + verdict (identique Android)

  private func computeFinal(scan: ScanResultModel) -> FinalResult {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.strive.app"
    let prefs = UserDefaults(suiteName: appGroupId)
    let minHourly = prefs?.double(forKey: "minHourlyRate") ?? 25.0
    let minKm = prefs?.double(forKey: "minKmRate") ?? 1.2
    let includePickup = prefs?.bool(forKey: "includePickup") ?? false

    let useApproach = includePickup
      && scan.pickupDurationMin != nil
      && scan.pickupDistanceKm != nil

    // courseDuration : OCR ou estimé à partir de la distance (25 km/h moyenne ville)
    let courseDuration = scan.durationMin.map { Double($0) }
      ?? (scan.distanceKm / 25.0 * 60.0)

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
        let bbox = obs.boundingBox
        let left = Int(bbox.origin.x * CGFloat(imageWidth))
        let width = Int(bbox.width * CGFloat(imageWidth))
        let height = Int(bbox.height * CGFloat(imageHeight))
        let topNormalized = 1.0 - bbox.origin.y - bbox.height
        let top = Int(topNormalized * CGFloat(imageHeight))
        blocks.append(OcrTextBlock(
          text: text,
          box: OcrRect(left: left, top: top, right: left + width, bottom: top + height)
        ))
      }
      completion(blocks, imageWidth, imageHeight)
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["fr-FR", "en-US"]
    request.usesLanguageCorrection = true

    DispatchQueue.global(qos: .userInitiated).async {
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      try? handler.perform([request])
    }
  }
}

import Vision
import UIKit

/// Bloc texte retourné au JS — même structure que ML Kit sur Android
struct OCRTextBlock {
  let text: String
  let width: CGFloat
  let height: CGFloat
  let x: CGFloat
  let y: CGFloat

  func toDictionary() -> [String: Any] {
    return [
      "text": text,
      "width": width,
      "height": height,
      "x": x,
      "y": y,
    ]
  }
}

struct OCRResult {
  let blocks: [OCRTextBlock]
  let screenHeight: CGFloat
}

/// Service OCR utilisant le framework Vision d'Apple (on-device, pas de réseau)
final class VisionOCRService {

  static let shared = VisionOCRService()
  private init() {}

  /// Extrait les blocs texte d'une image via Vision framework
  func recognizeText(
    from image: UIImage,
    completion: @escaping (OCRResult?) -> Void
  ) {
    guard let cgImage = image.cgImage else {
      completion(nil)
      return
    }

    let imageWidth = CGFloat(cgImage.width)
    let imageHeight = CGFloat(cgImage.height)

    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation],
            !observations.isEmpty
      else {
        DispatchQueue.main.async { completion(nil) }
        return
      }

      var blocks: [OCRTextBlock] = []

      for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }

        // Vision renvoie des coordonnées normalisées (0-1), origine en bas-gauche
        // On convertit en pixels avec origine en haut-gauche (comme Android)
        let boundingBox = observation.boundingBox
        let x = boundingBox.origin.x * imageWidth
        let y = (1 - boundingBox.origin.y - boundingBox.height) * imageHeight
        let w = boundingBox.width * imageWidth
        let h = boundingBox.height * imageHeight

        blocks.append(OCRTextBlock(
          text: text,
          width: w,
          height: h,
          x: x,
          y: y
        ))
      }

      let result = OCRResult(blocks: blocks, screenHeight: imageHeight)
      DispatchQueue.main.async { completion(result) }
    }

    // Configuration OCR
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["fr-FR", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try handler.perform([request])
      } catch {
        DispatchQueue.main.async { completion(nil) }
      }
    }
  }

  /// Version synchrone pour la Share Extension (déjà sur background thread)
  func recognizeTextSync(from image: UIImage) -> OCRResult? {
    guard let cgImage = image.cgImage else { return nil }

    let imageWidth = CGFloat(cgImage.width)
    let imageHeight = CGFloat(cgImage.height)

    let semaphore = DispatchSemaphore(value: 0)
    var result: OCRResult?

    let request = VNRecognizeTextRequest { request, error in
      defer { semaphore.signal() }
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation],
            !observations.isEmpty
      else { return }

      var blocks: [OCRTextBlock] = []
      for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }

        let boundingBox = observation.boundingBox
        let x = boundingBox.origin.x * imageWidth
        let y = (1 - boundingBox.origin.y - boundingBox.height) * imageHeight
        let w = boundingBox.width * imageWidth
        let h = boundingBox.height * imageHeight

        blocks.append(OCRTextBlock(text: text, width: w, height: h, x: x, y: y))
      }

      result = OCRResult(blocks: blocks, screenHeight: imageHeight)
    }

    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["fr-FR", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    // Si perform() throw, la closure (et son defer { semaphore.signal() }) n'est
    // JAMAIS appelée → on doit signaler manuellement, sinon wait() bloque le
    // thread à vie (deadlock + fuite de thread sur images répétées/corrompues).
    do {
      try handler.perform([request])
    } catch {
      semaphore.signal()
    }
    // Garde-fou supplémentaire : timeout dur au cas où Vision ne rendrait jamais
    // la main (jamais observé, mais évite tout blocage définitif du contexte).
    _ = semaphore.wait(timeout: .now() + 15)

    return result
  }
}

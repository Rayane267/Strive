import Foundation
import CoreGraphics

/// Modèles partagés iOS/Android. Reproduit la structure Kotlin de
/// `OcrParser.ScanResult`, `OcrParser.Platform`, et le bounding box ML Kit.
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.

public enum ScanPlatform: String {
  case UBER, BOLT, HEETCH, UNKNOWN
}

/// Code affiché à l'utilisateur quand un scan échoue, pour qu'il puisse le citer
/// dans un ticket de support.
///
/// Chaque code correspond EXACTEMENT à un motif de `ScanFailureReason` (TS) et à
/// la colonne `scan_failures.reason` — ce qu'un chauffeur rapporte est donc
/// directement croisable avec la télémétrie. Particulièrement utile pour la
/// Share Extension, qui affiche des erreurs mais n'écrit rien dans
/// `scan_failures` : le code est alors le SEUL canal de remontée.
///
/// ⚠️ Contrat public : ces valeurs apparaissent dans l'historique de support.
/// Ne jamais réaffecter un code existant à un autre motif — ajouter à la suite.
/// Codes OPAQUES au format hexadécimal, délibérément non déchiffrables par
/// l'utilisateur : le message affiché explique le problème en clair, le code
/// n'est qu'une référence de support et ne révèle rien du fonctionnement interne.
///
/// Format `0xC0FEnnnn` — préfixe de « facility » fixe (identifie un code Strive
/// au premier coup d'œil dans un ticket), puis 4 chiffres hexadécimaux propres à
/// chaque motif. L'hexadécimal n'utilise que 0-9 et A-F : aucune confusion
/// possible entre O et 0, ni entre I/L et 1, à la recopie.
public enum ScanErrorCode: String {
  case scannerOff     = "0xC0FE0113"
  case sessionOff     = "0xC0FE0207"
  case quotaReached   = "0xC0FE0342"
  case invalidImage   = "0xC0FE0418"
  case throttled      = "0xC0FE0526"
  case ocrEmpty       = "0xC0FE0631"
  case noAddresses    = "0xC0FE074B"
  case notARide       = "0xC0FE0859"
  case geminiKo       = "0xC0FE0962"
  case laStartFailed  = "0xC0FE0A7D"
  case expired        = "0xC0FE0B34"
  case timeout        = "0xC0FE0C55"

  /// Motif correspondant côté `scan_failures.reason` — garde le lien explicite
  /// entre ce que voit l'utilisateur et ce que mesure la télémétrie.
  public var reason: String {
    switch self {
    case .scannerOff:    return "scanner_off"
    case .sessionOff:    return "session_off"
    case .quotaReached:  return "quota_reached"
    case .invalidImage:  return "invalid_image"
    case .throttled:     return "throttled"
    case .ocrEmpty:      return "ocr_empty"
    case .noAddresses:   return "no_addresses"
    case .notARide:      return "not_a_ride"
    case .geminiKo:      return "gemini_ko"
    case .laStartFailed: return "la_start_failed"
    case .expired:       return "expired"
    case .timeout:       return "timeout"
    }
  }
}

public struct ScanResultModel {
  public let platform: ScanPlatform
  public let fare: Double
  public let distanceKm: Double
  public let durationMin: Int?
  public let pickupAddress: String?
  public let destinationAddress: String?
  public let pickupDurationMin: Int?
  public let pickupDistanceKm: Double?

  public init(
    platform: ScanPlatform,
    fare: Double,
    distanceKm: Double,
    durationMin: Int? = nil,
    pickupAddress: String? = nil,
    destinationAddress: String? = nil,
    pickupDurationMin: Int? = nil,
    pickupDistanceKm: Double? = nil
  ) {
    self.platform = platform
    self.fare = fare
    self.distanceKm = distanceKm
    self.durationMin = durationMin
    self.pickupAddress = pickupAddress
    self.destinationAddress = destinationAddress
    self.pickupDurationMin = pickupDurationMin
    self.pickupDistanceKm = pickupDistanceKm
  }

  func copy(
    distanceKm: Double? = nil,
    durationMin: Int? = nil,
    pickupAddress: String? = nil,
    destinationAddress: String? = nil
  ) -> ScanResultModel {
    return ScanResultModel(
      platform: self.platform,
      fare: self.fare,
      distanceKm: distanceKm ?? self.distanceKm,
      durationMin: durationMin ?? self.durationMin,
      pickupAddress: pickupAddress ?? self.pickupAddress,
      destinationAddress: destinationAddress ?? self.destinationAddress,
      pickupDurationMin: self.pickupDurationMin,
      pickupDistanceKm: self.pickupDistanceKm
    )
  }
}

/// Bloc de texte avec bounding box absolu en pixels (origine top-left), même
/// convention que l'API Android `Text.TextBlock`. Côté iOS Vision, on convertit
/// les bbox normalisés (0-1, origin bottom-left) avant d'instancier.
public struct OcrTextBlock {
  public let text: String
  public let box: OcrRect
  /// Confiance OCR de la ligne (0–1). Vision la fournit par observation ; on la
  /// porte ici pour servir de tie-breaker aux heuristiques d'adresse (leviers
  /// géométrie / multi-candidats). Défaut 1.0 = appelants qui ne la fournissent
  /// pas (legacy) non impactés.
  public let confidence: Float

  public init(text: String, box: OcrRect, confidence: Float = 1.0) {
    self.text = text
    self.box = box
    self.confidence = confidence
  }
}

public struct OcrRect {
  public let left: Int
  public let top: Int
  public let right: Int
  public let bottom: Int

  public var width: Int { right - left }
  public var height: Int { bottom - top }
  public var centerX: Int { (left + right) / 2 }
  public var centerY: Int { (top + bottom) / 2 }

  public init(left: Int, top: Int, right: Int, bottom: Int) {
    self.left = left
    self.top = top
    self.right = right
    self.bottom = bottom
  }
}

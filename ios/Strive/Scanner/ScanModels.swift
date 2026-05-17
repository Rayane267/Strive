import Foundation
import CoreGraphics

/// Modèles partagés iOS/Android. Reproduit la structure Kotlin de
/// `OcrParser.ScanResult`, `OcrParser.Platform`, et le bounding box ML Kit.
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.

public enum ScanPlatform: String {
  case UBER, BOLT, HEETCH, UNKNOWN
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

  func copy(distanceKm: Double? = nil, durationMin: Int? = nil) -> ScanResultModel {
    return ScanResultModel(
      platform: self.platform,
      fare: self.fare,
      distanceKm: distanceKm ?? self.distanceKm,
      durationMin: durationMin ?? self.durationMin,
      pickupAddress: self.pickupAddress,
      destinationAddress: self.destinationAddress,
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

  public init(text: String, box: OcrRect) {
    self.text = text
    self.box = box
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

import Foundation
import ActivityKit

/// Attributs Live Activity Strive — partagés entre l'app principale et la
/// Widget Extension (cible `StriveWidget`).
///
/// IMPORTANT (Xcode) : ce fichier DOIT avoir Target Membership coché à la fois
/// pour `Strive` et pour `StriveWidget`, sinon les vues de la Live Activity ne
/// pourront pas instancier `StriveActivityAttributes`.
@available(iOS 16.2, *)
public struct StriveActivityAttributes: ActivityAttributes {

  public typealias ContentState = State

  /// Données mutables affichées dans la Dynamic Island / Lock Screen.
  /// Mise à jour via `Activity.update(...)` quand TomTom répond après l'OCR.
  public struct State: Codable, Hashable {
    public let platform: String     // UBER, BOLT, HEETCH, SCANNING, IDLE, ERROR
    public let fare: Double         // €
    public let hourlyRate: Double   // €/h
    public let kmRate: Double       // €/km
    public let distanceKm: Double
    public let durationMin: Int
    /// 0 = rouge (refuse), 1 = orange (limite), 2 = vert (accepte)
    public let verdictLevel: Int

    // KPI session (Lock Screen)
    public let todayEarnings: Double
    public let todayHourlyRate: Double
    public let todayKm: Double
    public let onlineMinutes: Int

    public init(
      platform: String,
      fare: Double = 0,
      hourlyRate: Double = 0,
      kmRate: Double = 0,
      distanceKm: Double = 0,
      durationMin: Int = 0,
      verdictLevel: Int = 1,
      todayEarnings: Double = 0,
      todayHourlyRate: Double = 0,
      todayKm: Double = 0,
      onlineMinutes: Int = 0
    ) {
      self.platform = platform
      self.fare = fare
      self.hourlyRate = hourlyRate
      self.kmRate = kmRate
      self.distanceKm = distanceKm
      self.durationMin = durationMin
      self.verdictLevel = verdictLevel
      self.todayEarnings = todayEarnings
      self.todayHourlyRate = todayHourlyRate
      self.todayKm = todayKm
      self.onlineMinutes = onlineMinutes
    }
  }

  /// Données fixes pour la durée de l'activité (id de scan, démarrage…).
  public let scanId: String
  public let startedAt: Date

  public init(scanId: String = UUID().uuidString, startedAt: Date = Date()) {
    self.scanId = scanId
    self.startedAt = startedAt
  }
}

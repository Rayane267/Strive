import Foundation
import ActivityKit
import AppIntents

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

    /// Horodatage du scan (epoch s) — corrèle les boutons Accepter/Refuser de la
    /// Live Activity (iOS 17+) à la course. Optionnel → décodage tolérant des
    /// activités déjà en cours lors d'une mise à jour de l'app. nil/0 = pas de
    /// course taguable (états idle / scanning / error).
    public let scanTs: Double?

    /// Epoch (s) « de référence » pour la durée de session du JOUR : posé à
    /// `débutSession - tempsEnLigneDéjàCumuléAujourdhui`. La Live Activity affiche
    /// `Text(date, style: .timer)` à partir de là → le compteur tourne SEUL sur le
    /// lock screen (aucun réveil de l'app nécessaire). nil = pas de timer.
    public let sessionStartEpoch: Double?

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
      onlineMinutes: Int = 0,
      scanTs: Double? = nil,
      sessionStartEpoch: Double? = nil
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
      self.scanTs = scanTs
      self.sessionStartEpoch = sessionStartEpoch
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

// MARK: - Boutons interactifs de la Live Activity (iOS 17+)

/// Intent déclenché par les boutons ✅/❌ de la Dynamic Island / Live Activity.
/// Écrit la décision dans l'App Group (même file que les actions de notification)
/// puis poste une notification Darwin → l'app draine et réconcilie côté JS.
///
/// Défini dans CE fichier (partagé Strive + StriveWidget) pour être disponible
/// aux deux process — le bouton est rendu par le widget, l'intent s'exécute côté app.
@available(iOS 17.0, *)
struct RideDecisionIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Tag a scanned ride"
  static var isDiscoverable: Bool = false
  static var openAppWhenRun: Bool = false

  @Parameter(title: "scanTs") var scanTs: Double
  @Parameter(title: "accepted") var accepted: Bool

  init() {}
  init(scanTs: Double, accepted: Bool) {
    self.scanTs = scanTs
    self.accepted = accepted
  }

  func perform() async throws -> some IntentResult {
    guard scanTs > 0 else { return .result() }
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"

    // 1) Retour à l'état de base + incrément KPI immédiat (gains/km/€h), sans JS.
    if #available(iOS 16.2, *) {
      let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
      await revertLiveActivityToIdle(addFare: add.fare, addKm: add.km)
    }
    // 2) Persistance pour la réconciliation JS (vérité Supabase).
    appendRideDecision(scanTs: scanTs, accepted: accepted, appGroupId: appGroupId)
    return .result()
  }
}

// MARK: - Helpers partagés (boutons Live Activity + commandes vocales)

/// Tarif/distance de la DERNIÈRE course scannée (App Group `lastScanResult`),
/// pour incrémenter les KPI de la Live Activity côté natif sans attendre le JS.
func lastScannedFareKm(appGroupId: String) -> (fare: Double, km: Double) {
  guard let defaults = UserDefaults(suiteName: appGroupId),
        let data = defaults.data(forKey: "lastScanResult"),
        let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return (0, 0) }
  let fare = (body["fare"] as? NSNumber)?.doubleValue ?? 0
  let km = (body["distanceKm"] as? NSNumber)?.doubleValue ?? 0
  return (fare, km)
}

/// Empile la décision Accepter/Refuser (App Group) + notifie l'app (Darwin) →
/// réconciliation JS (Supabase = source de vérité, corrige l'optimiste natif).
func appendRideDecision(scanTs: Double, accepted: Bool, appGroupId: String) {
  guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
  var arr: [[String: Any]] = []
  if let data = defaults.data(forKey: "pendingRideDecisions"),
     let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    arr = existing
  }
  arr.append(["scanTs": scanTs, "status": accepted ? "ACCEPTED" : "DECLINED"])
  if let data = try? JSONSerialization.data(withJSONObject: arr) {
    defaults.set(data, forKey: "pendingRideDecisions")
  }
  let center = CFNotificationCenterGetDarwinNotifyCenter()
  CFNotificationCenterPostNotification(
    center,
    CFNotificationName("com.striveapp.app.rideDecision" as CFString),
    nil, nil, true
  )
}

/// Repasse la Live Activity à l'état de base (résumé de session) en ajoutant
/// éventuellement une course acceptée aux KPI du jour. €/h recalculé via le timer
/// (`sessionStartEpoch`). Met la carte à jour IMMÉDIATEMENT, app fermée incluse —
/// le petit dashboard du lock screen devient live sans réouverture de l'app.
@available(iOS 16.2, *)
func revertLiveActivityToIdle(addFare: Double, addKm: Double) async {
  for activity in Activity<StriveActivityAttributes>.activities {
    let prev = activity.content.state
    let newEarnings = prev.todayEarnings + addFare
    let newKm = prev.todayKm + addKm
    var newRate = prev.todayHourlyRate
    if let epoch = prev.sessionStartEpoch {
      let hours = (Date().timeIntervalSince1970 - epoch) / 3600.0
      if hours > 0.0003 { newRate = newEarnings / hours }   // > ~1 s en ligne
    }
    let idle = StriveActivityAttributes.ContentState(
      platform: "IDLE",
      todayEarnings: newEarnings,
      todayHourlyRate: newRate,
      todayKm: newKm,
      onlineMinutes: prev.onlineMinutes,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    await activity.update(
      ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8))
    )
  }
}

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

    /// Identité de la course affichée — frappée au scan, portée jusqu'ici, et
    /// renvoyée telle quelle par les boutons Prise/Refusée (iOS 17+). C'est ce
    /// qui permet à un tap sur le lock screen de désigner la course sans que
    /// personne ait à la retrouver.
    ///
    /// Optionnel → décodage tolérant des activités déjà en cours lors d'une
    /// mise à jour de l'app. nil = pas de course taguable (idle / scanning /
    /// error), et donc pas de boutons.
    public let rideId: String?

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
      rideId: String? = nil,
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
      self.rideId = rideId
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
/// Écrit la décision dans l'App Group — même file que les actions de
/// notification et que les commandes vocales. L'app la lit à sa prochaine
/// synchro du Dashboard et l'écrit en base.
///
/// Défini dans CE fichier (partagé Strive + StriveWidget) pour être disponible
/// aux deux process — le bouton est rendu par le widget, l'intent s'exécute côté app.
@available(iOS 17.0, *)
struct RideDecisionIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Tag a scanned ride"
  static var isDiscoverable: Bool = false
  static var openAppWhenRun: Bool = false

  @Parameter(title: "rideId") var rideId: String
  @Parameter(title: "accepted") var accepted: Bool

  init() {}
  init(rideId: String, accepted: Bool) {
    self.rideId = rideId
    self.accepted = accepted
  }

  func perform() async throws -> some IntentResult {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"

    guard !rideId.isEmpty else { return .result() }

    // 1) PERSISTANCE D'ABORD, et c'est un ordre, pas une préférence de style.
    //
    // Cet `await` peut ne jamais rendre la main : iOS lance l'app en arrière-plan
    // pour exécuter l'intent, et peut la suspendre pendant `activity.update`.
    // Tout ce qui suivait l'await disparaissait alors avec le process — la
    // décision n'était jamais écrite, le JS n'avait rien à réconcilier, et la
    // carte n'avait pas bougé non plus. Le tap ne laissait aucune trace, nulle
    // part : « des fois je clique et rien ne se passe ».
    //
    // L'écriture App Group, elle, est synchrone et tient en microsecondes. En la
    // passant devant, le pire cas devient « la carte ne bouge pas mais la course
    // est bien taguée à la réouverture », au lieu d'une décision perdue.
    appendRideDecision(rideId: rideId, accepted: accepted, appGroupId: appGroupId)

    // 2) Retour à l'état de base + incrément KPI immédiat (gains/km/€h), sans JS.
    if #available(iOS 16.2, *) {
      let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
      await revertLiveActivityToIdle(rideId: rideId, addFare: add.fare, addKm: add.km)
    }
    return .result()
  }
}

// MARK: - Helpers partagés (boutons Live Activity + commandes vocales)

/// Tarif/distance de la DERNIÈRE course scannée, pour incrémenter les KPI de la
/// Live Activity côté natif sans attendre le JS.
///
/// Source = `lastTaggableRide`, une clé minuscule (montant + km) écrite à chaque
/// résultat et JAMAIS purgée. `lastScanResult`, elle, est supprimée par
/// `handleShareExtensionResult` quand l'app vide sa file : lire cette clé-là
/// rendait (0, 0) dès que l'app avait été ouverte une fois — donc le bouton ✅
/// n'ajoutait plus rien aux gains du jour, précisément dans le cas (app
/// suspendue) que cet incrément natif existe pour couvrir.
///
/// Le montant porté est le tarif AFFICHÉ (net de carburant si l'option est
/// active), cohérent avec ce que la carte montre — `lastScanResult.fare` est
/// brut et faisait monter les gains en brut sous un affichage net.
func lastScannedFareKm(appGroupId: String) -> (fare: Double, km: Double) {
  // (la clé porte aussi `rideId`, lu séparément par `tagLastScannedRide`)
  guard let defaults = UserDefaults(suiteName: appGroupId) else { return (0, 0) }
  if let entry = defaults.dictionary(forKey: "lastTaggableRide") {
    let fare = (entry["fare"] as? NSNumber)?.doubleValue ?? 0
    let km = (entry["km"] as? NSNumber)?.doubleValue ?? 0
    return (fare, km)
  }
  // Repli : résultat écrit par un build antérieur, encore en attente de relève.
  guard let data = defaults.data(forKey: "lastScanResult"),
        let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return (0, 0) }
  let fare = (body["displayFare"] as? NSNumber)?.doubleValue
    ?? (body["fare"] as? NSNumber)?.doubleValue ?? 0
  let km = (body["distanceKm"] as? NSNumber)?.doubleValue ?? 0
  return (fare, km)
}

/// Empile la décision Accepter/Refuser dans l'App Group. Rien d'autre : l'app
/// vient la chercher (`getPendingRideDecisions`) au moment où elle peut l'écrire
/// en base, et l'acquitte alors. Supabase reste la source de vérité et corrige
/// l'optimiste natif affiché sur la carte.
func appendRideDecision(rideId: String, accepted: Bool, appGroupId: String) {
  guard !rideId.isEmpty, let defaults = UserDefaults(suiteName: appGroupId) else { return }
  var arr: [[String: Any]] = []
  if let data = defaults.data(forKey: "pendingRideDecisions"),
     let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    arr = existing
  }
  // Une seule décision par course, la dernière : deux taps successifs sur la
  // même carte ne doivent pas laisser deux entrées à appliquer dans l'ordre où
  // elles sortent de la file.
  arr.removeAll { ($0["rideId"] as? String) == rideId }
  arr.append(["rideId": rideId, "status": accepted ? "ACCEPTED" : "DECLINED"])
  if let data = try? JSONSerialization.data(withJSONObject: arr) {
    defaults.set(data, forKey: "pendingRideDecisions")
  }
}

/// Repasse la Live Activity à l'état de base (résumé de session) en ajoutant
/// éventuellement une course acceptée aux KPI du jour. €/h recalculé via le timer
/// (`sessionStartEpoch`). Met la carte à jour IMMÉDIATEMENT, app fermée incluse —
/// le petit dashboard du lock screen devient live sans réouverture de l'app.
@available(iOS 16.2, *)
func revertLiveActivityToIdle(rideId: String, addFare: Double, addKm: Double) async {
  for activity in Activity<StriveActivityAttributes>.activities {
    let prev = activity.content.state
    // On n'écarte QUE ce que la garde doit protéger : une AUTRE offre, qui a
    // déjà remplacé l'affichage et ne doit pas être effacée par une décision
    // portant sur la précédente. La carte n'en montre qu'une à la fois, et la
    // plus récente écrase toujours celle d'avant — un id différent est donc
    // exactement « une offre plus récente ».
    //
    // Une carte sans `rideId` (idle, ou état pas encore synchronisé quand iOS
    // lance l'app en arrière-plan pour cet intent) n'a rien à protéger : on
    // passe. C'était le cas qui laissait la carte figée sur son verdict alors
    // que la décision partait bien vers le JS — « des fois ça met à jour, des
    // fois non ».
    //
    // Ce qui a disparu avec `scanTs` : une comparaison de `Double` à 17
    // chiffres significatifs, tolérante à la milliseconde parce que la valeur
    // se faisait rogner par les encodages successifs (paramètres d'AppIntent,
    // JSON App Group, `userInfo` de notification). Une chaîne traverse tout
    // sans perte.
    if let prevId = prev.rideId, prevId != rideId {
      continue
    }
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
      ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8), relevanceScore: 50)
    )
  }
}

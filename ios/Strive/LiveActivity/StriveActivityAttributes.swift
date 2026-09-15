import Foundation
import ActivityKit
import AppIntents

/// Devise et unité de distance du chauffeur, pour tout ce que le NATIF affiche :
/// la Dynamic Island, l'écran verrouillé, les notifications, CarPlay.
///
/// Le « € » était écrit en dur à une dizaine d'endroits. Un chauffeur londonien
/// voyait donc son verdict en euros sur l'écran verrouillé alors que l'app, elle,
/// lui parlait en livres — deux monnaies pour la même course, et celle qui compte
/// au moment de décider était la fausse.
///
/// POSÉ ICI parce que ce fichier est déjà partagé entre l'app et la Widget
/// Extension : la Live Activity a besoin du symbole, et un nouveau fichier
/// demanderait de toucher au projet Xcode pour rien.
///
/// Le pays vient de l'App Group, où `ScanBridge.setMarketCountry` l'écrit. Il
/// n'est PAS mis en cache : il change quand le chauffeur corrige sa devise, et
/// un scan doit le voir tout de suite.
public enum StriveMarket {
  static var country: String {
    let gid = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: gid)?.string(forKey: "marketCountry") ?? "FR"
  }

  /// « € », « CHF » ou « £ ».
  public static var symbol: String {
    switch country {
    case "GB": return "£"
    case "CH": return "CHF"
    default:   return "€"
    }
  }

  /// « km » partout, « mi » au Royaume-Uni.
  public static var distanceUnit: String { country == "GB" ? "mi" : "km" }

  /// Le scanner rend toujours des kilomètres — c'est ce que stocke
  /// `rides.distance_km`, et les bornes de plausibilité raisonnent dessus. La
  /// conversion n'a lieu qu'ici, au dernier pixel.
  public static func distance(_ km: Double) -> Double {
    country == "GB" ? km / 1.609344 : km
  }

  /// La livre se pose AVANT le nombre, l'euro et le franc après. S'y tromper
  /// suffit à faire lire le prix comme une traduction automatique, et c'est le
  /// premier chiffre que le chauffeur regarde.
  ///
  /// Espace avant « CHF » seulement : c'est un mot, et « 37CHF » se lit comme
  /// une coquille. Les glyphes, eux, restent collés — l'îlot compact et la
  /// pastille de tarif comptent leurs points de largeur.
  public static func money(_ value: Double, decimals: Int = 0) -> String {
    let s = String(format: "%.\(decimals)f", value)
    if symbol == "£" { return "£" + s }
    return symbol.count > 1 ? s + " " + symbol : s + symbol
  }

  /// « 57€/h », « £37/h ».
  public static func perHour(_ value: Double) -> String { money(value, decimals: 0) + "/h" }

  /// Un taux « par kilomètre » ramené à l'unité du marché.
  ///
  /// Le tarif divisé par la distance donne toujours des « par kilomètre » — c'est
  /// en kilomètres que le parser rend la course, sur les six marchés. Coller
  /// « /mi » derrière sans convertir affichait donc 0,80 £/mile là où le chauffeur
  /// gagne 1,29 £/mile : un tiers de son revenu effacé par une étiquette.
  ///
  /// Un taux par mile est PLUS GRAND que le même taux par kilomètre — on parcourt
  /// plus de chemin pour le gagner. D'où la multiplication, là où une distance se
  /// divise. Affichage seulement : les seuils, eux, restent au kilomètre.
  public static func rate(_ perKm: Double) -> Double {
    country == "GB" ? perKm * 1.609344 : perKm
  }

  /// « 3.15€/km », « £3.24/mi ». Prend un taux PAR KILOMÈTRE.
  public static func perDistance(_ perKm: Double) -> String {
    money(rate(perKm), decimals: 2) + "/" + distanceUnit
  }

  /// « 5.4km », « 3.4mi ».
  public static func distanceText(_ km: Double) -> String {
    String(format: "%.1f", distance(km)) + distanceUnit
  }
}

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
    /// Dans la devise du marché — voir `StriveMarket`. Les valeurs voyagent
    /// nues : c'est l'affichage qui met le symbole.
    public let fare: Double
    public let hourlyRate: Double
    public let kmRate: Double
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
/// Le prix d'une course, tel qu'il doit s'afficher.
///
/// POURQUOI PAS `%.0f` PARTOUT. Toutes les surfaces de scan arrondissaient à
/// l'euro. Tant que le tarif est brut ça ne se voit pas — les plateformes
/// affichent des montants ronds. Mais dès que « Retirer le carburant du prix »
/// est actif, le net tombe sur des centimes : une course à 20 € avec 0,39 € de
/// carburant valait 19,61 €, que `%.0f` réaffichait… 20 €. La déduction était
/// calculée, poussée, reçue — et effacée au dernier pixel. Le chauffeur ne
/// pouvait qu'en conclure que l'option ne marchait pas.
///
/// L'euro rond reste affiché rond : la précision n'apparaît que lorsqu'elle
/// porte une information.
public func striveFareText(_ fare: Double) -> String {
  let rounded = (fare * 100).rounded() / 100
  return rounded == rounded.rounded()
    ? StriveMarket.money(rounded, decimals: 0)
    : StriveMarket.money(rounded, decimals: 2)
}

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

/// Recopie les KPI de session dans l'App Group (`laSessionSnapshot`).
///
/// C'est la SEULE copie qui survit à la mort de la carte : quand iOS la retire
/// alors que la session continue, `LiveActivityManager.ensureRunning()` la recrée
/// à partir de là. Une mise à jour qui ne passe pas par ici est donc oubliée dès
/// que la carte disparaît — c'était le cas du bouton ✅, qui incrémentait les
/// gains à l'écran et les laissait revenir à leur valeur d'avant.
///
/// DUPLIQUE délibérément `LiveActivityManager.saveSessionSnapshot`, qui garde sa
/// version privée : ce fichier tourne aussi dans des contextes où le manager n'est
/// pas compilé, et le manager doit rester identique à sa version de référence.
/// Les deux écrivent la MÊME clé et la même forme — à tenir en phase.
@available(iOS 16.2, *)
func saveLiveActivitySessionSnapshot(_ s: StriveActivityAttributes.ContentState) {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  guard let d = UserDefaults(suiteName: appGroupId) else { return }
  var snap: [String: Any] = [
    "todayEarnings": s.todayEarnings,
    "todayHourlyRate": s.todayHourlyRate,
    "todayKm": s.todayKm,
    "onlineMinutes": s.onlineMinutes,
  ]
  if let start = s.sessionStartEpoch { snap["sessionStartEpoch"] = start }
  d.set(snap, forKey: "laSessionSnapshot")
  // Signale à `LiveActivityManager` qu'une écriture lui a échappé.
  //
  // Le manager mémorise son dernier état poussé pour ne pas dépendre du délai de
  // retour d'ActivityKit (`freshestState`). Mais CE chemin-ci — les boutons
  // ✅/❌ de la carte — repasse à l'idle sans passer par lui : sans ce repère,
  // une poussée KPI arrivant juste après un tap ressuscitait le verdict que le
  // chauffeur venait de trancher. Un tap dans les secondes qui suivent
  // l'affichage du résultat, c'est le cas NORMAL, pas un cas limite.
  d.set(Date().timeIntervalSince1970, forKey: "laForeignWriteAt")
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
    // AVANT l'await, comme l'écriture de la décision dans `RideDecisionIntent` :
    // ce process peut être suspendu pendant `activity.update`, et tout ce qui
    // suit l'await disparaît alors avec lui. Écrire dans l'App Group est
    // synchrone et tient en microsecondes.
    saveLiveActivitySessionSnapshot(idle)
    await activity.update(
      ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8), relevanceScore: 50)
    )
  }
}

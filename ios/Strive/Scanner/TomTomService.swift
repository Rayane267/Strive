import Foundation

/// Service TomTom (geocoding + routing) — mirror exact du `TomTomService.kt`
/// côté Android. Utilisé par `AnalyzeRideIntent` (Shortcut iOS) et la Share
/// Extension pour vérifier la distance/durée annoncées par l'OCR.
///
/// Target Membership Xcode : ce fichier DOIT être inclus dans
///  - `Strive` (app principale)
///  - `StriveShareExtension`
///
/// Sinon le code ne sera pas accessible depuis la Share Extension.
final class TomTomService {

  static let shared = TomTomService()
  private init() {}

  private static let baseSearch  = "https://api.tomtom.com/search/2/geocode"
  /// Recherche de lieux (gares, aéroports, parkings…). `/geocode` ne connaît
  /// que les rues : « Parking, Cité des Sciences et de l'Industrie » y devenait
  /// une avenue de Belfort, score 13.
  private static let basePlaceSearch = "https://api.tomtom.com/search/2/search"
  private static let baseRouting = "https://api.tomtom.com/routing/1/calculateRoute"
  private static let countrySet  = "FR,BE,CH,LU,GB,DE,ES,IT,NL,PT,AT,IE,PL"
  private static let timeoutSec: TimeInterval = 4
  private static let minScore: Double = 3.0

  /// Stockée dans App Group par `ScanBridge.setTomTomApiKey`.
  private var cachedKey: String?

  /**
   Pays d'activité du chauffeur, écrit en App Group par `ScanBridge.setMarket`.

   `countrySet` listait les treize pays couverts et `language` était figé à
   `fr-FR`. Un nom de rue existe souvent dans plusieurs pays — il y a des
   « Victoria Street » partout — et TomTom, à `limit=1`, en choisissait une.
   Restreindre au pays du chauffeur supprime l'ambiguïté à la source au lieu
   d'espérer que le classement tombe juste.

   Vide = on ne sait pas encore : on garde alors la liste complète, qui vaut
   mieux qu'un pays deviné. Non mis en cache, contrairement à la clé : il change
   quand le chauffeur corrige son pays, et un scan doit le voir tout de suite.
   */
  private var marketCountry: String? {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let c = UserDefaults(suiteName: appGroupId)?.string(forKey: "marketCountry")
    return (c?.isEmpty == false) ? c : nil
  }

  /// Le pays du chauffeur s'il est connu, sinon les treize marchés couverts.
  private var activeCountrySet: String { marketCountry ?? Self.countrySet }

  /// Langue des résultats : celle du pays. Figée à `fr-FR`, elle renvoyait des
  /// libellés français à un chauffeur londonien.
  private var geocodeLanguage: String {
    // `?? ""` plutot qu'un switch sur l'Optional : le filet est gratuit et
    // enleve toute ambiguite d'inference.
    switch marketCountry ?? "" {
    case "GB": return "en-GB"
    case "ES": return "es-ES"
    case "PT": return "pt-PT"
    case "BE": return "fr-BE"
    case "CH": return "fr-CH"
    default:   return "fr-FR"
    }
  }

  private func apiKey() -> String? {
    if let k = cachedKey, !k.isEmpty { return k }
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let k = UserDefaults(suiteName: appGroupId)?.string(forKey: "tomTomApiKey")
    cachedKey = k
    return (k?.isEmpty == false) ? k : nil
  }

  var isReady: Bool { apiKey() != nil }

  /// Issue d'un calcul d'itinéraire.
  ///
  /// `nil` disait seulement « pas d'itinéraire », et l'appelant se rabattait
  /// alors sur les chiffres lus à l'écran — ceux de la plateforme — sans que le
  /// chauffeur puisse le savoir. Les deux motifs ne se soignent pourtant pas de
  /// la même façon : un réseau absent se retente, une adresse illisible se
  /// recapture. Ils méritent deux messages, donc deux valeurs.
  enum RouteOutcome {
    case ok(RouteResult)
    /// Aucune clé configurée : l'app ne peut rien mesurer sur cette install.
    case noKey
    /// TomTom n'a pas répondu — réseau coupé, timeout, erreur HTTP. Le texte dit
    /// lequel (« geocode pickup=timeout », « route_api http429 »…) : sans lui,
    /// un réseau absent, la limite de requêtes et un quota épuisé se confondaient.
    case unreachable(String)
    /// TomTom a répondu, mais le résultat n'est pas exploitable : adresse sous
    /// le plancher de fiabilité, ou trajet hors bornes. Le texte dit laquelle
    /// (« geocode pickup=none », « route_api »…) — il part en `detail` de l'échec.
    case unusable(String)
  }

  /// Issue d'un géocodage. Même raison d'être que `RouteOutcome`. `unusable`
  /// porte le meilleur score obtenu : nil = aucun résultat, sinon un résultat
  /// trouvé mais sous le plancher (centroïde de ville).
  private enum GeocodeOutcome {
    case hit(GeocodeHit)
    /// Pourquoi TomTom n'a pas répondu (cf. `HttpReply.failure`).
    case unreachable(String)
    case unusable(Double?)
  }

  /// « pickup=none », « dest=2.1 », « pickup=timeout » : ce que le géocodeur a
  /// fait d'une adresse refusée, ou ce qui l'a empêché de répondre. nil si
  /// l'adresse est passée.
  private static func geocodeFailure(_ side: String, _ outcome: GeocodeOutcome) -> String? {
    switch outcome {
    case .hit:
      return nil
    case .unreachable(let why):
      return "\(side)=\(why)"
    case .unusable(let score):
      return score.map { String(format: "%@=%.1f", side, $0) } ?? "\(side)=none"
    }
  }

  struct Coords { let lat: Double; let lon: Double }
  struct GeocodeHit { let coords: Coords; let score: Double; let formatted: String? }
  struct RouteResult {
    let distanceKm: Double
    let durationMin: Int
    /// Adresses canoniques renvoyées par TomTom (affichage propre vs texte OCR bruité).
    let pickupFormatted: String?
    let destFormatted: String?
    /// Points géocodés, gardés pour la carte des zones (Stats).
    var pickupCoords: Coords? = nil
    var destCoords: Coords? = nil
  }

  /// Calcule le trajet entre 2 adresses texte. L'issue dit POURQUOI quand il
  /// n'y a pas d'itinéraire — l'appelant en fait un message, plus un silence.
  ///
  /// `screenDistanceKm` : la distance de course lue à l'écran. Elle sert à
  /// vérifier que la destination géocodée est à une distance du départ
  /// compatible, et sinon à la chercher autour du départ (cf. `resolveNear`).
  /// nil = comportement d'origine.
  func calculateRoute(
    pickupAddress: String,
    destinationAddress: String,
    screenDistanceKm: Double? = nil,
    completion: @escaping (RouteOutcome) -> Void
  ) {
    guard isReady else { completion(.noKey); return }
    let pickup = pickupAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    let dest = destinationAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !pickup.isEmpty, !dest.isEmpty else { completion(.unusable("empty_address")); return }

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { completion(.unreachable("released")); return }
      // Geocoding pickup + destination en parallèle — divise par ~2 le temps
      // total. Chaque variant chain reste séquentiel à l'intérieur d'une
      // adresse (early-exit sur bon score), seuls les 2 fronts sont lancés.
      let group = DispatchGroup()
      var fromOutcome: GeocodeOutcome = .unusable(nil)
      var toOutcome: GeocodeOutcome = .unusable(nil)
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        fromOutcome = self.geocodeBestVariant(pickup)
        group.leave()
      }
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        toOutcome = self.geocodeBestVariant(dest)
        group.leave()
      }
      group.wait()

      var fromHit: GeocodeHit? = { if case .hit(let h) = fromOutcome { return h }; return nil }()
      var toHit: GeocodeHit? = { if case .hit(let h) = toOutcome { return h }; return nil }()

      // Recalage géographique par la distance affichée. Le départ est en général
      // une adresse que le géocodeur trouve ; la destination, souvent un LIEU
      // (gare, aéroport, parking) qu'il confond avec une rue homonyme ailleurs.
      // On ne touche à rien quand le point trouvé est cohérent : seul un point
      // incohérent, ou introuvable, déclenche une recherche — et si rien n'est
      // cohérent, on garde le résultat d'origine.
      if let screen = screenDistanceKm, screen > 0 {
        if let f = fromHit {
          if let near = self.resolveNear(dest, current: toHit, anchor: f.coords, screenKm: screen) {
            toHit = near
          } else if let t = toHit,
                    let near = self.resolveNear(pickup, current: nil, anchor: t.coords, screenKm: screen) {
            // Aucune destination plausible autour du départ : c'est le DÉPART qui
            // était ailleurs. « Chessy Nord, Disneyland » géocodé à Chessy-les-Prés
            // (Aube), 150 km plus loin → 181,5 km affichés au lieu de 47,7.
            fromHit = near
          }
        } else if let t = toHit {
          fromHit = self.resolveNear(pickup, current: nil, anchor: t.coords, screenKm: screen)
        }
      }

      // Un réseau absent l'emporte sur une adresse douteuse : c'est le motif le
      // plus probable des deux, et le seul qui vaille la peine d'être retenté.
      guard let from = fromHit, let to = toHit else {
        let unreachable: Bool = {
          if case .unreachable = fromOutcome { return true }
          if case .unreachable = toOutcome { return true }
          return false
        }()
        let refused = [
          Self.geocodeFailure("pickup", fromOutcome), Self.geocodeFailure("dest", toOutcome),
        ].compactMap { $0 }.joined(separator: " ")
        DispatchQueue.main.async {
          completion(unreachable ? .unreachable("geocode " + refused) : .unusable("geocode " + refused))
        }
        return
      }

      switch self.getRoute(from: from.coords, to: to.coords) {
      case .ok(let route):
        // Enrichit avec les adresses canoniques TomTom → affichage propre.
        let enriched = RouteResult(
          distanceKm: route.distanceKm, durationMin: route.durationMin,
          pickupFormatted: from.formatted, destFormatted: to.formatted,
          pickupCoords: from.coords, destCoords: to.coords
        )
        DispatchQueue.main.async { completion(.ok(enriched)) }
      case let other:
        DispatchQueue.main.async { completion(other) }
      }
    }
  }

  // MARK: - Geocoding

  // MARK: - Recalage par la distance affichée

  /// Distance à vol d'oiseau, en km.
  private static func straightKm(_ a: Coords, _ b: Coords) -> Double {
    let r = 6371.0
    let dLat = (b.lat - a.lat) * .pi / 180
    let dLon = (b.lon - a.lon) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * r * asin(min(1, sqrt(h)))
  }

  /// Un point à `km` du départ (vol d'oiseau) est-il compatible avec la distance
  /// de route affichée ? Jamais plus loin que la route (arrondis compris), et
  /// rarement à moins de 40 % d'elle.
  private static func plausible(_ km: Double, screen: Double) -> Bool {
    km <= screen * 1.1 + 2 && km >= screen / 2.5 - 1
  }

  /// Écart à la distance attendue : une route fait ~1,35 fois le vol d'oiseau.
  private static func misfit(_ km: Double, screen: Double) -> Double {
    abs(km * 1.35 - screen)
  }

  /// Le point le plus cohérent pour `address`, vu depuis `anchor`.
  ///
  /// `current` (le géocodage normal) est gardé s'il est plausible : aucun appel
  /// de plus. Sinon on interroge, dans un cercle autour de `anchor`, la
  /// recherche de lieux ET le géocodage, et on garde le candidat plausible le
  /// plus proche de la distance attendue. Aucune des deux méthodes n'a raison
  /// partout — « Hall 2, Aéroport Lyon-Saint-Exupéry » n'est juste qu'en
  /// géocodage, « Terminal 1, Aéroport Marseille Provence » qu'en recherche de
  /// lieux : c'est la distance affichée qui tranche. nil si rien n'est plausible.
  private func resolveNear(
    _ address: String, current: GeocodeHit?, anchor: Coords, screenKm: Double
  ) -> GeocodeHit? {
    if let c = current, Self.plausible(Self.straightKm(anchor, c.coords), screen: screenKm) { return c }
    let query = Self.placeHead(address) ?? address
    let radiusKm = screenKm * 1.1 + 2
    var found: [GeocodeHit] = []
    let lock = NSLock()
    let group = DispatchGroup()
    for base in [Self.basePlaceSearch, Self.baseSearch] {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        if let h = self.lookup(base, query, near: anchor, radiusKm: radiusKm) {
          lock.lock(); found.append(h); lock.unlock()
        }
        group.leave()
      }
    }
    group.wait()
    return found
      .map { (hit: $0, km: Self.straightKm(anchor, $0.coords)) }
      .filter { Self.plausible($0.km, screen: screenKm) }
      .min { Self.misfit($0.km, screen: screenKm) < Self.misfit($1.km, screen: screenKm) }?
      .hit
  }

  /// Premier résultat de `base`, dans un cercle autour de `near` s'il est donné.
  /// Ni cache ni plancher de score : le score de la recherche de lieux n'est pas
  /// sur la même échelle qu'en `/geocode`, c'est l'appelant qui juge.
  private func lookup(_ base: String, _ address: String, near: Coords? = nil, radiusKm: Double = 0) -> GeocodeHit? {
    guard let key = apiKey(),
          let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
    else { return nil }
    var urlString = "\(base)/\(encoded).json?key=\(key)&language=\(geocodeLanguage)"
      + "&countrySet=\(activeCountrySet)&limit=1"
    if let near = near {
      urlString += "&lat=\(near.lat)&lon=\(near.lon)&radius=\(Int(radiusKm * 1000))"
    }
    guard let url = URL(string: urlString),
          let data = httpGet(url).data,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let first = (json["results"] as? [[String: Any]])?.first,
          let pos = first["position"] as? [String: Any],
          let lat = (pos["lat"] as? NSNumber)?.doubleValue,
          let lon = (pos["lon"] as? NSNumber)?.doubleValue
    else { return nil }
    let formatted = (first["address"] as? [String: Any])?["freeformAddress"] as? String
    let score = (first["score"] as? NSNumber)?.doubleValue ?? 0
    return GeocodeHit(coords: Coords(lat: lat, lon: lon), score: score, formatted: formatted)
  }

  /// Mots de voie des marchés couverts. Sans « gare », « aéroport »,
  /// « terminal », « cité »… que le parseur compte comme adresses : ici, ce
  /// sont justement des lieux. Mirror Kotlin.
  private static let streetWords = [
    "rue", "ruelle", "avenue", "av", "av.", "boulevard", "bd", "bd.", "blvd",
    "place", "pl.", "impasse", "imp.", "allée", "allee", "chemin", "ch.",
    "route", "rte", "rte.", "passage", "quai", "esplanade", "cours",
    "faubourg", "fg.", "square", "sq.", "voie", "sentier",
    "street", "st.", "road", "rd.", "lane", "drive", "ave.", "way",
    "close", "crescent", "terrace", "mews",
    "calle", "c/", "avenida", "avda", "plaza", "paseo", "carretera", "camino", "ronda",
    "via", "viale", "corso", "piazza", "strada", "vicolo",
    "straat", "laan", "plein", "gracht", "weg",
    "straße", "strasse", "str.", "platz", "gasse",
    "rua", "travessa", "praça", "praca", "estrada", "alameda",
  ]

  private static let streetWordsPattern: String = {
    let words = streetWords.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
    return #"(?<!\p{L})(?:"# + words + #")(?!\p{L})"#
  }()

  /// Un numéro en tête d'un segment (« 5 Rue… », « 1 des Fauvettes ») ou un mot
  /// de voie. Pas « Terminal 1 » ni « Hall 2 » : le numéro y suit le nom.
  private static let streetRegex = try? NSRegularExpression(
    pattern: #"(?:^|,)\s*\d{1,4}\s*(?:bis|ter)?,?\s+\p{L}|"# + streetWordsPattern,
    options: .caseInsensitive
  )

  private static let streetWordRegex = try? NSRegularExpression(
    pattern: streetWordsPattern, options: .caseInsensitive
  )

  /// « Terminal 2E, Arrivées Minute - Sortie 5, 6, 7 ou 8, 95711, Le Mesnil-Amelot »
  /// → « Terminal 2E, 95711, Le Mesnil-Amelot ». Uber détaille le point de
  /// rendez-vous d'un terminal (niveau, sorties) : ni `/geocode` ni la recherche
  /// de lieux ne trouvent la forme longue, la courte donne le terminal
  /// (scan_debug #130–#134). nil s'il n'y a rien à retirer, ou si la partie
  /// retirée nomme une voie : « Bâtiment B, 12 rue X, 75001, Paris » garde sa rue.
  private static func placeHead(_ address: String) -> String? {
    let segments = address.components(separatedBy: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    guard segments.count >= 4, !segments[0].isEmpty else { return nil }
    let postal = segments[segments.count - 2]
    guard postal.range(of: #"^\d{4,5}$"#, options: .regularExpression) != nil else { return nil }
    let dropped = segments[1..<(segments.count - 2)].joined(separator: ", ")
    if let re = streetWordRegex,
       re.firstMatch(in: dropped, range: NSRange(dropped.startIndex..., in: dropped)) != nil {
      return nil
    }
    return "\(segments[0]), \(postal), \(segments[segments.count - 1])"
  }

  /// Ni numéro de rue ni mot de voie : un LIEU — site touristique, gare,
  /// aéroport, hôtel. `/geocode` ne connaît que les rues : il garde les mots
  /// qu'il reconnaît et les recolle à une rue ailleurs. « Chessy Nord,
  /// Disneyland » y devenait la place des Combattants en Afrique du Nord, à
  /// Chessy-les-Prés (Aube), 150 km plus loin ; la recherche de lieux répond
  /// Disneyland Paris.
  private static func looksLikePlace(_ address: String) -> Bool {
    guard let re = streetRegex else { return false }
    return re.firstMatch(in: address, range: NSRange(address.startIndex..., in: address)) == nil
  }

  private func geocodeBestVariant(_ address: String) -> GeocodeOutcome {
    // Un lieu se cherche d'abord en recherche de lieux ; `/geocode` reste le
    // filet s'il n'y est pas. La forme courte d'abord : c'est celle que TomTom
    // connaît.
    for candidate in [Self.placeHead(address), address].compactMap({ $0 })
    where Self.looksLikePlace(candidate) {
      if let hit = lookup(Self.basePlaceSearch, candidate), hit.score >= Self.minScore {
        return .hit(hit)
      }
    }
    var best: GeocodeHit?
    var unreachable: String?
    for variant in buildAddressVariants(address) {
      switch geocode(variant) {
      case .hit(let hit):
        if best == nil || hit.score > best!.score { best = hit }
        if best!.score >= Self.minScore + 2 { return .hit(best!) }
      case .unreachable(let why):
        unreachable = why
      case .unusable:
        continue
      }
    }
    // Plancher de fiabilité : un score < minScore = match centroïde ville/pays
    // (adresse OCR douteuse). On préfère échouer → pas de "vraie" distance
    // fausse, et surtout pas un trajet centre-à-centre présenté comme mesuré.
    if let b = best, b.score >= Self.minScore { return .hit(b) }
    if let why = unreachable { return .unreachable(why) }
    return .unusable(best?.score)
  }

  private func buildAddressVariants(_ address: String) -> [String] {
    var variants = [String]()
    var seen = Set<String>()
    func add(_ s: String) {
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !t.isEmpty, !seen.contains(t) else { return }
      seen.insert(t); variants.append(t)
    }

    let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
    add(trimmed)
    if let head = Self.placeHead(trimmed) { add(head) }

    // Strip trailing ", France/Belgique/etc."
    let stripPattern = #",\s*(France|Belgique|Suisse|Luxembourg|Deutschland|España|Italia|Portugal|Ireland|Nederland)\s*$"#
    if let regex = try? NSRegularExpression(pattern: stripPattern, options: .caseInsensitive) {
      let range = NSRange(trimmed.startIndex..., in: trimmed)
      let stripped = regex.stringByReplacingMatches(in: trimmed, range: range, withTemplate: "")
      add(stripped)
    }

    // Postal + ville (5-digit postal usually)
    if let regex = try? NSRegularExpression(pattern: #"\b(\d{4,5})\s+([A-Za-zÀ-ÿ][\w\s\-]{2,40})"#),
       let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
       match.numberOfRanges >= 3,
       let r1 = Range(match.range(at: 1), in: trimmed),
       let r2 = Range(match.range(at: 2), in: trimmed) {
      add("\(trimmed[r1]) \(trimmed[r2])")
    }
    return variants
  }

  private func geocode(_ address: String) -> GeocodeOutcome {
    // Cache local — les coords GPS d'une adresse sont stables dans le temps.
    // Hit cache → 0 requête TomTom. Voir GeocodeCache pour la normalisation.
    if let cached = GeocodeCache.shared.get(address: address) { return .hit(cached) }

    guard let key = apiKey() else { return .unusable(nil) }
    guard let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
    else { return .unusable(nil) }

    let urlString = "\(Self.baseSearch)/\(encoded).json?key=\(key)&language=\(geocodeLanguage)&countrySet=\(activeCountrySet)&limit=1"
    guard let url = URL(string: urlString) else { return .unusable(nil) }
    // La distinction porte ici : pas de réponse = réseau, réponse illisible =
    // adresse. Confondre les deux, c'est dire « recapture » à quelqu'un qui est
    // simplement dans un parking souterrain.
    let reply = httpGet(url)
    guard let data = reply.data else { return .unreachable(reply.failure) }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let results = json["results"] as? [[String: Any]],
          let first = results.first,
          let pos = first["position"] as? [String: Any],
          let lat = (pos["lat"] as? NSNumber)?.doubleValue,
          let lon = (pos["lon"] as? NSNumber)?.doubleValue
    else { return .unusable(nil) }
    let score = (first["score"] as? NSNumber)?.doubleValue ?? 0
    let formatted = (first["address"] as? [String: Any])?["freeformAddress"] as? String
    let hit = GeocodeHit(coords: Coords(lat: lat, lon: lon), score: score, formatted: formatted)
    // Persiste uniquement les résultats fiables — un faux match (score bas)
    // cacherait à vie un mauvais POI. Seuil aligné sur geocodeBestVariant.
    if score >= Self.minScore { GeocodeCache.shared.put(address: address, hit: hit) }
    return .hit(hit)
  }

  // MARK: - Routing

  private func getRoute(from: Coords, to: Coords) -> RouteOutcome {
    guard let key = apiKey() else { return .noKey }
    let waypoints = "\(from.lat),\(from.lon):\(to.lat),\(to.lon)"
    // traffic=true + departAt=now → trafic temps réel (flux live + incidents) à
    // l'instant du calcul ; routeType=fastest → meilleur trajet.
    let urlString = "\(Self.baseRouting)/\(waypoints)/json?key=\(key)&travelMode=car&traffic=true&routeType=fastest&departAt=now"
    guard let url = URL(string: urlString) else { return .unusable("route_api bad_url") }
    let reply = httpGet(url)
    guard let data = reply.data else { return .unreachable("route_api " + reply.failure) }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let routes = json["routes"] as? [[String: Any]],
          let summary = routes.first?["summary"] as? [String: Any],
          let seconds = (summary["travelTimeInSeconds"] as? NSNumber)?.doubleValue,
          let meters = (summary["lengthInMeters"] as? NSNumber)?.doubleValue
    else { return .unusable("route_api no_route") }

    return .ok(RouteResult(
      distanceKm: (meters / 100.0).rounded() / 10.0,
      durationMin: Int((seconds / 60.0).rounded()),
      pickupFormatted: nil, destFormatted: nil
    ))
  }

  // MARK: - HTTP helper

  /// Le corps d'une réponse 200 — ou, quand il manque, pourquoi : « timeout »,
  /// « offline », « cellular_off », « http429 », « net-1004 »… Ce motif part en
  /// `detail` de `route_unreachable`.
  private struct HttpReply {
    let data: Data?
    /// Lu seulement quand `data` est nil.
    let failure: String
  }

  private func httpGet(_ url: URL) -> HttpReply {
    var reply = HttpReply(data: nil, failure: "timeout")
    let semaphore = DispatchSemaphore(value: 0)
    var req = URLRequest(url: url)
    req.timeoutInterval = Self.timeoutSec
    URLSession.shared.dataTask(with: req) { data, response, error in
      defer { semaphore.signal() }
      if let http = response as? HTTPURLResponse {
        reply = http.statusCode == 200
          ? HttpReply(data: data, failure: "no_body")
          : HttpReply(data: nil, failure: "http\(http.statusCode)")
      } else {
        reply = HttpReply(data: nil, failure: TomTomService.networkFailure(error))
      }
    }.resume()
    // Filet : `timeoutInterval` ne borne que l'attente entre deux paquets.
    if semaphore.wait(timeout: .now() + Self.timeoutSec + 1) == .timedOut {
      return HttpReply(data: nil, failure: "timeout")
    }
    return reply
  }

  /// Nom court d'une erreur réseau. `cellular_off` = données cellulaires
  /// coupées pour Strive dans Réglages : le seul cas que le chauffeur règle
  /// lui-même, d'où un nom à part.
  private static func networkFailure(_ error: Error?) -> String {
    guard let code = (error as? URLError)?.code else { return "net" }
    switch code {
    case .timedOut: return "timeout"
    case .notConnectedToInternet: return "offline"
    case .dataNotAllowed: return "cellular_off"
    default: return "net\(code.rawValue)"
    }
  }
}

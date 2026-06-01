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
  private static let baseRouting = "https://api.tomtom.com/routing/1/calculateRoute"
  private static let countrySet  = "FR,BE,CH,LU,GB,DE,ES,IT,NL,PT,AT,IE,PL"
  private static let timeoutSec: TimeInterval = 4
  private static let minScore: Double = 3.0

  /// Stockée dans App Group par `ScanBridge.setTomTomApiKey`.
  private var cachedKey: String?

  private func apiKey() -> String? {
    if let k = cachedKey, !k.isEmpty { return k }
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let k = UserDefaults(suiteName: appGroupId)?.string(forKey: "tomTomApiKey")
    cachedKey = k
    return (k?.isEmpty == false) ? k : nil
  }

  var isReady: Bool { apiKey() != nil }

  struct Coords { let lat: Double; let lon: Double }
  struct GeocodeHit { let coords: Coords; let score: Double }
  struct RouteResult { let distanceKm: Double; let durationMin: Int }

  /// Calcule le trajet entre 2 adresses texte. Renvoie nil si TomTom n'est
  /// pas configuré, si une adresse est vide, ou si geocoding/routing échoue.
  func calculateRoute(
    pickupAddress: String,
    destinationAddress: String,
    completion: @escaping (RouteResult?) -> Void
  ) {
    guard isReady else { completion(nil); return }
    let pickup = pickupAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    let dest = destinationAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !pickup.isEmpty, !dest.isEmpty else { completion(nil); return }

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { completion(nil); return }
      // Geocoding pickup + destination en parallèle — divise par ~2 le temps
      // total. Chaque variant chain reste séquentiel à l'intérieur d'une
      // adresse (early-exit sur bon score), seuls les 2 fronts sont lancés.
      let group = DispatchGroup()
      var fromHit: GeocodeHit?
      var toHit: GeocodeHit?
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        fromHit = self.geocodeBestVariant(pickup)
        group.leave()
      }
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        toHit = self.geocodeBestVariant(dest)
        group.leave()
      }
      group.wait()

      guard let from = fromHit, let to = toHit else {
        completion(nil); return
      }
      let route = self.getRoute(from: from.coords, to: to.coords)
      DispatchQueue.main.async { completion(route) }
    }
  }

  // MARK: - Geocoding

  private func geocodeBestVariant(_ address: String) -> GeocodeHit? {
    var best: GeocodeHit?
    for variant in buildAddressVariants(address) {
      guard let hit = geocode(variant) else { continue }
      if best == nil || hit.score > best!.score { best = hit }
      if best!.score >= Self.minScore + 2 { return best }
    }
    return best
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

  private func geocode(_ address: String) -> GeocodeHit? {
    // Cache local — les coords GPS d'une adresse sont stables dans le temps.
    // Hit cache → 0 requête TomTom. Voir GeocodeCache pour la normalisation.
    if let cached = GeocodeCache.shared.get(address: address) { return cached }

    guard let key = apiKey(),
          let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
    else { return nil }

    let urlString = "\(Self.baseSearch)/\(encoded).json?key=\(key)&language=fr-FR&countrySet=\(Self.countrySet)&limit=1"
    guard let url = URL(string: urlString),
          let data = httpGet(url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let results = json["results"] as? [[String: Any]],
          let first = results.first,
          let pos = first["position"] as? [String: Any],
          let lat = (pos["lat"] as? NSNumber)?.doubleValue,
          let lon = (pos["lon"] as? NSNumber)?.doubleValue
    else { return nil }
    let score = (first["score"] as? NSNumber)?.doubleValue ?? 0
    let hit = GeocodeHit(coords: Coords(lat: lat, lon: lon), score: score)
    // Persiste uniquement les résultats fiables — un faux match (score bas)
    // cacherait à vie un mauvais POI. Seuil aligné sur geocodeBestVariant.
    if score >= Self.minScore { GeocodeCache.shared.put(address: address, hit: hit) }
    return hit
  }

  // MARK: - Routing

  private func getRoute(from: Coords, to: Coords) -> RouteResult? {
    guard let key = apiKey() else { return nil }
    let waypoints = "\(from.lat),\(from.lon):\(to.lat),\(to.lon)"
    // traffic=true + departAt=now → trafic temps réel (flux live + incidents) à
    // l'instant du calcul ; routeType=fastest → meilleur trajet.
    let urlString = "\(Self.baseRouting)/\(waypoints)/json?key=\(key)&travelMode=car&traffic=true&routeType=fastest&departAt=now"
    guard let url = URL(string: urlString),
          let data = httpGet(url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let routes = json["routes"] as? [[String: Any]],
          let summary = routes.first?["summary"] as? [String: Any],
          let seconds = (summary["travelTimeInSeconds"] as? NSNumber)?.doubleValue,
          let meters = (summary["lengthInMeters"] as? NSNumber)?.doubleValue
    else { return nil }

    return RouteResult(
      distanceKm: (meters / 100.0).rounded() / 10.0,
      durationMin: Int((seconds / 60.0).rounded())
    )
  }

  // MARK: - HTTP helper

  private func httpGet(_ url: URL) -> Data? {
    var result: Data?
    let semaphore = DispatchSemaphore(value: 0)
    var req = URLRequest(url: url)
    req.timeoutInterval = Self.timeoutSec
    URLSession.shared.dataTask(with: req) { data, response, _ in
      defer { semaphore.signal() }
      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
      result = data
    }.resume()
    _ = semaphore.wait(timeout: .now() + Self.timeoutSec + 1)
    return result
  }
}

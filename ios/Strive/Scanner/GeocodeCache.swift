import Foundation

/// Cache local des géocodes TomTom (iOS) — équivalent de `GeocodeCache.kt`.
/// Stocké dans App Group → partagé entre l'app principale, la Share Extension
/// et l'AppIntent (Shortcut). Les coords GPS d'une adresse étant stables, le
/// cache n'expire pas.
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.
final class GeocodeCache {

  static let shared = GeocodeCache()
  private init() {}

  private static let keyPrefix = "g:"

  private var defaults: UserDefaults? {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)
  }

  func get(address: String) -> TomTomService.GeocodeHit? {
    guard let dict = defaults?.dictionary(forKey: Self.keyPrefix + normalize(address)),
          let lat = dict["lat"] as? Double,
          let lon = dict["lon"] as? Double
    else { return nil }
    let score = (dict["score"] as? Double) ?? 0.0
    return TomTomService.GeocodeHit(
      coords: TomTomService.Coords(lat: lat, lon: lon),
      score: score
    )
  }

  func put(address: String, hit: TomTomService.GeocodeHit) {
    defaults?.set([
      "lat":   hit.coords.lat,
      "lon":   hit.coords.lon,
      "score": hit.score,
    ], forKey: Self.keyPrefix + normalize(address))
  }

  /// Normalisation identique à GeocodeCache.kt : lowercase, accents retirés,
  /// espaces multiples → 1 espace, trim. Maximise les cache hits cross-format
  /// ("Av. Champs-Élysées" ↔ "av. champs-elysees").
  private func normalize(_ s: String) -> String {
    let folded = s.folding(options: .diacriticInsensitive, locale: nil)
    let lowered = folded.lowercased()
    let collapsed = lowered.replacingOccurrences(
      of: "\\s+", with: " ", options: .regularExpression
    )
    return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

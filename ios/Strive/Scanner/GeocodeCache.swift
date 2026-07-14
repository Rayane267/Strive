import Foundation

/// Cache local des géocodes TomTom (iOS) — équivalent de `GeocodeCache.kt`.
/// Stocké dans App Group → partagé entre l'app principale, la Share Extension
/// et l'AppIntent (Shortcut).
///
/// ⚠️ Les clés contiennent des ADRESSES (données personnelles des passagers).
/// Conformité RGPD (limitation de conservation) :
///   - TTL de 90 j (re-géocodage une fois après expiration — coût négligeable),
///   - `clear()` appelé au logout et à la suppression de compte (le cache vit
///     uniquement sur l'appareil, hors de portée de la RPC delete_account).
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.
final class GeocodeCache {

  static let shared = GeocodeCache()
  private init() {}

  // v2 : ajout du libellé canonique `formatted`. Bump du préfixe → les entrées
  // v1 (sans formatted) sont ignorées et re-géocodées une fois (avec formatted).
  private static let keyPrefix = "g2:"

  /// Durée de vie d'une entrée. Les coords GPS sont stables, mais on ne conserve
  /// pas une adresse de passager indéfiniment (RGPD). 90 jours = compromis entre
  /// taux de cache hit et minimisation.
  private static let ttlSeconds: TimeInterval = 90 * 24 * 3600

  private var defaults: UserDefaults? {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)
  }

  func get(address: String) -> TomTomService.GeocodeHit? {
    let key = Self.keyPrefix + normalize(address)
    guard let dict = defaults?.dictionary(forKey: key),
          let lat = dict["lat"] as? Double,
          let lon = dict["lon"] as? Double
    else { return nil }
    // TTL : entrée expirée — ou legacy sans `savedAt` — → purge + cache miss
    // (re-géocodée et ré-horodatée au prochain put).
    let savedAt = (dict["savedAt"] as? Double) ?? 0
    if savedAt <= 0 || Date().timeIntervalSince1970 - savedAt > Self.ttlSeconds {
      defaults?.removeObject(forKey: key)
      return nil
    }
    let score = (dict["score"] as? Double) ?? 0.0
    return TomTomService.GeocodeHit(
      coords: TomTomService.Coords(lat: lat, lon: lon),
      score: score,
      formatted: dict["formatted"] as? String
    )
  }

  func put(address: String, hit: TomTomService.GeocodeHit) {
    var entry: [String: Any] = [
      "lat":     hit.coords.lat,
      "lon":     hit.coords.lon,
      "score":   hit.score,
      "savedAt": Date().timeIntervalSince1970,
    ]
    if let f = hit.formatted { entry["formatted"] = f }
    defaults?.set(entry, forKey: Self.keyPrefix + normalize(address))
  }

  /// Efface TOUTES les entrées de géocodage (adresses = PII). Appelé au logout
  /// et après suppression de compte → l'effacement couvre aussi le cache local,
  /// que la RPC serveur `delete_account` ne peut pas atteindre.
  func clear() {
    guard let defaults = defaults else { return }
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.keyPrefix) {
      defaults.removeObject(forKey: key)
    }
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

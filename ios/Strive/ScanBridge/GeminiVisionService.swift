import UIKit
import Foundation

/// Fallback Gemini Vision — même logique que GeminiVisionService.kt côté Android
final class GeminiVisionService {

  static let shared = GeminiVisionService()
  private init() {}

  /// Clé API directe (dev uniquement)
  var apiKey: String?

  /// Edge function Supabase (prod — la clé Gemini reste côté serveur)
  var edgeFunctionUrl: String?
  var supabaseAnonKey: String?

  /// JWT user — requis par l'edge function durcie (rate-limit + audit).
  var supabaseUserJwt: String?

  /// Session dédiée : `URLRequest.timeoutInterval` ne borne que l'INACTIVITÉ
  /// (le compteur repart à chaque paquet), pas la durée totale. Seul
  /// `timeoutIntervalForResource` pose un plafond mur-à-mur — indispensable
  /// pour tenir sous le sémaphore de 25 s de `AnalyzeRideIntent`.
  ///
  /// `waitsForConnectivity = false` : hors réseau (parking souterrain, tunnel —
  /// là où le chauffeur attend justement des courses), on échoue immédiatement
  /// au lieu d'attendre le retour de la connexion jusqu'au plafond.
  ///
  /// `ephemeral` : ni cache disque ni cookies pour un POST one-shot qui
  /// transporte une image.
  private static let session: URLSession = {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = 10
    cfg.timeoutIntervalForResource = 12
    cfg.waitsForConnectivity = false
    return URLSession(configuration: cfg)
  }()

  struct GeminiResult {
    let platform: String   // UBER, BOLT, HEETCH, UNKNOWN
    let fare: Double
    let distanceKm: Double
    let durationMin: Int?
    let pickupAddress: String?
    let destinationAddress: String?
    /// Trajet d'approche (chauffeur → client) lu à l'écran ("à 6 min (1,2 km)").
    /// Nécessaire pour que la préférence `includePickup` ait un effet sur ce
    /// chemin : sans ces valeurs, computeFinal ignore le réglage.
    let pickupDurationMin: Int?
    let pickupDistanceKm: Double?

    /// Conversion vers le modèle partagé consommé par `ScanProcessor.computeFinal`
    /// et `ScanResultModel.copy(...)`. Permet à la Share Extension d'utiliser ce
    /// service directement, au lieu de la copie `GeminiVisionServiceLight` qui
    /// avait divergé (prompt, bornes de validation).
    var asScanResult: ScanResultModel {
      ScanResultModel(
        platform: ScanPlatform(rawValue: platform) ?? .UNKNOWN,
        fare: fare,
        distanceKm: distanceKm,
        durationMin: durationMin,
        pickupAddress: pickupAddress,
        destinationAddress: destinationAddress,
        pickupDurationMin: pickupDurationMin,
        pickupDistanceKm: pickupDistanceKm
      )
    }
  }

  /// Analyse une image de course VTC via Gemini 2.5 Flash
  func analyze(
    image: UIImage,
    completion: @escaping (GeminiResult?) -> Void
  ) {
    // Redimensionner à 512px de large max
    let maxWidth: CGFloat = 512
    let scaledImage: UIImage
    if image.size.width > maxWidth {
      let scale = maxWidth / image.size.width
      let newSize = CGSize(width: maxWidth, height: image.size.height * scale)
      UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
      image.draw(in: CGRect(origin: .zero, size: newSize))
      scaledImage = UIGraphicsGetImageFromCurrentImageContext() ?? image
      UIGraphicsEndImageContext()
    } else {
      scaledImage = image
    }

    guard let jpegData = scaledImage.jpegData(compressionQuality: 0.8) else {
      completion(nil)
      return
    }
    let base64 = jpegData.base64EncodedString()

    // Construire la requête
    let url: URL
    let request: URLRequest

    if let edgeUrl = edgeFunctionUrl, let anonKey = supabaseAnonKey,
       let edgeURL = URL(string: edgeUrl) {
      // Mode prod : proxy Supabase edge function
      url = edgeURL
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      // JWT user si dispo (edge function durcie l'exige), sinon anon key.
      let bearer: String
      if let jwt = supabaseUserJwt, !jwt.isEmpty {
        bearer = jwt
      } else {
        bearer = anonKey
      }
      req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
      req.setValue(anonKey, forHTTPHeaderField: "apikey")
      // L'edge function durcie n'accepte QUE le format natif Gemini
      // (`contents[].parts[]`) — cf. isValidGeminiPayload dans gemini-proxy.
      // Doit rester aligné avec geminiFallback.ts et le ShareExtension.
      req.httpBody = try? JSONSerialization.data(withJSONObject: [
        "contents": [[
          "parts": [
            ["inline_data": ["mime_type": "image/jpeg", "data": base64]],
            ["text": Self.prompt],
          ]
        ]],
        "generationConfig": Self.generationConfig,
      ])
      request = req
    } else if let key = apiKey,
              let directURL = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)") {
      // Mode dev : appel direct Gemini
      url = directURL
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try? JSONSerialization.data(withJSONObject: [
        "contents": [[
          "parts": [
            ["text": Self.prompt],
            ["inline_data": [
              "mime_type": "image/jpeg",
              "data": base64,
            ]],
          ]
        ]],
        "generationConfig": Self.generationConfig,
      ])
      request = req
    } else {
      completion(nil)
      return
    }

    Self.session.dataTask(with: request) { data, _, error in
      guard error == nil, let data = data else {
        DispatchQueue.main.async { completion(nil) }
        return
      }
      let result = Self.parseResponse(data)
      DispatchQueue.main.async { completion(result) }
    }.resume()
  }

  // MARK: - Private

  /// Lecture d'écran structurée : aucun raisonnement à produire. Sans
  /// `generationConfig`, gemini-2.5-flash déclenche son « thinking » dynamique et
  /// ajoute plusieurs secondes de latence — inacceptable sur ce chemin, où la
  /// carte déployée ne reste affichée que ~6 s (limite iOS) et où le fallback
  /// est déjà le chemin le plus lent. Budget de réflexion à zéro, sortie JSON
  /// stricte et bornée. À garder aligné avec `geminiFallback.ts`.
  private static let generationConfig: [String: Any] = [
    "thinkingConfig": ["thinkingBudget": 0],
    "responseMimeType": "application/json",
    "temperature": 0,
    "maxOutputTokens": 512,
  ]

  private static let prompt = """
  Analyse cette capture d'écran d'une offre de course VTC (Uber, Bolt ou Heetch).
  Règle 1 : l'adresse de DÉPART (pickup) est TOUJOURS la première affichée en haut ; la DESTINATION est TOUJOURS en dessous.
  Règle 2 : ne confonds JAMAIS une ligne stat ("Course de 11.8 km", "à 6 min (1.2 km)") avec une adresse.
  Retourne UNIQUEMENT un objet JSON avec ces champs :
  {
    "platform": "UBER" | "BOLT" | "HEETCH" | "UNKNOWN",
    "fare": <montant en euros, ex: 12.50>,
    "distance_km": <distance de la COURSE en km, ex: 11.8>,
    "duration_min": <durée de la course en minutes ou null si non visible>,
    "pickup_address": <adresse de départ exacte lue à l'écran, string ou null>,
    "destination_address": <adresse de destination exacte lue à l'écran, string ou null>,
    "pickup_eta_min": <durée du trajet d'APPROCHE (chauffeur → client) en minutes, ou null si non visible>,
    "pickup_distance_km": <distance du trajet d'APPROCHE en km, ou null si non visible>
  }
  IMPORTANT : distance_km = la distance TOTALE de la course (parfois affichée "Course de X km").
  Ne PAS confondre avec la distance d'approche pickup ("X min • Y km", ou "à X min (Y km)" sous l'adresse de prise en charge) : celle-ci va dans pickup_eta_min / pickup_distance_km.
  Extrais les adresses EXACTES lues à l'écran (ne devine pas). Ne retourne rien d'autre que le JSON.
  """

  private static func parseResponse(_ data: Data) -> GeminiResult? {
    // Extraire le texte de la réponse Gemini
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }

    var text: String?

    // Réponse directe Gemini API
    if let candidates = json["candidates"] as? [[String: Any]],
       let content = candidates.first?["content"] as? [String: Any],
       let parts = content["parts"] as? [[String: Any]],
       let partText = parts.first?["text"] as? String {
      text = partText
    }
    // Réponse via edge function proxy
    else if let result = json["result"] as? String {
      text = result
    }

    guard let responseText = text else { return nil }

    // Extraire le JSON de la réponse (peut contenir du markdown ```json ... ```)
    //
    // Intervalle SEMI-OUVERT (`..<`). `end.upperBound` est la position qui SUIT
    // l'accolade fermante : avec un intervalle fermé, Swift lisait un caractère
    // au-delà, et quand le `}` terminait la chaîne — le cas nominal, puisqu'on
    // demande `responseMimeType: application/json` — cette position valait
    // `endIndex`. Le runtime tuait alors le process (EXC_BREAKPOINT dans
    // `String.index(after:)`), en plein callback URLSession : le raccourci
    // rapportait « Strive a quitté inopinément » à chaque recours à Gemini.
    //
    // Bornes revalidées avant la découpe : `range(of:)` cherche les deux
    // accolades indépendamment, rien ne garantit que la fermante suive
    // l'ouvrante. Sur une réponse tronquée ou inattendue (« } … { »), l'ordre
    // s'inverse et un intervalle inversé est, lui aussi, une erreur fatale.
    // Aucune forme de réponse ne doit pouvoir faire tomber le process : ici on
    // rend `nil`, et l'appelant traite l'échec Gemini comme tel.
    guard let start = responseText.range(of: "{"),
          let end = responseText.range(of: "}", options: .backwards),
          start.lowerBound < end.upperBound
    else { return nil }
    let jsonString = String(responseText[start.lowerBound..<end.upperBound])

    guard let parsed = try? JSONSerialization.jsonObject(
      with: Data(jsonString.utf8)
    ) as? [String: Any] else {
      return nil
    }

    guard let platform = parsed["platform"] as? String,
          let fare = (parsed["fare"] as? NSNumber)?.doubleValue,
          let distanceKm = (parsed["distance_km"] as? NSNumber)?.doubleValue
    else { return nil }

    let durationMin = (parsed["duration_min"] as? NSNumber)?.intValue

    // Sanity bounds (mêmes que Android) + ratio plausible : rejette une distance
    // hallucinée minuscule → €/km démentiel. Mirror JS / Android.
    let ratio = distanceKm > 0 ? fare / distanceKm : .infinity
    guard fare >= 8, fare <= 200,
          distanceKm >= 0.3, distanceKm <= 500,
          ratio >= 0.2, ratio <= 15
    else { return nil }

    func cleanAddr(_ key: String) -> String? {
      guard let s = (parsed[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !s.isEmpty, s.lowercased() != "null" else { return nil }
      return s
    }

    // Approche : mêmes bornes que OcrParser.extractPickupInfo (1–60 min,
    // 0,1–30 km, toujours plus courte que la course) → on rejette en bloc si
    // l'une des deux est absente ou aberrante, sinon le total serait faux.
    var pickupMin = (parsed["pickup_eta_min"] as? NSNumber)?.intValue
    var pickupKm = (parsed["pickup_distance_km"] as? NSNumber)?.doubleValue
    if let m = pickupMin, let k = pickupKm,
       m >= 1, m <= 60, k >= 0.1, k <= 30.0, k < distanceKm {
      // valeurs plausibles → conservées
    } else {
      pickupMin = nil
      pickupKm = nil
    }

    return GeminiResult(
      platform: platform,
      fare: fare,
      distanceKm: distanceKm,
      durationMin: durationMin,
      pickupAddress: cleanAddr("pickup_address"),
      destinationAddress: cleanAddr("destination_address"),
      pickupDurationMin: pickupMin,
      pickupDistanceKm: pickupKm
    )
  }
}

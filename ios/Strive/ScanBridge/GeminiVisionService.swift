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

  struct GeminiResult {
    let platform: String   // UBER, BOLT, HEETCH, UNKNOWN
    let fare: Double
    let distanceKm: Double
    let durationMin: Int?
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
        ]]
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
        ]]
      ])
      request = req
    } else {
      completion(nil)
      return
    }

    URLSession.shared.dataTask(with: request) { data, _, error in
      guard error == nil, let data = data else {
        DispatchQueue.main.async { completion(nil) }
        return
      }
      let result = Self.parseResponse(data)
      DispatchQueue.main.async { completion(result) }
    }.resume()
  }

  // MARK: - Private

  private static let prompt = """
  Analyse cette capture d'écran d'une offre de course VTC (Uber, Bolt ou Heetch).
  Retourne UNIQUEMENT un objet JSON avec ces champs :
  {
    "platform": "UBER" | "BOLT" | "HEETCH" | "UNKNOWN",
    "fare": <montant en euros, ex: 12.50>,
    "distance_km": <distance de la COURSE en km, ex: 11.8>,
    "duration_min": <durée de la course en minutes ou null si non visible>
  }
  IMPORTANT : distance_km = la distance TOTALE de la course (parfois affichée "Course de X km").
  Ne PAS confondre avec la distance d'approche pickup ("X min • Y km", ou "à X min (Y km)" sous l'adresse de prise en charge).
  Ne retourne rien d'autre que le JSON.
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
    let jsonString: String
    if let start = responseText.range(of: "{"),
       let end = responseText.range(of: "}", options: .backwards) {
      jsonString = String(responseText[start.lowerBound...end.upperBound])
    } else {
      return nil
    }

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
    guard fare >= 3, fare <= 200,
          distanceKm >= 0.3, distanceKm <= 1000,
          ratio >= 0.2, ratio <= 15
    else { return nil }

    return GeminiResult(
      platform: platform,
      fare: fare,
      distanceKm: distanceKm,
      durationMin: durationMin
    )
  }
}

import UIKit
import Vision

/// Orchestre l'analyse complète d'un screenshot — mirror du `triggerScan` →
/// `runOcr` → `resolveTomTomAndEmit` côté Android (FloatingBubbleService.kt).
///
/// Flow identique :
///  1. Vision OCR → blocs
///  2. OcrParser.parse → ScanResult provisoire (avec adresses)
///  3. Live Activity démarrée immédiatement avec valeurs OCR
///  4. TomTom (geocode + routing) en background
///  5. Live Activity mise à jour avec valeurs TomTom + verdict final
///  6. Si TomTom échoue → on garde les valeurs OCR (fallback identique Android)
///
/// Target Membership Xcode : `Strive` + `StriveShareExtension`.
final class ScanProcessor {

  static let shared = ScanProcessor()
  private init() {}

  private var scanInProgress = false

  /// Anti double-tap CROSS-PROCESS : refuse un scan déclenché moins de
  /// `cooldownSec` après le précédent. `scanInProgress` ne suffit pas car chaque
  /// scan (AppIntent AssistiveTouch / Share Extension) tourne dans SON process —
  /// le flag n'est pas partagé. On sérialise via un horodatage dans l'App Group.
  /// Renvoie true s'il faut IGNORER ce scan (quota préservé, pas de doublon).
  static func shouldThrottleRapidScan(cooldownSec: Double = 3.0) -> Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let defaults = UserDefaults(suiteName: appGroupId) else { return false }
    let now = Date().timeIntervalSince1970

    // 1. Un scan est-il déjà en cours ? Le simple délai ci-dessous ne suffisait
    //    pas : le pipeline dure 5 à 20 s (OCR + TomTom + Gemini), donc un appui
    //    5 s après le premier lançait un second pipeline complet en parallèle —
    //    deux appels payants, deux courses, pour une seule offre à l'écran.
    //    Le plafond de 30 s libère le verrou si un scan s'est interrompu
    //    (process tué, crash) : le watchdog de l'AppIntent est à 25 s.
    let startedAt = defaults.double(forKey: "scanInProgressSince")
    if startedAt > 0, now - startedAt < 30 { return true }

    // 2. Anti double-tap : deux appuis rapprochés sur le même bouton.
    let last = defaults.double(forKey: "lastScanAttemptAt")
    if last > 0, now - last < cooldownSec { return true }

    defaults.set(now, forKey: "lastScanAttemptAt")
    defaults.set(now, forKey: "scanInProgressSince")
    return false
  }

  /// Libère le verrou posé par `shouldThrottleRapidScan`. À appeler sur TOUS les
  /// chemins de sortie du pipeline — succès comme échec — sinon le prochain scan
  /// attend l'expiration des 30 s.
  static func markScanFinished() {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    UserDefaults(suiteName: appGroupId)?.removeObject(forKey: "scanInProgressSince")
  }

  /// Vrai si le dernier OCR justifie un appel Gemini (signaux d'offre de course
  /// détectés, OU aucun texte lu = bénéfice du doute). Faux uniquement quand
  /// l'OCR a lu du texte mais sans aucun signal VTC (pub / écran quelconque) →
  /// les callers évitent alors un appel Gemini payant inutile.
  private(set) var lastScanMayBeRide = true

  /// Blocs OCR du dernier scan, sérialisés (cf. `OcrParser.dumpBlocks`) — matière
  /// de diagnostic pour reproduire en fixture les captures où le parser rate une
  /// adresse. Miroir du `debugBlocks` Android, jusqu'ici absent côté iOS : la
  /// table `scan_debug` ne recevait donc jamais rien depuis un iPhone.
  ///
  /// Remis à nil au début de chaque scan pour ne jamais associer les blocs d'une
  /// capture au résultat d'une autre (les 3 process partagent ce singleton).
  private(set) var lastBlocksJson: String?
  /// Hauteur en pixels de l'image analysée — les positions Y des blocs n'ont de
  /// sens qu'avec elle (écrans de tailles différentes).
  private(set) var lastScreenHeight: Int = 0

  struct FinalResult {
    let scan: ScanResultModel
    let hourlyRate: Double
    let kmRate: Double
    let totalDurationMin: Int
    let totalDistanceKm: Double
    let verdictLevel: Int
    /// Tarif À AFFICHER : net du carburant estimé si la préférence
    /// « retirer le carburant du prix » est active, sinon égal à `scan.fare`.
    /// Volontairement séparé — `scan.fare` reste le tarif brut, celui qui part en
    /// base et qui sert au calcul des €/h, €/km et du verdict.
    let displayFare: Double
  }

  /// Lance le pipeline complet sur l'image. Le callback `onFinal` n'est appelé
  /// qu'UNE seule fois, avec le résultat final (TomTom OK, fallback OCR, ou nil
  /// si OCR n'a rien trouvé). Le caller n'a pas à gérer d'état provisoire — la
  /// bulle/Live Activity reste en loading jusqu'à cet appel.
  func process(
    image: UIImage,
    onFinal: @escaping (FinalResult?) -> Void
  ) {
    guard !scanInProgress else {
      NSLog("[Strive:Scan] scan already in progress — skipped")
      onFinal(nil)
      return
    }
    scanInProgress = true
    // Remote config du parser (ancres de prix/distance + bornes de sanity).
    Self.applyRemoteParserConfigIfNeeded()
    // Purge : sans ça, un scan dont l'OCR ne rend rien conserverait les blocs du
    // scan précédent et les enverrait avec le mauvais résultat.
    lastBlocksJson = nil
    lastScreenHeight = 0

    // Garde-fou anti-deadlock : `gate` garantit (1) un seul appel à onFinal,
    // (2) le reset systématique de scanInProgress, (3) un watchdog qui libère
    // le scanner même si Vision/TomTom ne rend jamais la main (sinon le flag
    // restait `true` à vie → tous les scans suivants ignorés jusqu'au reboot).
    let gate = CompletionGuard { [weak self] result in
      self?.scanInProgress = false
      onFinal(result)
    }
    let watchdog = DispatchWorkItem { gate.fire(nil) }
    gate.watchdog = watchdog
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 20, execute: watchdog)

    runOcr(image: image) { [weak self] blocks, screenW, screenH in
      guard let self = self else { gate.fire(nil); return }
      guard let blocks = blocks else {
        // Aucun texte lu : on laisse Gemini tenter sur l'image (bénéfice du doute).
        self.lastScanMayBeRide = true
        gate.fire(nil); return
      }

      // Pré-filtre anti-pub : du texte a été lu — ressemble-t-il à une course ?
      self.lastScanMayBeRide = Self.looksLikeRideOffer(
        blocks.map { $0.text }.joined(separator: "\n")
      )

      // Matière de diagnostic (cf. lastBlocksJson) — capturée AVANT le parse pour
      // être disponible même si celui-ci échoue.
      self.lastBlocksJson = OcrParser.dumpBlocks(blocks)
      self.lastScreenHeight = screenH

      // Parsing identique à Android
      guard let result = OcrParser.shared.parse(
        blocks: blocks, screenWidth: screenW, screenHeight: screenH, image: image
      ) else {
        gate.fire(nil); return
      }

      // TomTom — uniquement si on a 2 adresses et la clé est configurée
      let pickup = result.pickupAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let dest = result.destinationAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if pickup.isEmpty || dest.isEmpty || !TomTomService.shared.isReady {
        gate.fire(self.computeFinal(scan: result))
        return
      }

      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        guard let route = route,
              route.distanceKm >= 0.3,
              route.distanceKm <= 500,
              route.durationMin <= 300 else {
          gate.fire(self.computeFinal(scan: result))
          return
        }

        let ratio = result.fare / route.distanceKm
        guard ratio >= 0.2 && ratio <= 12.0 else {
          gate.fire(self.computeFinal(scan: result))
          return
        }

        // Affiche les adresses canoniques TomTom (propres) plutôt que le texte
        // OCR bruité (ex: "All AV. … Çueue") — fallback OCR si TomTom n'en fournit pas.
        let updated = result.copy(
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          pickupAddress: route.pickupFormatted,
          destinationAddress: route.destFormatted
        )
        gate.fire(self.computeFinal(scan: updated))
      }
    }
  }

  /// Dernière config appliquée dans CE process (hash du JSON). Le hash de String
  /// est re-graine à chaque lancement : il ne vaut que pour comparer deux valeurs
  /// au sein d'une même exécution, ce qui est exactement l'usage ici.
  private static var appliedConfigHash: Int?

  /// Applique la remote config du parser poussée par le JS (`setParserConfig` →
  /// App Group). Sans cet appel, le JSON était écrit et JAMAIS relu : ancres de
  /// prix, ancres de distance et bornes de sanity restaient figées aux valeurs
  /// compilées, et un parsing cassé en production ne pouvait pas être corrigé à
  /// distance sur iPhone (Android, lui, applique la config dans son bridge).
  ///
  /// Appelé ici plutôt que dans le bridge : le parsing tourne dans TROIS process
  /// (app, Share Extension, AppIntent) et le bridge n'existe que dans le premier
  /// — qui est justement celui qui ne parse presque jamais.
  private static func applyRemoteParserConfigIfNeeded() {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let json = UserDefaults(suiteName: appGroupId)?.string(forKey: "parserConfig"),
          !json.isEmpty else { return }
    let hash = json.hashValue
    guard hash != appliedConfigHash else { return }
    appliedConfigHash = hash
    OcrParser.shared.updateConfig(json)
  }

  /// Heuristique légère exécutée sur le texte OCR brut : l'écran ressemble-t-il
  /// à une offre VTC ? Sert à court-circuiter le fallback Gemini (coût) quand
  /// l'utilisateur scanne une pub ou un écran sans rapport.
  /// Permissive volontairement : un faux positif coûte un appel Gemini, un faux
  /// négatif fait rater une course → on privilégie de laisser passer.
  static func looksLikeRideOffer(_ rawText: String) -> Bool {
    let text = rawText.lowercased()
    let hasPlatform = text.contains("uber") || text.contains("bolt") || text.contains("heetch")
    // Mots-clés FR + EN (l'app et les apps VTC peuvent être dans les 2 langues).
    let hasRideWords = [
      // FR
      "course", "trajet", "prise en charge", "dépose", "gains", "accepter", "min de marche",
      // EN
      "trip", "ride", "pickup", "pick-up", "drop-off", "dropoff", "earnings", "accept", "min walk",
    ].contains { text.contains($0) }
    let hasPrice = text.range(of: #"\d{1,3}[.,]\d{2}\s*€"#, options: .regularExpression) != nil
      || text.range(of: #"€\s*\d"#, options: .regularExpression) != nil
    let hasKm = text.range(of: #"\d[\d.,]*\s*km"#, options: .regularExpression) != nil
    let hasMin = text.range(of: #"\d+\s*min"#, options: .regularExpression) != nil
    return hasPlatform || hasRideWords || (hasPrice && (hasKm || hasMin))
  }

  /// Fallback durée quand l'OCR n'a pas pu lire le `min` de la course.
  /// Heuristique vitesse moyenne par tranche de distance — calibration FR/EU.
  /// À garder en sync avec `FloatingBubbleService.kt::estimateDurationMin`
  /// et `DashboardScreen.tsx::estimateDurationMin`.
  private static func estimateDurationMin(distanceKm: Double) -> Double {
    switch distanceKm {
    case ..<5:  return distanceKm / 25.0 * 60.0   // urbain dense
    case ..<20: return distanceKm / 45.0 * 60.0   // mixte ville/péri
    default:    return distanceKm / 60.0 * 60.0   // péri-urbain / autoroute
    }
  }

  // MARK: - Calcul rentabilité + verdict (identique Android)

  /// Exposé (non-private) pour permettre au fallback Gemini de l'AppIntent de
  /// construire un FinalResult à partir d'un ScanResultModel reconstitué.
  func computeFinal(scan: ScanResultModel) -> FinalResult {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let prefs = UserDefaults(suiteName: appGroupId)
    // `object(forKey:) as? Double` et NON `double(forKey:) ?? …` : ce dernier
    // renvoie 0.0 quand la clé est absente (l'optionnel ne porte que sur
    // `prefs`), le défaut n'était donc JAMAIS appliqué. Seuils à 0 = tout est
    // rentable → verdict vert sur n'importe quelle course tant que le JS n'a pas
    // encore poussé les préférences (installation fraîche, scan via le Share
    // Sheet avant la première ouverture du Dashboard).
    let minHourly = (prefs?.object(forKey: "minHourlyRate") as? Double) ?? 25.0
    let minKm = (prefs?.object(forKey: "minKmRate") as? Double) ?? 1.2
    let includePickup = prefs?.object(forKey: "includePickup") as? Bool ?? true

    let useApproach = includePickup
      && scan.pickupDurationMin != nil
      && scan.pickupDistanceKm != nil

    // courseDuration : OCR ou estimé via heuristique vitesse selon distance
    // (cf. estimateDurationMin — calibration FR/EU urbain/mixte/autoroute).
    let courseDuration = scan.durationMin.map { Double($0) }
      ?? Self.estimateDurationMin(distanceKm: scan.distanceKm)

    let totalDuration = useApproach
      ? courseDuration + Double(scan.pickupDurationMin ?? 0)
      : courseDuration

    let totalDistance = useApproach
      ? scan.distanceKm + (scan.pickupDistanceKm ?? 0)
      : scan.distanceKm

    let hourlyRate = totalDuration > 0 ? scan.fare / (totalDuration / 60.0) : 0
    let kmRate = totalDistance > 0 ? scan.fare / totalDistance : 0

    let hrOk = hourlyRate >= minHourly
    let kmOk = kmRate >= minKm
    let level = (hrOk && kmOk) ? 2 : ((hrOk || kmOk) ? 1 : 0)

    // Affichage seul : le verdict ci-dessus est calculé sur le tarif brut, les
    // seuils de l'utilisateur gardent donc le sens qu'ils ont toujours eu.
    // `fuelCostPerKm` est poussé pré-calculé par le JS (conso × prix du jour) —
    // le natif n'a ni le type de carburant ni le tarif à la pompe. 0 = pas de
    // consommation renseignée, donc rien à déduire.
    let deductFuel = prefs?.bool(forKey: "deductFuel") ?? false
    let fuelCostPerKm = prefs?.double(forKey: "fuelCostPerKm") ?? 0
    let displayFare = (deductFuel && fuelCostPerKm > 0)
      ? max(0, scan.fare - fuelCostPerKm * totalDistance)
      : scan.fare

    return FinalResult(
      scan: scan,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      totalDurationMin: Int(totalDuration.rounded()),
      totalDistanceKm: totalDistance,
      verdictLevel: level,
      displayFare: displayFare
    )
  }

  // MARK: - Vision OCR

  private func runOcr(
    image: UIImage,
    completion: @escaping ([OcrTextBlock]?, Int, Int) -> Void
  ) {
    guard let cgImage = image.cgImage else { completion(nil, 0, 0); return }
    let imageWidth = Int(cgImage.width)
    let imageHeight = Int(cgImage.height)

    let request = VNRecognizeTextRequest { req, _ in
      guard let observations = req.results as? [VNRecognizedTextObservation], !observations.isEmpty else {
        completion(nil, imageWidth, imageHeight); return
      }

      // Convertit chaque observation en OcrTextBlock avec bbox absolu top-left.
      // Vision : bbox normalisé [0;1], origin bottom-left → on flip Y.
      var blocks: [OcrTextBlock] = []
      for obs in observations {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }
        // Levier 2 : on jette le bruit OCR très basse confiance (< 0.3). En mode
        // .accurate, Vision score >0.5 pour du vrai texte d'écran ; sous 0.3 =
        // artefact illisible. Seuil volontairement TRÈS bas pour ne jamais
        // risquer d'évincer une vraie adresse — on coupe juste le bruit franc.
        if candidate.confidence < 0.3 { continue }
        let bbox = obs.boundingBox
        let left = Int(bbox.origin.x * CGFloat(imageWidth))
        let width = Int(bbox.width * CGFloat(imageWidth))
        let height = Int(bbox.height * CGFloat(imageHeight))
        let topNormalized = 1.0 - bbox.origin.y - bbox.height
        let top = Int(topNormalized * CGFloat(imageHeight))
        blocks.append(OcrTextBlock(
          text: text,
          box: OcrRect(left: left, top: top, right: left + width, bottom: top + height),
          confidence: candidate.confidence
        ))
      }
      completion(blocks, imageWidth, imageHeight)
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["fr-FR", "en-US"]
    request.usesLanguageCorrection = true

    DispatchQueue.global(qos: .userInitiated).async {
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do {
        try handler.perform([request])
      } catch {
        // perform() qui throw n'invoque PAS le completion du request → on doit
        // le rappeler manuellement, sinon scanInProgress resterait bloqué.
        completion(nil, imageWidth, imageHeight)
      }
    }
  }
}

// MARK: - Enregistrement immédiat de la course

/// Délégué minimal de la session de fond.
///
/// Une session de fond EXIGE un délégué — les variantes à completion handler
/// lèvent une exception. Mais on n'a rien à faire du résultat : la
/// réconciliation passe par l'outbox (cf. `RideUploader`). On se contente de
/// retirer le fichier de corps, que le démon système a fini de lire.
private final class RideUploadDelegate: NSObject, URLSessionDataDelegate {
  static let shared = RideUploadDelegate()

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let path = task.taskDescription {
      try? FileManager.default.removeItem(atPath: path)
    }
    if let error = error {
      NSLog("[Strive:Ride] upload de fond KO — %@", error.localizedDescription)
    } else if let http = task.response as? HTTPURLResponse,
              !(200...299).contains(http.statusCode), http.statusCode != 409 {
      // 409 = même (user_id, scan_ts) déjà en base : la course EST enregistrée.
      NSLog("[Strive:Ride] upload de fond refusé — HTTP %d", http.statusCode)
    }
  }
}

/// Écrit la course dans Supabase AU MOMENT DU SCAN, depuis le process qui l'a
/// analysée (Share Extension ou raccourci).
///
/// Ce que cet envoi N'EST PAS : la garantie de non-perte. Celle-ci tient
/// entièrement à l'outbox `pendingScanResults` — une entrée n'en sort que sur
/// `ackScan`, une fois la course confirmée en base. L'envoi ci-dessous ne fait
/// que raccourcir le délai, et son échec n'a aucune conséquence.
///
/// La version précédente échouait précisément dans le cas d'usage dominant.
/// Les deux causes, et ce qui les corrige :
///
///  • `URLSessionConfiguration.ephemeral` + `waitsForConnectivity = false` : la
///    requête mourait avec le process (le chauffeur referme le panneau de
///    partage pendant l'appel réseau) et abandonnait dès la première zone
///    blanche. On passe en session de FOND : le démon système porte le
///    transfert, attend le réseau et réessaie — extension tuée ou non.
///
///  • Le JWT lu dans l'App Group est déposé par le JS au dernier passage au
///    premier plan. Il est donc périmé dès que l'app n'a pas tourné depuis
///    l'expiration de l'access token — c'est-à-dire presque toujours, l'usage
///    visé étant le scan app fermée. Voir `currentCredential` : c'est le SEUL
///    point à changer pour passer à un jeton d'appareil frappé côté serveur.
///
/// Aucune complétion n'est exploitée : le drain de l'outbox à l'ouverture de
/// l'app retombera sur le doublon, qu'il traite comme un succès. Rien ne
/// circule entre les process — c'est ce qui a permis de supprimer le drapeau
/// `savedRemotely` et sa comptabilité.
enum RideUploader {

  private static var appGroupId: String {
    (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
  }

  /// UNE session de fond par process. Deux sessions ne peuvent pas partager un
  /// identifiant ; l'app et l'extension ayant des bundle id distincts, la
  /// collision entre les deux écrivains est impossible par construction.
  private static let session: URLSession = {
    let id = (Bundle.main.bundleIdentifier ?? "com.striveapp.app") + ".ride-upload"
    let cfg = URLSessionConfiguration.background(withIdentifier: id)
    // Obligatoire pour une session de fond lancée depuis une app extension :
    // c'est le répertoire où le démon lit le corps et dépose la réponse.
    cfg.sharedContainerIdentifier = appGroupId
    // `true` laisserait iOS choisir « un bon moment » (charge, wifi) — ce qui
    // peut vouloir dire des heures. La course doit partir dès que le réseau est là.
    cfg.isDiscretionary = false
    // Sans ça les événements de fin de transfert seraient perdus quand
    // l'extension est morte, et le transfert lui-même peut rester suspendu.
    cfg.sessionSendsLaunchEvents = true
    return URLSession(configuration: cfg, delegate: RideUploadDelegate.shared, delegateQueue: nil)
  }()

  /// Point d'entrée UNIQUE du credential.
  ///
  /// Aujourd'hui : le JWT déposé par l'app dans l'App Group. Sa durée de vie
  /// est celle de l'access token Supabase (réglage `JWT expiry` du projet) —
  /// c'est elle, et non ce code, qui détermine combien de temps un chauffeur
  /// peut scanner sans rouvrir l'app.
  ///
  /// Si la télémétrie montre des drains trop tardifs, la suite est un jeton
  /// d'appareil frappé par une edge function et rangé en Keychain : seule cette
  /// fonction change, le reste du fichier est indépendant de ce choix. La piste
  /// du refresh token a été écartée — Supabase fait tourner les refresh tokens
  /// à l'usage, et deux process qui rafraîchissent en même temps peuvent
  /// invalider la session, donc déconnecter le chauffeur en pleine tournée.
  private static func currentCredential(_ defaults: UserDefaults) -> (jwt: String, uid: String)? {
    guard let jwt = defaults.string(forKey: "supabaseUserJwt"), !jwt.isEmpty,
          let uid = userId(fromJwt: jwt)
    else { return nil }
    return (jwt, uid)
  }

  /// `sub` du JWT Supabase = id de l'utilisateur. Évite de plomber un réglage
  /// de plus dans l'App Group pour une valeur que le jeton porte déjà.
  private static func userId(fromJwt jwt: String) -> String? {
    let parts = jwt.split(separator: ".")
    guard parts.count >= 2 else { return nil }
    var b64 = String(parts[1])
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while b64.count % 4 != 0 { b64 += "=" }
    guard let data = Data(base64Encoded: b64),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return json["sub"] as? String
  }

  /// Répertoire des corps de requête, dans le container partagé (exigé par la
  /// session de fond lancée depuis une extension).
  private static func bodyDirectory() -> URL? {
    guard let container = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    else { return nil }
    let dir = container.appendingPathComponent("ride-uploads", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  /// Retire les corps de plus de 24 h. Le délégué nettoie le cas nominal ;
  /// ceux-ci sont les orphelins des transferts dont le process est mort avant
  /// la complétion. Sans ce balayage ils s'accumuleraient indéfiniment.
  private static func sweepStaleBodies(_ dir: URL) {
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
    ) else { return }
    let cutoff = Date().addingTimeInterval(-86_400)
    for f in files {
      let modified = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate
      if let modified = modified, modified < cutoff {
        try? FileManager.default.removeItem(at: f)
      }
    }
  }

  /// Programme l'écriture de la course. Retourne immédiatement : le transfert
  /// est confié au démon système et survit à la mort de ce process.
  static func upload(_ final: ScanProcessor.FinalResult, scanTs: Double) {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let restUrl = defaults.string(forKey: "supabaseRestUrl"), !restUrl.isEmpty,
          let anonKey = defaults.string(forKey: "geminiSupabaseKey"), !anonKey.isEmpty,
          let cred = currentCredential(defaults),
          let url = URL(string: "\(restUrl)/rest/v1/rides"),
          let dir = bodyDirectory()
    else { return }

    sweepStaleBodies(dir)

    // Carburant figé au moment du scan, comme côté JS. `fuelCostPerKm` est
    // poussé pré-calculé par l'app (conso × prix du jour) ; 0 = non renseigné,
    // on laisse alors les colonnes à NULL plutôt que d'écrire un faux zéro.
    let fuelCostPerKm = defaults.double(forKey: "fuelCostPerKm")
    let fuelCost: Double? = fuelCostPerKm > 0
      ? (fuelCostPerKm * final.totalDistanceKm * 100).rounded() / 100
      : nil

    var body: [String: Any] = [
      "user_id": cred.uid,
      // Même normalisation que `createRide` côté JS : la colonne n'accepte pas
      // UNKNOWN.
      "platform": final.scan.platform == .UNKNOWN ? "UBER" : final.scan.platform.rawValue,
      "status": "PENDING",
      // Tarif BRUT (displayFare n'est qu'un affichage) — cohérent avec les €/h.
      "fare_estimated": final.scan.fare,
      "distance_km": final.totalDistanceKm,
      "duration_min": final.totalDurationMin,
      "hourly_rate": final.hourlyRate,
      "km_rate": final.kmRate,
      "scan_ts": scanTs,
      // Heure du SCAN, pas de l'insertion — c'est la même règle que
      // `createRide` côté JS, et c'est ce qui fait atterrir la course au jour
      // où elle a été scannée quel que soit le chemin qui l'écrit.
      "created_at": ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: scanTs)),
    ]
    if let fuelCost = fuelCost {
      body["fuel_cost"] = fuelCost
      body["net_profit"] = ((final.scan.fare - fuelCost) * 100).rounded() / 100
    }
    if let p = final.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty {
      body["pickup_address"] = p
    }
    if let d = final.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty {
      body["destination_address"] = d
    }

    guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return }

    // Une session de fond n'accepte QUE `uploadTask(with:fromFile:)` — ni
    // `dataTask`, ni un corps en mémoire. Le fichier doit survivre au process :
    // il vit dans le container partagé, et le délégué le retire à la fin.
    let file = dir.appendingPathComponent("\(Int(scanTs * 1000)).json")
    guard (try? payload.write(to: file, options: .atomic)) != nil else { return }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(cred.jwt)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    // Rien à relire : l'app rechargera la liste depuis la base.
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")

    let task = session.uploadTask(with: req, fromFile: file)
    // Sert au délégué à retrouver le corps à supprimer.
    task.taskDescription = file.path
    task.resume()
  }
}

/// Garantit qu'un callback n'est invoqué qu'UNE seule fois (thread-safe) et
/// annule le watchdog associé. Utilisé par ScanProcessor pour éviter les
/// double-callbacks (Vision + watchdog + TomTom) et le deadlock de scanInProgress.
private final class CompletionGuard {
  private var fired = false
  private let lock = NSLock()
  private let body: (ScanProcessor.FinalResult?) -> Void
  var watchdog: DispatchWorkItem?

  init(_ body: @escaping (ScanProcessor.FinalResult?) -> Void) {
    self.body = body
  }

  func fire(_ result: ScanProcessor.FinalResult?) {
    lock.lock()
    if fired { lock.unlock(); return }
    fired = true
    lock.unlock()
    watchdog?.cancel()
    body(result)
  }
}

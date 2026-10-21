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

  /// Vrai si le dernier écran ressemble à une offre (cf. `looksLikeRideOffer`),
  /// ou si l'OCR n'a rien lu. Décide du motif d'échec et de l'envoi des blocs.
  private(set) var lastScanMayBeRide = true

  /// Cause réelle d'un échec : le motif de `scan_failures` et ce qui l'a
  /// déclenché (« no_fare platform=BOLT », « geocode dest=none »…).
  struct Failure {
    let reason: String
    let detail: String?
  }

  /// Pourquoi le dernier scan n'a rien mesuré — nil s'il a abouti. Posé par la
  /// sortie qui a gagné le `CompletionGuard`, donc jamais par un watchdog arrivé
  /// après coup. Chaque sortie dit SA cause : un OCR vide, une langue, une étape
  /// du parser ou un refus du géocodeur ne se confondent plus sous un seul motif.
  private(set) var lastFailure: Failure?

  /// Ce que le parser a tiré du dernier écran, quand il a abouti — même si
  /// l'itinéraire a échoué ensuite. Joint à la trace de l'échec : plateforme,
  /// prix, et surtout les adresses telles qu'envoyées à TomTom.
  private(set) var lastParsed: ScanResultModel?

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
    /// A-t-on mesuré, ou recopié l'écran ? Décide de ce qui est affiché et de ce
    /// qui est enregistré : hors `.ok`, la course n'est ni montrée ni écrite.
    let routeStatus: RouteStatus
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
      lastFailure = Failure(reason: "throttled", detail: "scan_in_progress")
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
    lastFailure = nil
    lastParsed = nil

    // Garde-fou anti-deadlock : `gate` garantit (1) un seul appel à onFinal,
    // (2) le reset systématique de scanInProgress, (3) un watchdog qui libère
    // le scanner même si Vision/TomTom ne rend jamais la main (sinon le flag
    // restait `true` à vie → tous les scans suivants ignorés jusqu'au reboot).
    let gate = CompletionGuard { [weak self] result, failure in
      self?.lastFailure = failure
      self?.scanInProgress = false
      onFinal(result)
    }
    let watchdog = DispatchWorkItem {
      gate.fire(nil, Failure(reason: "timeout", detail: "scan_watchdog_20s"))
    }
    gate.watchdog = watchdog
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 20, execute: watchdog)

    runOcr(image: image) { [weak self] blocks, screenW, screenH in
      guard let self = self else { gate.fire(nil); return }
      guard let blocks = blocks else {
        // Aucun texte lu. `lastScanMayBeRide` reste vrai : le Share Sheet laisse
        // alors Gemini tenter sur l'image (bénéfice du doute).
        self.lastScanMayBeRide = true
        gate.fire(nil, Failure(reason: "ocr_empty", detail: nil)); return
      }

      // Pré-filtre anti-pub : du texte a été lu — ressemble-t-il à une course ?
      // Sous la même bande que le parser : la Live Activity de Strive en haut
      // (« 26 € · 18.9km ») faisait passer un journal d'appels pour une offre,
      // et son OCR partait dans `scan_debug` (#66).
      let cutY = Int(Double(screenH) * OcrParser.topCut)
      let lines = blocks.filter { $0.box.centerY >= cutY }.map { $0.text }
      self.lastScanMayBeRide = Self.looksLikeRideOffer(lines.joined(separator: "\n"))

      // Matière de diagnostic (cf. lastBlocksJson) — capturée AVANT le parse,
      // pour être disponible même s'il échoue.
      self.lastBlocksJson = OcrParser.dumpBlocks(blocks)
      self.lastScreenHeight = screenH

      // Parsing identique à Android
      guard let result = OcrParser.shared.parse(
        blocks: blocks, screenWidth: screenW, screenHeight: screenH, image: image
      ) else {
        // LA LANGUE N'EXPLIQUE QU'UN ÉCHEC, ELLE N'EN PROVOQUE AUCUN.
        //
        // L'offre en langue étrangère était refusée AVANT le parse (1.0.5). Or
        // le parser ne lit pas les libellés : il lit les montants, les « km »,
        // les « min » et la position des lignes, que le roumain, le polonais ou
        // le tchèque gardent, et les adresses françaises ne sont jamais
        // traduites. Le refus bloquait donc des offres lisibles — un chauffeur
        // roumain n'a jamais réussi un scan. Désormais on lit d'abord, et
        // seul un échec sur un écran aux lettres étrangères reçoit la consigne
        // « passez votre app VTC dans une langue disponible sur Strive ».
        //
        // Le détail porte la langue du téléphone, les lettres vues, puis
        // l'étape où le parser a renoncé.
        if self.lastScanMayBeRide && Self.isUnsupportedLanguage(lines) {
          let phone = Locale.preferredLanguages.first ?? "?"
          let step = OcrParser.shared.lastFailure.map { " · \($0)" } ?? ""
          gate.fire(nil, Failure(
            reason: "unsupported_language",
            detail: "\(phone) \(Self.foreignLetters(lines))\(step)"
          ))
          return
        }
        gate.fire(nil, Failure(
          reason: self.lastScanMayBeRide ? "offer_unreadable" : "not_a_ride",
          detail: OcrParser.shared.lastFailure
        ))
        return
      }
      self.lastParsed = result

      // TomTom — uniquement si on a 2 adresses et la clé est configurée
      let pickup = result.pickupAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let dest = result.destinationAddress?.replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if pickup.isEmpty || dest.isEmpty {
        // Une adresse manque : c'est la LECTURE qui a calé, pas l'itinéraire.
        let missing = [pickup.isEmpty ? "no_pickup" : nil, dest.isEmpty ? "no_dest" : nil]
          .compactMap { $0 }.joined(separator: " ")
        gate.fire(
          self.computeFinal(scan: result, routeStatus: .unusable),
          Failure(reason: "no_addresses", detail: "\(missing) platform=\(result.platform.rawValue)")
        )
        return
      }
      if !TomTomService.shared.isReady {
        gate.fire(
          self.computeFinal(scan: result, routeStatus: .noKey),
          Failure(reason: "route_no_key", detail: nil)
        )
        return
      }

      TomTomService.shared.calculateRoute(
        pickupAddress: pickup, destinationAddress: dest, screenDistanceKm: result.distanceKm
      ) { outcome in
        switch outcome {
        case .noKey:
          gate.fire(
            self.computeFinal(scan: result, routeStatus: .noKey),
            Failure(reason: "route_no_key", detail: nil)
          )
        case .unreachable(let why):
          gate.fire(
            self.computeFinal(scan: result, routeStatus: .unreachable),
            Failure(reason: "route_unreachable", detail: why)
          )
        case .unusable(let why):
          gate.fire(
            self.computeFinal(scan: result, routeStatus: .unusable),
            Failure(reason: "route_unusable", detail: why)
          )
        case .ok(let route):
          // Plancher à 100 m, comme le parser : une course aussi courte existe.
          // Mirror Android / Share Sheet.
          guard route.distanceKm >= 0.1,
                // Plafonds larges : une course longue (Paris → Marseille) est
                // une course comme une autre. Mirror Android / Share Sheet.
                route.distanceKm <= 2000,
                route.durationMin <= 1440 else {
            gate.fire(
              self.computeFinal(scan: result, routeStatus: .unusable),
              Failure(reason: "route_unusable", detail: String(
                format: "bounds km=%.1f min=%ld", route.distanceKm, route.durationMin
              ))
            )
            return
          }

          // Plancher seul : un prix trop bas pour le trajet calculé trahit une
          // destination géocodée ailleurs. Pas de plafond — une course Van/XL
          // courte dépasse 12 €/km (cf. `OcrParser.rateMin`).
          let ratio = result.fare / route.distanceKm
          guard ratio >= 0.2 else {
            gate.fire(
              self.computeFinal(scan: result, routeStatus: .unusable),
              Failure(reason: "route_unusable", detail: String(
                format: "ratio fare=%.2f km=%.1f", result.fare, route.distanceKm
              ))
            )
            return
          }

          // Affiche les adresses canoniques TomTom (propres) plutôt que le texte
          // OCR bruité (ex: "All AV. … Çueue") — fallback OCR si TomTom n'en fournit pas.
          let updated = result.copy(
            distanceKm: route.distanceKm,
            durationMin: route.durationMin,
            pickupAddress: route.pickupFormatted,
            destinationAddress: route.destFormatted,
            pickupPoint: route.pickupCoords.map { GeoPoint(lat: $0.lat, lon: $0.lon) },
            destPoint: route.destCoords.map { GeoPoint(lat: $0.lat, lon: $0.lon) }
          )
          gate.fire(self.computeFinal(scan: updated, routeStatus: .ok))
        }
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

  /// L'écran ressemble-t-il à une offre VTC ? Ne sert plus qu'une fois le
  /// parser en échec : décide du motif (`offer_unreadable` / `not_a_ride`) et surtout
  /// si le texte de l'écran part dans `scan_debug`.
  ///
  /// STRUCTUREL, et non plus lexical. Le nom d'une plateforme ou un mot comme
  /// « course » suffisait : c'était fait pour laisser passer large vers Gemini,
  /// un faux positif ne coûtant qu'un appel. Gemini parti, un faux positif
  /// envoie en base le texte d'un écran PERSONNEL — l'écran d'accueil d'un
  /// chauffeur, apps bancaires comprises, passait sur la seule étiquette
  /// « Uber Driver » ; les réglages de Strive, sur le « course » d'une bannière
  /// Heetch. Une offre, dans toutes les langues, c'est un montant ET une
  /// distance ou une durée. Le montant peut être nu : l'OCR perd souvent le
  /// symbole de devise. Miroir de `OcrParser.looksLikeRideOffer` (Android).
  static func looksLikeRideOffer(_ rawText: String) -> Bool {
    let text = rawText.lowercased()
    let hasAmount = hasMatch(amountRegex, in: text) || hasMatch(currencyRegex, in: text)
    let hasDistance = hasMatch(distanceRegex, in: text)
    let hasDuration = hasMatch(durationRegex, in: text)
    return hasAmount && (hasDistance || hasDuration)
  }

  /// L'écran est-il dans une langue que l'app ne parle pas ? Consulté SEULEMENT
  /// quand le parse a échoué, pour expliquer l'échec — jamais pour refuser une
  /// offre lisible. Repéré par des
  /// lettres qu'aucune des sept langues de Strive (fr, en, es, pt, nl, de, it)
  /// n'emploie : roumain (ă ș ț), polonais, tchèque, turc, hongrois, baltes…,
  /// et les écritures non latines. Une liste de mots des sept langues aurait
  /// refusé un chauffeur espagnol pour un mot qu'on n'y a pas mis ; un détecteur
  /// de langue aurait conclu « français » sur une offre roumaine, dont le texte
  /// est surtout fait d'adresses et de noms de rues parisiens.
  ///
  /// Deux lignes au moins : un nom de lieu étranger seul (« Żubrówka Bar » en
  /// destination) ne fait pas une langue. Ne détecte pas une langue en latin
  /// sans lettre propre — aucune n'a été vue sur une offre jusqu'ici.
  /// Miroir de `OcrParser.isUnsupportedLanguage` (Android).
  static func isUnsupportedLanguage(_ lines: [String]) -> Bool {
    let foreign = lines.filter { hasMatch(foreignLetterRegex, in: $0.lowercased()) }
    return foreign.count >= 2
  }

  /// Les lettres qui ont fait refuser l'écran (« ă ș ț »), sans doublon et
  /// plafonnées. Seules elles disent la langue réellement affichée : celle du
  /// téléphone peut être une autre. Miroir de `OcrParser.foreignLetters` (Android).
  static func foreignLetters(_ lines: [String]) -> String {
    guard let regex = foreignLetterRegex else { return "" }
    var seen: [String] = []
    for line in lines {
      let lower = line.lowercased() as NSString
      for m in regex.matches(in: lower as String, range: NSRange(location: 0, length: lower.length)) {
        let letter = lower.substring(with: m.range)
        if !seen.contains(letter) { seen.append(letter) }
        if seen.count >= 12 { return seen.joined(separator: " ") }
      }
    }
    return seen.joined(separator: " ")
  }

  // ⚠️ PAS de `.regularExpression` dans le natif. Sur iOS 26.7.1 au
  // moins, Foundation exécute cette option sur le moteur Regex de Swift, qui
  // compile le motif avec un `try!` et fusionne les scalaires voisins d'une
  // classe en un seul caractère : U+06FF suivi de U+0900 (marque combinante)
  // devenait la borne « ۿऀ », refusée — la 1.0.4 mourait sur chaque offre
  // scannée (« Strive a quitté inopinément »). ICU, comme tout OcrParser, lit
  // des scalaires, et un motif qu'il refuse donne `nil`, pas un crash.
  private static let amountRegex = try? NSRegularExpression(pattern: #"\d{1,3}[.,]\d{2}(?![.,]?\d)"#)
  private static let currencyRegex = try? NSRegularExpression(pattern: #"(?:€|£|chf)\s*\d|\d\s*(?:€|£|chf)"#)
  private static let distanceRegex = try? NSRegularExpression(pattern: #"\d[\d.,]*\s*(?:km|mi)\b"#)
  private static let durationRegex = try? NSRegularExpression(pattern: #"\d+\s*min"#)
  private static let foreignLetterRegex = try? NSRegularExpression(
    pattern: #"[ășşțţąęłńśźżćřěůňťďľĺŕčšžğıőűāēīūķļņģėįųđþð\x{0370}-\x{03FF}\x{0400}-\x{052F}\x{0530}-\x{058F}\x{0590}-\x{05FF}\x{0600}-\x{06FF}\x{0900}-\x{097F}\x{0E00}-\x{0E7F}\x{10A0}-\x{10FF}\x{3040}-\x{30FF}\x{4E00}-\x{9FFF}\x{AC00}-\x{D7AF}]"#
  )

  private static func hasMatch(_ regex: NSRegularExpression?, in text: String) -> Bool {
    guard let regex = regex else { return false }
    return regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
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
  func computeFinal(scan: ScanResultModel, routeStatus: RouteStatus) -> FinalResult {
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
      routeStatus: routeStatus,
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
  static func upload(_ final: ScanProcessor.FinalResult, rideId: String, scanTs: Double) {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let restUrl = defaults.string(forKey: "supabaseRestUrl"), !restUrl.isEmpty,
          let anonKey = defaults.string(forKey: "geminiSupabaseKey"), !anonKey.isEmpty,
          let cred = currentCredential(defaults),
          // `on_conflict=id` + `resolution=ignore-duplicates` (plus bas) : le
          // POST est un upsert qui ne fait rien si la course existe déjà. Une
          // session de fond peut retenter un transfert ; sans ça le rejeu
          // repartait en 409, remontait en erreur, et brouillait le diagnostic
          // d'un envoi qui avait en réalité abouti.
          let url = URL(string: "\(restUrl)/rest/v1/rides?on_conflict=id"),
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
      // L'id frappé au scan, et non un uuid tiré par le serveur. C'est ce qui
      // rend cet envoi et le drain de l'outbox interchangeables : le second
      // réinsère la même ligne, écartée sur la clé primaire. Sans lui, les deux
      // chemins créaient deux courses qu'il fallait ensuite reconnaître comme
      // une seule — tout ce que 20260821_ride_id_at_scan.sql a pu retirer.
      "id": rideId,
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
    if let p = final.scan.pickupPoint {
      body["pickup_lat"] = p.lat
      body["pickup_lon"] = p.lon
    }
    if let d = final.scan.destPoint {
      body["dest_lat"] = d.lat
      body["dest_lon"] = d.lon
    }

    guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return }

    // Une session de fond n'accepte QUE `uploadTask(with:fromFile:)` — ni
    // `dataTask`, ni un corps en mémoire. Le fichier doit survivre au process :
    // il vit dans le container partagé, et le délégué le retire à la fin.
    let file = dir.appendingPathComponent("\(rideId).json")
    guard (try? payload.write(to: file, options: .atomic)) != nil else { return }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(cred.jwt)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    // Rien à relire : l'app rechargera la liste depuis la base.
    req.setValue("return=minimal,resolution=ignore-duplicates", forHTTPHeaderField: "Prefer")

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
  private let body: (ScanProcessor.FinalResult?, ScanProcessor.Failure?) -> Void
  var watchdog: DispatchWorkItem?

  init(_ body: @escaping (ScanProcessor.FinalResult?, ScanProcessor.Failure?) -> Void) {
    self.body = body
  }

  /// `failure` voyage avec le résultat : seule la sortie qui gagne pose la cause,
  /// un watchdog perdant ne peut donc pas écraser celle du pipeline.
  func fire(_ result: ScanProcessor.FinalResult?, _ failure: ScanProcessor.Failure? = nil) {
    lock.lock()
    if fired { lock.unlock(); return }
    fired = true
    lock.unlock()
    watchdog?.cancel()
    body(result, failure)
  }
}

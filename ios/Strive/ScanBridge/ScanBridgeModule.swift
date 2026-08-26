import Foundation
import UIKit
import React
import ActivityKit
import Sentry

/// Module natif React Native — pont entre JS et le scanner iOS.
/// Équivalent de ScanBridgeModule.kt sur Android.
@objc(ScanBridge)
class ScanBridgeModule: RCTEventEmitter {

  private var isActive = false
  private var hasListeners = false
  private var pendingLiveActivityPayload: [String: Any]?

  // MARK: - App Group (partage données avec Share Extension)

  /// Lu depuis Info.plist (`StriveAppGroupId`) — fallback hardcodé pour les
  /// targets qui ne l'auraient pas encore configuré. Centralise la valeur pour
  /// éviter la dérive entre app principale et Share Extension.
  static let appGroupId: String = {
    Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
      ?? "group.com.striveapp.app"
  }()
  static let scanResultKey = "lastScanResult"
  // File d'attente des scans non encore relevés. `lastScanResult` ne garde
  // qu'un seul résultat : deux partages de capture app fermée écrasaient le
  // premier. La file les empile, l'app les vide tous au premier plan.
  static let pendingResultsKey = "pendingScanResults"
  static let scanTimestampKey = "lastScanTimestamp"

  /// Jour de quota courant (yyyymmdd) en tenant compte du `day_reset_hour`
  /// (0 ou 4h) poussé par le JS : un scan avant l'heure de reset appartient
  /// encore à la journée de la veille. Aligné sur getDayStart() côté JS.
  /// Dupliqué à l'identique dans ShareViewController / AnalyzeRideIntent (targets
  /// séparés, pas de type partagé sans toucher au project.pbxproj).
  static func currentQuotaDay(_ defaults: UserDefaults?) -> Int {
    let resetHour = defaults?.integer(forKey: "quotaResetHour") ?? 0
    let shifted = Date().addingTimeInterval(TimeInterval(-resetHour * 3600))
    let c = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
    return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
  }

  // MARK: - RCTEventEmitter

  override static func moduleName() -> String! {
    return "ScanBridge"
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Version réelle du bundle (celle des stores, auto-incrémentée par EAS) —
  /// exposée au JS pour l'email support et le release Sentry. Évite les
  /// versions hardcodées qui dérivent à chaque release.
  override func constantsToExport() -> [AnyHashable: Any]! {
    return [
      "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
      "buildNumber": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
    ]
  }

  override func supportedEvents() -> [String]! {
    return ["onScanResult", "onScanFailed", "onPermissionDenied", "onScanFailure"]
  }

  static let rideDecisionsKey = "pendingRideDecisions"
  /// Échecs empilés par l'AppIntent / la Share Extension — ces process n'ont pas
  /// de session Supabase et ne peuvent pas écrire la trace eux-mêmes.
  static let pendingFailuresKey = "pendingScanFailures"

  override func startObserving() {
    hasListeners = true
    // Cold start : un résultat écrit par la Share Extension pendant que l'app
    // était tuée a pu rater la notification Darwin. Dès que le JS s'abonne, on
    // flush ce qui est en attente dans l'App Group (garde timestamp anti-doublon).
    handleShareExtensionResult()
    drainAndEmitScanFailures()
  }

  override func stopObserving() {
    hasListeners = false
  }

  // MARK: - Lifecycle

  override init() {
    super.init()
    // Écouter les résultats de la Share Extension via Darwin notification
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      center,
      observer,
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let module = Unmanaged<ScanBridgeModule>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async {
          module.handleShareExtensionResult()
        }
      },
      "com.striveapp.app.scanResult" as CFString,
      nil,
      .deliverImmediately
    )

    // Aussi écouter quand l'app revient au premier plan (au cas où la notification Darwin est manquée)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )

    // L'état premier plan est POUSSÉ vers LiveActivityManager depuis ici : ce
    // manager est aussi compilé dans la Share Extension, où `UIApplication.shared`
    // est interdit (l'archive échoue). Cette cible-ci est l'app, elle a le droit.
  }

  deinit {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterRemoveEveryObserver(center, Unmanaged.passUnretained(self).toOpaque())
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func appDidBecomeActive() {
    // Une carte supprimée par iOS n'éteint jamais la session. On la réarme ici,
    // au premier plan, avant de traiter les résultats éventuellement en attente.
    if #available(iOS 16.2, *) { LiveActivityManager.shared.ensureRunning() }
    // Sur iOS le scan passe toujours par la Share Extension → on traite les
    // résultats en attente à chaque retour au premier plan, que startScanner()
    // (isActive) ait été appelé ou non. hasListeners + timestamp protègent.
    handleShareExtensionResult()
    drainAndEmitScanFailures()
    // Si un payload est en attente et qu'une LA IDLE tourne, on l'update
    if #available(iOS 16.2, *), let payload = pendingLiveActivityPayload {
      pendingLiveActivityPayload = nil
      if !Activity<StriveActivityAttributes>.activities.isEmpty {
        LiveActivityManager.shared.update(
          platform: (payload["platform"] as? String) ?? "UNKNOWN",
          fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
          hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
          kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
          distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
          durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
          verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0,
          rideId: (payload["rideId"] as? String) ?? ""
        )
      }
    }
  }

  // MARK: - Lecture résultat Share Extension

  private var lastProcessedTimestamp: Double = 0

  /// Relève du journal de scans. Rien n'est effacé ici : une entrée n'est retirée
  /// que par `ackScan`, quand le JS a confirmé l'écriture en base. Tant qu'un scan
  /// n'est pas acquitté, il est ré-émis à chaque retour au premier plan.
  ///
  /// L'ancienne version purgeait AVANT d'émettre : tout scan que le JS recevait
  /// sans parvenir à l'écrire (réseau coupé, crash, quota) disparaissait. Le rejeu
  /// est sans risque depuis l'index unique (user_id, scan_ts) —
  /// 20260817_rides_scan_ts_unique.sql écarte les doublons côté base.
  private func handleShareExtensionResult() {
    guard hasListeners else { return }
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }

    var queued: [[String: Any]] = []
    if let data = defaults.data(forKey: Self.pendingResultsKey),
       let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queued = arr
    }

    // Chemin historique (clé unique, un seul résultat) : on le replie dans le
    // journal au lieu de l'émettre à part, pour n'avoir qu'un seul mécanisme.
    let timestamp = defaults.double(forKey: Self.scanTimestampKey)
    if timestamp > lastProcessedTimestamp {
      lastProcessedTimestamp = timestamp
      if let jsonData = defaults.data(forKey: Self.scanResultKey),
         var result = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
        if result["scanTs"] == nil { result["scanTs"] = timestamp }
        queued.append(result)
        defaults.removeObject(forKey: Self.scanResultKey)
        defaults.removeObject(forKey: Self.scanTimestampKey)
      } else if queued.isEmpty {
        // Horodatage avancé sans résultat exploitable = scan cassé.
        defaults.removeObject(forKey: Self.scanTimestampKey)
        sendEvent(withName: "onScanFailed", body: nil)
        return
      }
    }

    guard !queued.isEmpty else { return }

    // `rideId` est normalement frappé AU SCAN, par le process qui a analysé
    // l'écran — c'est ce qui en fait l'identité de la course, et pas seulement
    // une clé de file. Le rattrapage ci-dessous ne concerne que les entrées
    // héritées, écrites par un build antérieur et pas encore relevées : sans id
    // elles ne pourraient jamais être acquittées, donc seraient rejouées sans
    // fin. Un id attribué ici peut désigner une course DÉJÀ écrite en base sous
    // un autre id (RideUploader) ; l'index unique sur `scan_ts` écarte alors
    // l'insertion, que `createRide` traite comme un succès.
    //
    // On PERSISTE avant d'émettre — sans ça un ack porterait sur un id inconnu.
    for i in queued.indices where queued[i]["rideId"] == nil {
      queued[i]["rideId"] = UUID().uuidString
    }
    persistPendingResults(queued, defaults)

    for (idx, result) in queued.enumerated() {
      // Seul le dernier scan a vocation à s'afficher en Live Activity.
      emitScanResult(result, refreshLiveActivity: idx == queued.count - 1)
    }
  }

  private func persistPendingResults(_ results: [[String: Any]], _ defaults: UserDefaults) {
    if results.isEmpty {
      defaults.removeObject(forKey: Self.pendingResultsKey)
      return
    }
    guard let data = try? JSONSerialization.data(withJSONObject: results) else { return }
    defaults.set(data, forKey: Self.pendingResultsKey)
  }

  /// Accusé de réception : la course est en base (ou définitivement refusée).
  /// Seul mécanisme qui retire une entrée du journal — il n'y a plus de
  /// suppression au bout de N tentatives, donc plus de course perdue en silence.
  @objc func ackScan(_ rideId: String) {
    guard !rideId.isEmpty, let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    guard let data = defaults.data(forKey: Self.pendingResultsKey),
          let queued = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return }
    persistPendingResults(queued.filter { ($0["rideId"] as? String) != rideId }, defaults)
  }

  /// Les décisions Prise/Refusée en attente, telles quelles.
  ///
  /// LECTURE PURE : rien n'est émis, rien n'est effacé. Le JS les demande quand
  /// il est prêt — session ouverte, liste des courses chargée — les applique,
  /// puis retire chacune par `ackRideDecision`.
  ///
  /// C'est ce qui a remplacé l'émission d'événements. Un événement arrive quand
  /// le natif le décide, c'est-à-dire souvent avant que le JS puisse s'en
  /// servir : il fallait alors un tampon côté JS, un accusé de réception pour ne
  /// pas le perdre, et des relances pour le rejouer. Quatre mécanismes pour
  /// compenser un seul problème de calendrier. En laissant le JS venir chercher,
  /// le problème n'existe plus.
  @objc func getPendingRideDecisions(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId),
          let data = defaults.data(forKey: Self.rideDecisionsKey),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { resolve([]); return }
    let out = arr.compactMap { d -> [String: Any]? in
      guard let rideId = d["rideId"] as? String, !rideId.isEmpty,
            let status = d["status"] as? String,
            status == "ACCEPTED" || status == "DECLINED" else { return nil }
      return ["rideId": rideId, "status": status]
    }
    resolve(out)
  }

  /// Émet un résultat vers le JS et, si demandé, rafraîchit la Live Activity.
  /// Extrait pour être appelé aussi bien sur un résultat isolé que sur chaque
  /// élément de la file d'attente.
  private func emitScanResult(_ result: [String: Any], refreshLiveActivity: Bool) {
    let defaults = UserDefaults(suiteName: Self.appGroupId)

    // Tente de démarrer le Live Activity depuis l'app principale si la
    // Share Extension n'a pas réussi (pas d'activité en cours).
    if refreshLiveActivity, #available(iOS 16.2, *) {
      let existing = Activity<StriveActivityAttributes>.activities
      let shareExtStatus = (result["_liveActivityDebug"] as? String) ?? "unknown"
      NSLog("[Strive:Bridge] ShareExt LA status=%@, existing activities=%d, appState=%d",
            shareExtStatus, existing.count, UIApplication.shared.applicationState.rawValue)

      if existing.isEmpty {
        var payload = result
        let fare = (payload["fare"] as? NSNumber)?.doubleValue ?? 0
        let distKm = (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0
        let durMin = (payload["durationMin"] as? NSNumber)?.intValue ?? 0

        if (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0 == 0, fare > 0, durMin > 0 {
          payload["hourlyRate"] = fare / (Double(durMin) / 60.0)
        }
        if (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0 == 0, fare > 0, distKm > 0 {
          payload["kmRate"] = fare / distKm
        }
        if payload["verdictLevel"] == nil {
          let prefs = UserDefaults(suiteName: Self.appGroupId)
          // `object(forKey:)` : `double(forKey:)` rend 0.0 sur clé absente, donc
          // le défaut ne s'appliquait pas et le verdict tombait à 2 (vert) pour
          // tout. Même correctif que ScanProcessor.computeFinal.
          let minH = (prefs?.object(forKey: "minHourlyRate") as? Double) ?? 25.0
          let minK = (prefs?.object(forKey: "minKmRate") as? Double) ?? 1.2
          let hr = (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0
          let km = (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0
          payload["verdictLevel"] = (hr >= minH && km >= minK) ? 2 : (hr >= minH || km >= minK) ? 1 : 0
        }

        LiveActivityManager.shared.update(
          platform: (payload["platform"] as? String) ?? "UNKNOWN",
          // Net de carburant si la préférence est active — la Share Extension a
          // déjà fait le calcul. Repli sur le brut pour les payloads antérieurs.
          fare: (payload["displayFare"] as? NSNumber)?.doubleValue ?? fare,
          hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
          kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
          distanceKm: distKm,
          durationMin: durMin,
          verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0,
          rideId: (payload["rideId"] as? String) ?? ""
        )
      }

      // Nettoyage de la trace debug Live Activity (écrite par LiveActivityManager).
      defaults?.removeObject(forKey: "laSteps")
      defaults?.removeObject(forKey: "laLastStep")
    }

    sendEvent(withName: "onScanResult", body: result)
  }

  /// Empile une décision prise DANS l'app, quand son écriture en base n'a pas
  /// abouti — le plus souvent parce que la course n'y est pas encore : elle a
  /// été scannée app suspendue, et le journal natif ne l'a pas encore fait
  /// insérer. Sans ça, ce choix-là était le seul à ne pas être conservé, alors
  /// que ceux tapés sur la carte ou la notification vivent dans cette file
  /// jusqu'à ce qu'ils aboutissent.
  ///
  /// Même helper, même format, même dédoublonnage sur `rideId` que les boutons
  /// de la Live Activity : le prochain drain la rejoue, et l'acquitte au succès.
  @objc func queueRideDecision(_ rideId: String, accepted: Bool) {
    guard !rideId.isEmpty else { return }
    appendRideDecision(rideId: rideId, accepted: accepted, appGroupId: Self.appGroupId)
  }

  /// Accusé de réception d'une décision : le statut est écrit en base, l'entrée
  /// peut sortir de la file. Seul mécanisme qui l'en retire.
  ///
  /// Une décision non acquittée sera ré-émise au prochain retour au premier plan
  /// — c'est voulu : mieux vaut la rejouer que la perdre.
  @objc func ackRideDecision(_ rideId: String) {
    guard !rideId.isEmpty,
          let defaults = UserDefaults(suiteName: Self.appGroupId),
          let data = defaults.data(forKey: Self.rideDecisionsKey),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return }
    // Comparaison stricte, enfin : une chaîne traverse le pont React Native sans
    // se faire rogner, là où l'ancien `scanTs` (un `Double` à 17 chiffres)
    // imposait une tolérance à la milliseconde.
    let kept = arr.filter { ($0["rideId"] as? String) != rideId }
    if kept.isEmpty {
      defaults.removeObject(forKey: Self.rideDecisionsKey)
    } else if let out = try? JSONSerialization.data(withJSONObject: kept) {
      defaults.set(out, forKey: Self.rideDecisionsKey)
    }
  }

  /// Vide la file des échecs empilés par l'AppIntent (autre process, pas de
  /// session Supabase) et les remonte au JS, qui écrit la trace. `occurredAt`
  /// porte l'heure réelle : la relève peut arriver longtemps après.
  func drainAndEmitScanFailures() {
    guard hasListeners else { return }
    guard let defaults = UserDefaults(suiteName: Self.appGroupId),
          let data = defaults.data(forKey: Self.pendingFailuresKey),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
          !arr.isEmpty else { return }
    // Purge d'abord : si l'émission déclenche un crash, on ne rejoue pas la
    // même série au prochain démarrage.
    defaults.removeObject(forKey: Self.pendingFailuresKey)
    for f in arr {
      guard let reason = f["reason"] as? String, !reason.isEmpty else { continue }
      var body: [String: Any] = [
        "reason": reason,
        "surface": (f["surface"] as? String) ?? "shortcut",
      ]
      if let detail = f["detail"] as? String { body["detail"] = detail }
      if let platform = f["platform"] as? String { body["platform"] = platform }
      if let ts = (f["occurredAt"] as? NSNumber)?.doubleValue, ts > 0 { body["occurredAt"] = ts }
      sendEvent(withName: "onScanFailure", body: body)
    }
  }

  // MARK: - Bridge Methods (appelées depuis JS)

  @objc func startScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = true
    // Vérifier s'il y a un résultat en attente
    handleShareExtensionResult()
    resolve(nil)
  }

  @objc func stopScanner(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    isActive = false
    resolve(nil)
  }

  @objc func isScannerRunning(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(isActive)
  }

  @objc func checkPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // iOS n'a pas besoin d'overlay ni d'accessibility
    // On vérifie juste que la Share Extension est configurée
    let extensionConfigured = UserDefaults(suiteName: Self.appGroupId) != nil
    resolve([
      "overlay": true,                    // pas nécessaire sur iOS
      "accessibility": true,              // pas nécessaire sur iOS
      "needsMediaProjection": false,
      "mediaProjectionGranted": true,
      "shareExtensionReady": extensionConfigured,
    ])
  }

  @objc func showVerdict(_ level: NSNumber) {
    // Sur iOS, le verdict est affiché dans la Share Extension directement
    // On stocke quand même pour que l'extension puisse le récupérer
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(level.intValue, forKey: "lastVerdictLevel")
  }

  @objc func updateDuration(_ minutes: NSNumber) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(minutes.intValue, forKey: "lastDurationMin")
  }

  @objc func setGeminiConfig(_ edgeUrl: String, supabaseAnonKey: String) {
    GeminiVisionService.shared.edgeFunctionUrl = edgeUrl
    GeminiVisionService.shared.supabaseAnonKey = supabaseAnonKey
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(edgeUrl, forKey: "geminiEdgeUrl")
      defaults.set(supabaseAnonKey, forKey: "geminiSupabaseKey")
      // Racine du projet Supabase, déduite de l'URL de l'edge function
      // (`https://<ref>.supabase.co/functions/v1/gemini-proxy`) : c'est elle que
      // `RideUploader` utilise pour écrire la course dès le scan. Déduite plutôt
      // que poussée par un appel de plus — le JS construit déjà l'edge URL à
      // partir de la même racine, et un build JS antérieur reste ainsi couvert.
      if let comps = URLComponents(string: edgeUrl), let host = comps.host {
        var root = URLComponents()
        root.scheme = comps.scheme ?? "https"
        root.host = host
        root.port = comps.port
        if let rootUrl = root.string {
          defaults.set(rootUrl, forKey: "supabaseRestUrl")
        }
      }
    }
  }

  /// JWT user — requis par l'edge function durcie (rate-limit + audit).
  /// Stocké dans App Group pour que la Share Extension l'utilise aussi.
  @objc func setSupabaseUserJwt(_ jwt: String) {
    GeminiVisionService.shared.supabaseUserJwt = jwt
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(jwt, forKey: "supabaseUserJwt")
    }
  }

  /// Haptique de SÉLECTION iOS (`UISelectionFeedbackGenerator`) — le petit tic
  /// sec des sélecteurs système, pour le changement d'onglet.
  ///
  /// `Vibration.vibrate()` de React Native ne sait pas produire ça : sur iPhone
  /// il déclenche le vibreur complet, quelle que soit la durée demandée. Sur une
  /// barre d'onglets, c'est une secousse là où l'utilisateur attend un tic.
  ///
  /// `prepare()` avant `selectionChanged()` : sans lui, le Taptic Engine sort de
  /// veille au moment du déclenchement et le retour arrive après l'animation.
  @objc func selectionHaptic() {
    DispatchQueue.main.async {
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }
  }

  @objc func setParserConfig(_ configJson: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(configJson, forKey: "parserConfig")
    }
  }

  /// Clé TomTom — partagée avec l'AppIntent (Shortcut) et la Share Extension
  /// via App Group, pour que TomTomService puisse géocoder hors process JS.
  @objc func setTomTomApiKey(_ key: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(key, forKey: "tomTomApiKey")
    }
  }

  /// Quota journalier atteint — sync via App Group pour que la Share Extension
  /// et l'AppIntent puissent court-circuiter le scan sans appeler TomTom/Gemini.
  @objc func setQuotaReached(_ reached: Bool, isFree: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(reached, forKey: "scanQuotaReached")
      // DATÉ, sinon le drapeau survit à la nuit. Le compteur, lui, est déjà
      // borné par `scanCountDay` : au reset il repart à zéro et le chauffeur
      // récupère ses scans. Le drapeau, non daté, restait à `true` depuis la
      // veille — l'app affichait « 2/3 » (recalculé depuis la base) pendant que
      // le scan par raccourci était refusé pour quota atteint.
      //
      // On ne peut pas se contenter du compteur : le drapeau porte une
      // information qu'il n'a pas, les crédits achetés (`canScan` = limite −
      // scans + crédits). D'où la date plutôt que la suppression.
      defaults.set(Self.currentQuotaDay(defaults), forKey: "scanQuotaReachedDay")
      // Réserve le teaser verrouillé (vendre Plus) aux comptes free : un abonné
      // Plus hors quota voit "reviens demain", pas un upsell Plus.
      defaults.set(isFree, forKey: "isFreeTier")
    }
  }

  /// Compteur de scans autoritatif poussé par le JS (= nb de courses du jour) +
  /// la limite. Le natif (Share Extension / AppIntent) l'utilise pour APPLIQUER
  /// le quota lui-même — sans dépendre du JS, qui est suspendu pendant un scan
  /// via l'extension. Le natif incrémente entre deux syncs ; le JS réécrit la
  /// valeur réelle au foreground.
  @objc func setScanQuota(_ countToday: NSNumber, limit: NSNumber, resetHour: NSNumber) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(limit.intValue, forKey: "scanQuotaLimit")
    // Persisté AVANT le calcul du jour : l'extension/AppIntent (sans JS) en ont
    // besoin pour situer la frontière de journée (0h ou 4h).
    defaults.set(resetHour.intValue, forKey: "quotaResetHour")

    // Réconciliation. Le natif compte les résultats PRÉSENTÉS, le JS compte les
    // courses présentes en base — et entre les deux il y a le journal
    // `pendingScanResults`, qui retient un scan tant que l'app ne l'a pas inséré
    // puis acquitté. Les deux nombres divergent donc légitimement.
    //
    // C'est le JOURNAL qui dit lequel fait autorité :
    //
    //  • journal NON VIDE → des scans attendent leur insertion, le compte DB
    //    sous-estime. On garde `max(natif, DB)`, sinon on rendrait des scans
    //    indûment à un chauffeur qui a scanné app fermée.
    //
    //  • journal VIDE → plus rien en attente, la base sait tout, elle fait foi.
    //    Sans cette branche le `max` était un cliquet : une fois le compteur
    //    natif monté, aucune valeur JS ne pouvait le redescendre avant le reset
    //    du lendemain. Le chauffeur lisait « 0/3 » sur son Dashboard pendant que
    //    le scan était refusé pour quota atteint — c'est exactement ce bug.
    let today = Self.currentQuotaDay(defaults)
    let storedDay = defaults.integer(forKey: "scanCountDay")
    let hasPending = !Self.pendingScanResults(defaults).isEmpty

    if storedDay != today || !hasPending {
      defaults.set(today, forKey: "scanCountDay")
      defaults.set(countToday.intValue, forKey: "scanCountToday")
    } else {
      let current = defaults.integer(forKey: "scanCountToday")
      defaults.set(max(current, countToday.intValue), forKey: "scanCountToday")
    }
  }

  /// Scans en attente d'insertion en base. Lecture seule : c'est `ackScan` qui
  /// retire une entrée, et lui seul.
  private static func pendingScanResults(_ d: UserDefaults) -> [[String: Any]] {
    guard let data = d.data(forKey: pendingResultsKey),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return arr
  }

  /// Active/désactive le scanner (toggle "Trip ID actif", iOS). Lu par la Share
  /// Extension et l'AppIntent → un scan déclenché alors que désactivé est refusé.
  @objc func setScannerEnabled(_ enabled: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(enabled, forKey: "scannerEnabled")
    }
  }

  @objc func updateSessionKPI(_ payload: NSDictionary) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.updateSessionKPI(
        todayEarnings: (payload["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
        todayHourlyRate: (payload["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        todayKm: (payload["todayKm"] as? NSNumber)?.doubleValue ?? 0,
        onlineMinutes: (payload["onlineMinutes"] as? NSNumber)?.intValue ?? 0
      )
    }
  }

  @objc func clearLiveActivityResult(_ rideId: String) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.clearResult(rideId: rideId)
    }
  }

  @objc func setSessionOnline(_ online: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(online, forKey: "sessionOnline")
    }
  }

  @objc func setUseLiveActivity(_ enabled: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(enabled, forKey: "useLiveActivity")
    }
  }

  @objc func setAppLanguage(_ lang: String) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(lang, forKey: "appLanguage")
    }
  }

  /// Préférences utilisateur pour le verdict natif (seuils + include pickup).
  /// Lus par AnalyzeRideIntent au moment du calcul de rentabilité.
  @objc func setScannerPreferences(_ minHourlyRate: NSNumber,
                                    minKmRate: NSNumber,
                                    includePickup: Bool) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(minHourlyRate.doubleValue, forKey: "minHourlyRate")
      defaults.set(minKmRate.doubleValue, forKey: "minKmRate")
      defaults.set(includePickup, forKey: "includePickup")
    }
  }

  /// Affichage du prix net de carburant (Live Activity). `fuelCostPerKm` arrive
  /// pré-calculé du JS (conso × prix du jour) : le natif n'a ni le type de
  /// carburant ni le tarif à la pompe. Affichage seul — verdict et tarif
  /// enregistré restent bruts (cf. ScanProcessor.computeFinal).
  @objc func setFuelDeduction(_ enabled: Bool, fuelCostPerKm: NSNumber) {
    if let defaults = UserDefaults(suiteName: Self.appGroupId) {
      defaults.set(enabled, forKey: "deductFuel")
      defaults.set(fuelCostPerKm.doubleValue, forKey: "fuelCostPerKm")
    }
  }

  /// Purge le cache de géocodage local (adresses = PII). Appelé par le JS au
  /// logout et après suppression de compte — l'effacement RGPD couvre aussi le
  /// cache sur l'appareil, hors de portée de la RPC serveur delete_account.
  @objc func clearGeocodeCache() {
    GeocodeCache.shared.clear()
  }

  @objc func openOverlayPermissionSettings() {
    // No-op sur iOS — pas de permission overlay
  }

  @objc func openAccessibilitySettings() {
    // No-op sur iOS — pas de permission accessibility
  }

  @objc func requestMediaProjectionPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    // No-op sur iOS
    resolve(nil)
  }

  // MARK: - Live Activity (Dynamic Island)

  @objc func checkLiveActivityPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      let info = ActivityAuthorizationInfo()
      resolve(info.areActivitiesEnabled)
    } else {
      resolve(false)
    }
  }

  @objc func startLiveActivity(_ payload: NSDictionary,
                               resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      let started = LiveActivityManager.shared.start(
        platform: (payload["platform"] as? String) ?? "UNKNOWN",
        fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
        hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
        distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
        durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
        verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0,
        todayEarnings: (payload["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
        todayHourlyRate: (payload["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        todayKm: (payload["todayKm"] as? NSNumber)?.doubleValue ?? 0,
        onlineMinutes: (payload["onlineMinutes"] as? NSNumber)?.intValue ?? 0,
        sessionStartEpoch: (payload["sessionStartEpoch"] as? NSNumber)?.doubleValue ?? 0
      )
      resolve(started)
    } else {
      resolve(false)
    }
  }

  @objc func updateLiveActivity(_ payload: NSDictionary,
                                resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.update(
        platform: (payload["platform"] as? String) ?? "UNKNOWN",
        fare: (payload["fare"] as? NSNumber)?.doubleValue ?? 0,
        hourlyRate: (payload["hourlyRate"] as? NSNumber)?.doubleValue ?? 0,
        kmRate: (payload["kmRate"] as? NSNumber)?.doubleValue ?? 0,
        distanceKm: (payload["distanceKm"] as? NSNumber)?.doubleValue ?? 0,
        durationMin: (payload["durationMin"] as? NSNumber)?.intValue ?? 0,
        verdictLevel: (payload["verdictLevel"] as? NSNumber)?.intValue ?? 0
      )
    }
    resolve(nil)
  }

  @objc func stopLiveActivity(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.2, *) {
      LiveActivityManager.shared.stop()
    }
    resolve(nil)
  }

  /// Analyse une image directement depuis l'app (ex: depuis la galerie photo)
  @objc func analyzeImage(_ imageUri: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let url = URL(string: imageUri),
          let data = try? Data(contentsOf: url),
          let image = UIImage(data: data)
    else {
      reject("INVALID_IMAGE", "Impossible de charger l'image", nil)
      return
    }

    VisionOCRService.shared.recognizeText(from: image) { [weak self] ocrResult in
      guard let ocrResult = ocrResult, !ocrResult.blocks.isEmpty else {
        // Fallback Gemini
        GeminiVisionService.shared.analyze(image: image) { geminiResult in
          guard let geminiResult = geminiResult else {
            reject("OCR_FAILED", "Échec de l'analyse OCR et Gemini", nil)
            return
          }
          let body: [String: Any] = [
            "platform": geminiResult.platform,
            "fare": geminiResult.fare,
            "distanceKm": geminiResult.distanceKm,
            "durationMin": geminiResult.durationMin as Any,
          ]
          resolve(body)
        }
        return
      }

      // Envoyer les blocs au JS pour parsing par ocrParser.ts
      let blocks = ocrResult.blocks.map { $0.toDictionary() }
      resolve([
        "blocks": blocks,
        "screenHeight": ocrResult.screenHeight,
      ])
    }
  }

  // MARK: - Local Notifications

  @objc func scheduleLocalNotification(_ identifier: String,
                                       title: String,
                                       body: String,
                                       delaySeconds: Double) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let trigger = delaySeconds > 0
      ? UNTimeIntervalNotificationTrigger(timeInterval: max(delaySeconds, 1), repeats: false)
      : nil

    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(request)
  }

  @objc func cancelLocalNotification(_ identifier: String) {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
  }
}

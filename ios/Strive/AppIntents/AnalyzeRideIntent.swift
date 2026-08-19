import AppIntents
import UIKit
import UserNotifications
import ActivityKit

/// Reprise UNIQUE d'une continuation. `performExpiringActivity` rappelle son
/// bloc à l'expiration alors que le pipeline peut encore aboutir, et le watchdog
/// de 25 s peut se déclencher juste après un callback : deux `resume` sur la même
/// continuation font crasher le process. Encaisse aussi une reprise arrivée avant
/// l'`attach` (callback synchrone).
private final class OnceContinuation {
  private let lock = NSLock()
  private var cont: CheckedContinuation<String, Never>?
  private var pending: String?

  func attach(_ c: CheckedContinuation<String, Never>) {
    lock.lock()
    if let value = pending {
      lock.unlock()
      c.resume(returning: value)
      return
    }
    cont = c
    lock.unlock()
  }

  func resume(_ value: String) {
    lock.lock()
    let c = cont
    cont = nil
    if c == nil && pending == nil { pending = value }
    lock.unlock()
    c?.resume(returning: value)
  }
}

/// App Intent exposé à l'app Shortcuts — flow identique à Android :
///   1. OCR (Vision)
///   2. Parser identique (`OcrParser.swift` ↔ `OcrParser.kt`)
///   3. Live Activity démarrée immédiatement avec valeurs OCR provisoires
///   4. TomTom (geocode + routing) en background
///   5. Live Activity mise à jour avec valeurs TomTom (ou fallback OCR si KO)
///
/// L'intent tourne en arrière-plan — l'utilisateur configure son raccourci :
///   "Prendre une capture d'écran" → "Analyser une course avec Strive"
/// `LiveActivityIntent` et non `AppIntent` : ce protocole existe pour accorder à
/// un intent le droit de piloter des Live Activities sans passer au premier
/// plan, ce dont on a besoin ici (`openAppWhenRun = false`, volontaire — cf.
/// AppDelegate : le chauffeur ne doit pas perdre de vue l'offre Uber).
/// `RideDecisionIntent` s'en sert déjà pour mettre à jour la carte depuis
/// l'arrière-plan.
///
/// Le résultat met à jour la carte de session existante avec une alerte
/// ActivityKit. La carte est créée au démarrage de session ou réarmée lorsque
/// Strive revient au premier plan ; un scan ne la crée ni ne la remplace.
///
/// Depuis l'arrière-plan, `Activity.request()` est interdit : si aucune carte ne
/// tourne, `update()` rend `false` et on notifie (voir plus bas).
@available(iOS 16.2, *)
struct AnalyzeRideIntent: LiveActivityIntent {

  static var title: LocalizedStringResource = "Analyser une offre de course"
  static var description = IntentDescription(
    "Analyse une capture Uber / Bolt / Heetch et affiche la rentabilité dans la Dynamic Island."
  )

  static var openAppWhenRun: Bool = false

  @Parameter(title: "Capture d'écran")
  var screenshot: IntentFile

  /// Identifie cette exécution pour ne pas notifier « analyse interrompue » alors
  /// qu'un résultat vient d'être présenté : `performExpiringActivity` rappelle son
  /// bloc avec `expired = true` pendant que le pipeline peut encore aboutir.
  /// Les scans sont sérialisés par `ScanProcessor` → un seul run vivant à la fois.
  private let runId = UUID()
  private static let presentedLock = NSLock()
  private static var lastPresentedRun: UUID?

  private func markPresented() {
    Self.presentedLock.lock()
    Self.lastPresentedRun = runId
    Self.presentedLock.unlock()
  }

  private var hasPresented: Bool {
    Self.presentedLock.lock()
    defer { Self.presentedLock.unlock() }
    return Self.lastPresentedRun == runId
  }

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    // Déconnecté : on n'engage RIEN — ni Vision, ni TomTom, ni Gemini, ni Live
    // Activity. Sans compte il n'y a pas de destinataire pour la course : elle
    // ne peut pas être écrite (aucun credential), et afficher un verdict
    // laisserait croire qu'elle a été enregistrée.
    //
    // Le JWT fait foi plutôt que `sessionOnline` : c'est LUI que le logout
    // purge (AuthContext), alors que la session de travail reste sur sa dernière
    // valeur et vaut donc encore `true` après une déconnexion.
    //
    // Pas de `logFailure` ici : `scan_failures` est écrit sous l'identité du
    // chauffeur, qu'on n'a précisément pas. Le vocabulaire de `log_scan_failure`
    // n'a de toute façon pas de motif pour ce cas, et le ranger sous
    // `session_off` confondrait « pas connecté » et « pas en service ».
    guard isSignedIn else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.signedOut", fr: "Connectez-vous à Strive pour analyser vos courses.", en: "Sign in to Strive to analyse your rides.")
      )
      return .result(value: "signed_out")
    }

    guard isScannerEnabled else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.scannerOff", fr: "Scanner désactivé — activez-le dans Strive › Préférences.", en: "Scanner disabled — enable it in Strive › Preferences.")
      )
      logFailure("scanner_off")
      return .result(value: "scanner_off")
    }
    guard isSessionOnline else {
      sendLocalNotification(
        title: localizedString("notif.session.title", fr: "Session requise", en: "Session required"),
        body: localizedString("notif.session.body", fr: "Veuillez démarrer votre session dans Strive pour commencer à scanner.", en: "Please start your session in Strive to begin scanning.")
      )
      logFailure("session_off")
      return .result(value: "session_off")
    }

    guard !isQuotaReached else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.quota", fr: "Quota journalier atteint — revenez demain ou achetez des crédits.", en: "Daily quota reached — come back tomorrow or buy credits.")
      )
      logFailure("quota_reached")
      return .result(value: "quota_reached")
    }

    guard let image = UIImage(data: screenshot.data) else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.invalidImage", fr: "Image invalide — réessayez avec une capture d'écran.", en: "Invalid image — try again with a screenshot."),
        code: .invalidImage
      )
      logFailure("invalid_image")
      return .result(value: "invalid_image")
    }

    // Anti double-tap (AssistiveTouch tapé 2-3 fois) : un scan déclenché < 3 s
    // après le précédent est ignoré SILENCIEUSEMENT → pas de quota consommé, pas
    // de course en double, pas de Live Activity parasite. Un re-scan délibéré
    // (plus tard) passe normalement.
    guard !ScanProcessor.shouldThrottleRapidScan() else {
      // Feedback léger plutôt qu'un drop muet : le 1ᵉ tap est déjà en cours de
      // traitement (sinon le testeur croit que « ça scanne mais rien ne s'affiche »).
      sendLocalNotification(
        title: "Strive",
        body: localizedString("notif.tooSoon",
          fr: "Analyse déjà en cours — patiente une seconde.",
          en: "Analysis already running — hold on a second.")
      )
      logFailure("throttled")
      return .result(value: "too_soon")
    }

    return .result(value: await runPipeline(image: image))
  }

  /// Exécute le pipeline (OCR → TomTom → fallback Gemini) et NE REND LA MAIN
  /// qu'une fois le résultat présenté.
  ///
  /// Le découplage inverse (`perform()` rendait la main tout de suite, le
  /// résultat était poussé plus tard depuis le bloc de fond) supprimait bien
  /// l'indicateur « raccourci en cours », mais faisait perdre à la Live Activity
  /// sa priorité d'affichage : mise à jour depuis une simple assertion de fond,
  /// elle ne passait plus devant ce qui occupe la Dynamic Island (appel, Waze,
  /// minuteur) et le chauffeur devait toucher l'Island pour voir son verdict.
  /// Tant que l'intent est en cours, la présentation est traitée comme une
  /// action déclenchée par l'utilisateur et passe devant. L'indicateur système
  /// visible pendant les 5-10 s du scan est le prix assumé de ce choix.
  ///
  /// `performExpiringActivity` est conservé : il couvre la queue de traitement
  /// (écriture du résultat, quota) si le système décide de suspendre le process.
  private func runPipeline(image: UIImage) async -> String {
    let once = OnceContinuation()
    return await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
      once.attach(cont)
      ProcessInfo.processInfo.performExpiringActivity(withReason: "StriveScanRefine") { expired in
        // Le système reprend la main : le pipeline ne rendra pas de résultat. Sans
        // libérer le verrou ici, les 30 s suivantes répondent « analyse déjà en
        // cours » à chaque tap — le scan paraît mort alors qu'il n'a jamais tourné.
        // iOS reprend la main avant la fin du pipeline (pression mémoire/CPU —
        // typiquement Waze + appel + CarPlay). On PRÉVIENT : jusqu'ici la trace
        // partait en base et le chauffeur ne voyait strictement rien.
        if expired {
          self.logFailure("expired")
          ScanProcessor.markScanFinished()
          self.notifyScanAborted(code: .expired)
          once.resume("expired")
          return
        }
        let sem = DispatchSemaphore(value: 0)
        ScanProcessor.shared.process(image: image) { finalResult in
          // Adresses présentes → on présente directement. Sinon (ou aucun
          // résultat) → fallback Gemini (récupère les 2 adresses → TomTom →
          // vraie distance/durée). Si Gemini échoue aussi → « scan échoué »
          // affiché DANS la Live Activity, et RIEN n'est enregistré.
          if let result = finalResult, self.hasBothAddresses(result) {
            // La continuation n'est reprise qu'une fois la course écrite en base :
            // `perform` rendu, iOS suspend le process et tuerait la requête en vol.
            self.presentResult(result) { value in
              once.resume(value)
              sem.signal()
            }
            return
          }
          self.geminiFallback(image: image) { recovered in
            if let recovered = recovered {
              self.presentResult(recovered) { value in
                once.resume(value)
                sem.signal()
              }
            } else {
              self.presentFailure()
              once.resume("no_ride")
              sem.signal()
            }
          }
        }
        // Borne l'attente (watchdog interne ScanProcessor = 20 s ; on laisse une
        // marge). Évite de tenir l'assertion de fond indéfiniment si un callback
        // ne revient jamais.
        // Filet de sécurité : si aucun callback n'est revenu dans les temps, le
        // verrou n'a été libéré par personne. `markScanFinished` est idempotent.
        if sem.wait(timeout: .now() + 25) == .timedOut {
          self.logFailure("timeout")
          ScanProcessor.markScanFinished()
          self.notifyScanAborted(code: .timeout)
          once.resume("timeout")
        }
      }
    }
  }

  // MARK: - Présentation résultat / échec / fallback Gemini

  private func hasBothAddresses(_ result: ScanProcessor.FinalResult) -> Bool {
    let p = result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let d = result.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !p.isEmpty && !d.isEmpty
  }

  /// Affiche le résultat (Live Activity ou notif) + l'enregistre pour l'app.
  /// scanTs : clé de corrélation course ↔ décision (lastScanTimestamp + userInfo).
  ///
  /// `done` est appelé quand TOUT est écrit, écriture en base comprise : c'est ce
  /// qui maintient le process en vie le temps de la requête. Aucun thread n'est
  /// bloqué au passage — cette méthode peut tourner sur le main thread (le succès
  /// TomTom y repasse), où une attente synchrone exposerait au watchdog.
  private func presentResult(
    _ result: ScanProcessor.FinalResult,
    done: @escaping (String) -> Void
  ) {
    // Verrou anti double-appui libéré dès qu'on a un résultat à montrer.
    ScanProcessor.markScanFinished()
    let scanTs = Date().timeIntervalSince1970
    // liveActivityReady (et pas useLiveActivity) : si la LA est coupée dans les
    // réglages, on tombe sur la notification résultat (avec Accepter/Refuser)
    // au lieu d'un affichage qui échouerait en silence.
    // `liveActivityReady` ne dit que si la fonctionnalité est autorisée, PAS si
    // l'affichage a réussi : depuis le raccourci l'app est en arrière-plan, et
    // `Activity.request()` y échoue quand aucune activité ne tourne déjà. On se
    // fie donc au retour réel, sinon le scan aboutit sans que rien ne s'affiche.
    var shown = false
    if liveActivityReady {
      // displayFare = net du carburant si la préférence est active, sinon brut.
      shown = LiveActivityManager.shared.update(
        platform: result.scan.platform.rawValue, fare: result.displayFare,
        hourlyRate: result.hourlyRate, kmRate: result.kmRate,
        distanceKm: result.totalDistanceKm, durationMin: result.totalDurationMin,
        verdictLevel: result.verdictLevel, scanTs: scanTs
      )
    }
    if !shown {
      // Le scan a réussi mais la Live Activity n'a rien pu afficher : on retombe
      // sur la notification ET on trace, sinon la panne reste invisible côté
      // données alors qu'elle se voit chez tous les chauffeurs sans session.
      // Deux causes très différentes derrière le même symptôme : (a) aucune carte
      // à l'écran — le chauffeur l'a masquée ou iOS l'a terminée — et
      // `Activity.request()` est alors simplement interdit en arrière-plan : une
      // limite iOS attendue, que la notification de repli couvre déjà, donc RIEN
      // à tracer ; (b) une carte vivante qui refuse l'update est un vrai échec.
      // Les confondre remplissait `scan_failures` de faux positifs et masquait
      // les (b). Pas de motif dédié au cas (a) : le vocabulaire de `log_scan_failure`
      // est fermé, tout motif inconnu retombe sur 'other' et brouille les agrégats.
      if liveActivityReady, !Activity<StriveActivityAttributes>.activities.isEmpty {
        logFailure("la_start_failed")
      }
      let verdict = result.verdictLevel == 2 ? "✅" : result.verdictLevel == 1 ? "⚠️" : "❌"
      var body = String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", result.hourlyRate, result.kmRate, result.totalDurationMin, result.totalDistanceKm)
      // Le chauffeur a masqué la carte (ou iOS l'a terminée) alors que sa session
      // tourne toujours : sans un mot ici, il croit sa session fermée et ne sait
      // pas que la carte revient d'elle-même. `Activity.request()` étant interdit
      // en arrière-plan, ouvrir l'app est la seule façon de la ré-armer.
      if liveActivityReady {
        body += "\n" + localizedString(
          "notif.laHidden",
          fr: "Carte masquée — session toujours active. Ouvrez Strive pour la réafficher.",
          en: "Card hidden — session still active. Open Strive to bring it back."
        )
      }
      sendLocalNotification(
        title: "\(result.scan.platform.rawValue) · \(String(format: "%.0f€", result.displayFare)) · \(verdict)",
        body: body,
        category: "STRIVE_SCAN_RESULT", scanTs: scanTs,
        // Le repli notification est justement le chemin emprunté quand la carte
        // n'a rien pu afficher : s'il est silencé par la Concentration, le
        // chauffeur ne reçoit alors STRICTEMENT rien de son scan.
        level: .timeSensitive
      )
    }
    markPresented()
    incrementScanCount()
    let summary = String(
      format: "%@ · %.2f€ · %.0f€/h · %.2f€/km",
      result.scan.platform.rawValue, result.scan.fare, result.hourlyRate, result.kmRate
    )
    saveResultForMainApp(result, scanTs: scanTs) { done(summary) }
  }

  /// « Scan échoué » : affiché DANS la Live Activity (ou notif si LA désactivée).
  /// Rien n'est enregistré → l'app ne reçoit aucun résultat à rejeter.
  private func presentFailure() {
    ScanProcessor.markScanFinished()
    // `lastScanMayBeRide` distingue les deux causes : écran sans signal VTC
    // (on n'a même pas appelé Gemini) vs Gemini appelé mais sans réponse
    // exploitable. Sans ça les deux se confondent dans les agrégats.
    logFailure(ScanProcessor.shared.lastScanMayBeRide ? "gemini_ko" : "not_a_ride")
    // Même règle que presentResult : sans activité en cours, showError() ne
    // montre rien du tout — on notifie alors, plutôt que d'échouer en silence.
    var shown = false
    if liveActivityReady {
      shown = LiveActivityManager.shared.showError()
    }
    if !shown {
      var body = localizedString("notif.noRide", fr: "Aucune offre détectée — réessayez avec une autre capture.", en: "No ride offer detected — try again with another screenshot.")
      // Même raison que dans presentResult : carte masquée mais session vivante.
      if liveActivityReady {
        body += "\n" + localizedString(
          "notif.laHidden",
          fr: "Carte masquée — session toujours active. Ouvrez Strive pour la réafficher.",
          en: "Card hidden — session still active. Open Strive to bring it back."
        )
      }
      sendLocalNotification(
        title: "Strive",
        body: body,
        // « pas une course » est un résultat légitime, pas une panne : pas de code.
        code: ScanProcessor.shared.lastScanMayBeRide ? .geminiKo : nil,
        // Réponse directe à un scan déclenché il y a quelques secondes : doit
        // traverser la Concentration, sinon le chauffeur attend un verdict qui
        // ne viendra jamais et rescanne.
        level: .timeSensitive
      )
    }
    markPresented()
  }

  /// Scan abandonné avant tout affichage : assertion de fond expirée (`.expired`)
  /// ou pipeline sans réponse (`.timeout`). Ces deux sorties se contentaient de
  /// tracer l'échec — le chauffeur déclenchait son scan et RIEN n'arrivait jamais,
  /// sans moyen de savoir s'il devait réessayer. On passe par une notification
  /// et pas par la Live Activity : à ce stade le process peut être suspendu d'une
  /// seconde à l'autre, et `Activity.update` est asynchrone (donc perdable).
  private func notifyScanAborted(code: ScanErrorCode) {
    guard !hasPresented else { return }
    markPresented()
    sendLocalNotification(
      title: "Strive",
      body: localizedString(
        "notif.scanAborted",
        fr: "Analyse interrompue — relancez le scan.",
        en: "Analysis interrupted — run the scan again."
      ),
      code: code,
      // Le chauffeur attend un verdict qui n'arrivera pas : lui dire de relancer
      // n'a de valeur que tout de suite.
      level: .timeSensitive
    )
  }

  /// Fallback Gemini (Niveau 2) — le chemin AssistiveTouch n'a pas d'OCR-fallback
  /// comme la Share Extension. Gemini récupère les 2 adresses → TomTom → vraie
  /// distance/durée. completion(nil) si ce n'est pas une offre / Gemini KO /
  /// adresses introuvables (→ scan échoué dans la Live Activity).
  private func geminiFallback(image: UIImage, completion: @escaping (ScanProcessor.FinalResult?) -> Void) {
    guard ScanProcessor.shared.lastScanMayBeRide else { completion(nil); return }
    let d = UserDefaults(suiteName: appGroupId)
    GeminiVisionService.shared.edgeFunctionUrl = d?.string(forKey: "geminiEdgeUrl")
    GeminiVisionService.shared.supabaseAnonKey = d?.string(forKey: "geminiSupabaseKey")
    GeminiVisionService.shared.apiKey = d?.string(forKey: "geminiApiKey")
    GeminiVisionService.shared.supabaseUserJwt = d?.string(forKey: "supabaseUserJwt")
    GeminiVisionService.shared.analyze(image: image) { gem in
      guard let gem = gem,
            let pickup = gem.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !pickup.isEmpty,
            let dest = gem.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !dest.isEmpty
      else { completion(nil); return }
      let base = ScanResultModel(
        platform: ScanPlatform(rawValue: gem.platform) ?? .UNKNOWN,
        fare: gem.fare, distanceKm: gem.distanceKm, durationMin: gem.durationMin,
        pickupAddress: pickup, destinationAddress: dest,
        pickupDurationMin: gem.pickupDurationMin, pickupDistanceKm: gem.pickupDistanceKm
      )
      guard TomTomService.shared.isReady else {
        completion(ScanProcessor.shared.computeFinal(scan: base)); return
      }
      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        var refined = base
        if let route = route, route.distanceKm >= 0.3, route.distanceKm <= 500, route.durationMin <= 300 {
          let r = gem.fare / route.distanceKm
          if r >= 0.2, r <= 12.0 {
            refined = base.copy(
              distanceKm: route.distanceKm, durationMin: route.durationMin,
              pickupAddress: route.pickupFormatted, destinationAddress: route.destFormatted
            )
          }
        }
        completion(ScanProcessor.shared.computeFinal(scan: refined))
      }
    }
  }

  // MARK: - Preference

  private var isSessionOnline: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: appGroupId)?.bool(forKey: "sessionOnline") ?? false
  }

  /// Scanner activé (toggle "Trip ID actif"). Défaut = activé si la clé est absente.
  private var isScannerEnabled: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let d = UserDefaults(suiteName: appGroupId)
    return d?.object(forKey: "scannerEnabled") == nil ? true : d!.bool(forKey: "scannerEnabled")
  }

  private var useLiveActivity: Bool {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    let defaults = UserDefaults(suiteName: appGroupId)
    return defaults?.object(forKey: "useLiveActivity") == nil ? true : defaults!.bool(forKey: "useLiveActivity")
  }

  /// Live Activity réellement AFFICHABLE : préférence activée ET autorisation
  /// système ON (Réglages → Strive → Activités en direct). Si l'utilisateur l'a
  /// coupée, `Activity.request()` échoue en silence → la capture est prise, la
  /// course enregistrée, mais RIEN ne s'affiche (bug remonté par les testeurs).
  /// Dans ce cas on bascule sur une notification (résultat + échec).
  private var liveActivityReady: Bool {
    useLiveActivity && ActivityAuthorizationInfo().areActivitiesEnabled
  }

  /// Chauffeur connecté ? Le JWT déposé dans l'App Group est le seul signal
  /// d'authentification dont ce process dispose, et le logout le vide
  /// explicitement (`setSupabaseUserJwt('')`). Sa présence ne garantit pas
  /// qu'il soit encore valide — ce n'est pas le sujet ici : on veut seulement
  /// distinguer « un compte existe » de « personne n'est connecté ».
  private var isSignedIn: Bool {
    guard let d = UserDefaults(suiteName: appGroupId) else { return false }
    return !(d.string(forKey: "supabaseUserJwt") ?? "").isEmpty
  }

  private var appGroupId: String {
    (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String) ?? "group.com.striveapp.app"
  }

  /// Quota appliqué côté natif (compteur App Group poussé par le JS + incrémenté
  /// localement) OU flag JS — indépendant du JS suspendu pendant le scan.
  private var isQuotaReached: Bool {
    guard let d = UserDefaults(suiteName: appGroupId) else { return false }
    // Drapeau du JS, honoré UNIQUEMENT s'il date d'aujourd'hui. Il porte les
    // crédits achetés, que le compteur ignore, donc on le garde — mais non daté
    // il survivait à la nuit : au lendemain d'une journée à 3/3, le compteur
    // repartait bien à zéro et le scan était quand même refusé.
    if d.bool(forKey: "scanQuotaReached"),
       d.integer(forKey: "scanQuotaReachedDay") == Self.currentQuotaDay(d) {
      return true
    }
    // Le compteur App Group vaut pour TOUS les tiers : `plan_limits` donne
    // free = 3 ET plus = 15. Exempter les non-free laissait un abonné Plus
    // franchir sa limite app fermée — chaque scan au-delà s'affichait
    // normalement, puis `enforce_scan_quota` refusait l'insertion, la course
    // partait en file offline et finissait jetée après MAX_RETRY_COUNT.
    // `isFreeTier` ne sert qu'à choisir le message (teaser Plus vs « demain »).
    let limit = d.integer(forKey: "scanQuotaLimit")
    if limit <= 0 { return false }   // -1 = premium (illimité)
    return Self.scanCountForToday(d) >= limit
  }

  /// Compteur du jour, en ignorant une valeur datée d'hier.
  private static func scanCountForToday(_ d: UserDefaults) -> Int {
    if d.integer(forKey: "scanCountDay") != currentQuotaDay(d) { return 0 }
    return d.integer(forKey: "scanCountToday")
  }

  /// Jour de quota (yyyymmdd) tenant compte du `quotaResetHour` (0 ou 4h).
  private static func currentQuotaDay(_ d: UserDefaults) -> Int {
    let resetHour = d.integer(forKey: "quotaResetHour")
    let shifted = Date().addingTimeInterval(TimeInterval(-resetHour * 3600))
    let c = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
    return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
  }

  private func incrementScanCount() {
    guard let d = UserDefaults(suiteName: appGroupId) else { return }
    let today = Self.currentQuotaDay(d)
    let base = d.integer(forKey: "scanCountDay") == today ? d.integer(forKey: "scanCountToday") : 0
    d.set(today, forKey: "scanCountDay")
    d.set(base + 1, forKey: "scanCountToday")
  }

  private func localizedString(_ key: String, fr: String, en: String) -> String {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    // Anglais uniquement si l'app est réglée en anglais, français sinon — la
    // locale système ne fait PAS foi.
    guard let appLang = UserDefaults(suiteName: appGroupId)?.string(forKey: "appLanguage")
    else { return fr }
    return appLang.hasPrefix("en") ? en : fr
  }

  /// `code` est ajouté en fin de corps pour que le chauffeur puisse le citer en
  /// support. Même contrat que la Share Extension (cf. `ScanErrorCode`) : ce que
  /// l'utilisateur rapporte est directement croisable avec `scan_failures.reason`.
  /// `level` : `.timeSensitive` pour tout ce qui répond à un scan que le chauffeur
  /// vient de déclencher. Sans ça, ces notifications sont SILENCÉES par « Ne pas
  /// déranger » et par les Concentrations — dont « Ne pas déranger en voiture »,
  /// que le téléphone active tout seul dès qu'il détecte la conduite ou se
  /// connecte au Bluetooth du véhicule. Autrement dit : le cas d'usage normal
  /// d'un chauffeur VTC. Le verdict d'une course est périssable — il ne vaut que
  /// dans les secondes qui suivent — c'est exactement ce que ce niveau désigne.
  /// Réservé aux réponses de scan : tout passer en `.timeSensitive` reviendrait à
  /// annuler la Concentration du chauffeur, ce qu'Apple comme les utilisateurs
  /// sanctionnent.
  private func sendLocalNotification(
    title: String,
    body: String,
    category: String? = nil,
    scanTs: Double? = nil,
    code: ScanErrorCode? = nil,
    level: UNNotificationInterruptionLevel = .active
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = code == nil ? body : "\(body) (\(code!.rawValue))"
    content.sound = .default
    content.interruptionLevel = level
    // Boutons Accepter/Refuser : la catégorie STRIVE_SCAN_RESULT est enregistrée
    // par l'app principale (AppDelegate). scanTs corrèle la décision à la course.
    if let category = category { content.categoryIdentifier = category }
    if let scanTs = scanTs { content.userInfo = ["scanTs": scanTs] }
    let request = UNNotificationRequest(identifier: "strive-scan-\(UUID().uuidString)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  // MARK: - App Group

  /// Empile un ÉCHEC dans l'App Group. L'AppIntent tourne dans un autre process,
  /// sans session Supabase : il ne peut pas écrire la trace lui-même. L'app la
  /// relève au prochain passage au premier plan (`occurredAt` conserve l'heure
  /// réelle). Sans ça, un scan qui casse ici ne laisse aucune trace nulle part —
  /// c'est ce qui a rendu invisible le bug « ça scanne mais rien ne s'affiche ».
  private func logFailure(_ reason: String, detail: String? = nil) {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
    var queue: [[String: Any]] = []
    if let data = defaults.data(forKey: "pendingScanFailures"),
       let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queue = existing
    }
    var entry: [String: Any] = [
      "reason": reason,
      "surface": "shortcut",
      "occurredAt": Date().timeIntervalSince1970,
    ]
    if let detail = detail { entry["detail"] = detail }
    queue.append(entry)
    if queue.count > 50 { queue = Array(queue.suffix(50)) }
    if let data = try? JSONSerialization.data(withJSONObject: queue) {
      defaults.set(data, forKey: "pendingScanFailures")
    }
  }

  /// Empile le résultat dans la file de l'App Group, en plus de la case
  /// historique. Sans ça, deux scans consécutifs sans passage de l'app au
  /// premier plan écrasaient le premier — course perdue, invisible.
  private func enqueueScanResult(_ body: [String: Any], defaults: UserDefaults) {
    var queue: [[String: Any]] = []
    if let data = defaults.data(forKey: "pendingScanResults"),
       let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queue = existing
    }
    queue.append(body)
    // Plafond relevé de 20 à 100 : depuis que React Native ne démarre plus sur
    // un lancement en arrière-plan (cf. AppDelegate), la file n'est plus vidée à
    // chaque scan mais seulement quand l'app passe au premier plan. Or l'usage
    // visé est justement celui d'un chauffeur qui ne l'ouvre jamais de la journée.
    // À 20, une journée chargée perdait ses courses les plus anciennes en silence.
    if queue.count > 100 { queue = Array(queue.suffix(100)) }
    if let data = try? JSONSerialization.data(withJSONObject: queue) {
      defaults.set(data, forKey: "pendingScanResults")
    }
  }

  /// Repousse d'1h le rappel « Session inactive ». Il est planifié côté JS au
  /// passage en ligne et re-planifié à chaque scan traité par le JS — or un scan
  /// fait par le bouton Action / Siri arrive dans la file App Group sans que
  /// l'app tourne : le chauffeur recevait la notif en pleine tournée. Identifiant
  /// et délai alignés sur `localNotifications.ts`.
  private func rescheduleInactivityReminder(defaults: UserDefaults) {
    guard defaults.bool(forKey: "sessionOnline") else { return }
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: ["inactivity"])
    let content = UNMutableNotificationContent()
    content.title = localizedString("notif.inactivity.title",
                                    fr: "Session inactive", en: "Inactive session")
    content.body = localizedString(
      "notif.inactivity.body",
      fr: "Vous n'avez pas scanné depuis 1h. Pensez à fermer votre session.",
      en: "You haven't scanned in 1 hour. Consider ending your session."
    )
    content.sound = .default
    center.add(UNNotificationRequest(
      identifier: "inactivity",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
    ))
  }

  /// `done` : appelé une fois l'écriture en base terminée (ou abandonnée). Le
  /// dépôt dans l'App Group, lui, est fait immédiatement et sans condition.
  private func saveResultForMainApp(
    _ result: ScanProcessor.FinalResult,
    scanTs: Double,
    done: @escaping () -> Void
  ) {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let defaults = UserDefaults(suiteName: appGroupId) else { done(); return }

    var body: [String: Any] = [
      "platform": result.scan.platform.rawValue,
      "fare": result.scan.fare,
      "distanceKm": result.totalDistanceKm,
      "durationMin": result.totalDurationMin,
      "hourlyRate": result.hourlyRate,
      "kmRate": result.kmRate,
      "verdictLevel": result.verdictLevel,
      "scanTs": scanTs,
      // Tarif d'AFFICHAGE (net de carburant si l'option est active). `fare`
      // reste brut : c'est lui qui est enregistré en base.
      "displayFare": result.displayFare,
    ]
    if let pickup = result.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = result.scan.destinationAddress { body["destinationAddress"] = dest }

    // Diagnostic parser — même règle que la Share Extension : blocs OCR joints
    // seulement si une adresse manque (cf. saveSharedResult).
    if result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
      || result.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false,
      let blocks = ScanProcessor.shared.lastBlocksJson {
      body["debugBlocks"] = blocks
      body["screenHeight"] = ScanProcessor.shared.lastScreenHeight
    }

    enqueueScanResult(body, defaults: defaults)
    rescheduleInactivityReminder(defaults: defaults)

    // Jumelle minimale de `lastScanResult`, que le drain de l'app NE purge PAS :
    // c'est elle qui alimente l'incrément KPI du bouton ✅ / des commandes Siri
    // (cf. lastScannedFareKm). Montant affiché (net de carburant si l'option est
    // active) pour rester cohérent avec ce que la carte montre.
    defaults.set(
      ["scanTs": scanTs, "fare": result.displayFare, "km": result.totalDistanceKm],
      forKey: "lastTaggableRide"
    )

    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: "lastScanResult")
      defaults.set(scanTs, forKey: "lastScanTimestamp")

      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center,
        CFNotificationName("com.striveapp.app.scanResult" as CFString),
        nil, nil, true
      )
    }

    // Écriture immédiate en session de fond, maintenant que le dépôt App Group
    // est fait. Elle retourne tout de suite : le transfert est confié au démon
    // système et survit à la fin de l'intent. Si elle échoue (ou n'a pas de
    // credential valide), le drain de l'outbox rattrape à l'ouverture de l'app.
    RideUploader.upload(result, scanTs: scanTs)
    done()
  }
}

// MARK: - Commandes vocales « course prise / refusée » (Siri, mains libres)

/// Écrit la décision pour la DERNIÈRE course scannée (`lastScanTimestamp`) dans
/// l'App Group, prévient l'app (Darwin) pour la réconciliation JS, et fait
/// disparaître la carte résultat de la Live Activity. Mains libres → la seule
/// interaction réellement sûre en conduisant. Retourne false si aucune course récente.
/// Langue de l'app (App Group), pour localiser les réponses vocales de Siri.
private func striveIsFrench() -> Bool {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  let lang = UserDefaults(suiteName: appGroupId)?.string(forKey: "appLanguage")
    ?? Locale.current.languageCode ?? "en"
  return lang.hasPrefix("fr")
}

@available(iOS 16.0, *)
private func tagLastScannedRide(accepted: Bool) async -> Bool {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  guard let defaults = UserDefaults(suiteName: appGroupId) else { return false }
  // `lastTaggableRide` d'abord : `lastScanTimestamp` est purgé par le drain de
  // l'app (handleShareExtensionResult), si bien qu'après une simple ouverture de
  // Strive, Siri répondait « aucune course récente à marquer » sur une course
  // tout juste scannée. La clé jumelle, elle, survit à la relève.
  let scanTs = (defaults.dictionary(forKey: "lastTaggableRide")?["scanTs"] as? NSNumber)?.doubleValue
    ?? defaults.double(forKey: "lastScanTimestamp")
  guard scanTs > 0 else { return false }

  // Incrément KPI du jour + retour à l'état de base, IMMÉDIAT et sans JS
  // (helpers partagés avec le bouton Live Activity).
  if #available(iOS 16.2, *) {
    let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
    await revertLiveActivityToIdle(scanTs: scanTs, addFare: add.fare, addKm: add.km)
  }
  appendRideDecision(scanTs: scanTs, accepted: accepted, appGroupId: appGroupId)
  return true
}

@available(iOS 16.0, *)
struct RideTakenVoiceIntent: AppIntent {
  static var title: LocalizedStringResource = "Course prise"
  static var description = IntentDescription("Marque la dernière course scannée comme prise.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let ok = await tagLastScannedRide(accepted: true)
    let fr = striveIsFrench()
    let dialog: IntentDialog = ok
      ? (fr ? "C'est noté, course prise." : "Got it, ride marked as taken.")
      : (fr ? "Aucune course récente à marquer." : "No recent ride to mark.")
    return .result(dialog: dialog)
  }
}

@available(iOS 16.0, *)
struct RideDeclinedVoiceIntent: AppIntent {
  static var title: LocalizedStringResource = "Course refusée"
  static var description = IntentDescription("Marque la dernière course scannée comme refusée.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let ok = await tagLastScannedRide(accepted: false)
    let fr = striveIsFrench()
    let dialog: IntentDialog = ok
      ? (fr ? "C'est noté, course refusée." : "Got it, ride marked as declined.")
      : (fr ? "Aucune course récente à marquer." : "No recent ride to mark.")
    return .result(dialog: dialog)
  }
}

@available(iOS 16.2, *)
struct StriveAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AnalyzeRideIntent(),
      phrases: [
        "Analyser une course avec \(.applicationName)",
        "\(.applicationName) analyse cette capture",
      ],
      shortTitle: "Analyser une course",
      systemImageName: "car.fill"
    )
    AppShortcut(
      intent: RideTakenVoiceIntent(),
      phrases: [
        "Course prise avec \(.applicationName)",
        "\(.applicationName) course prise",
        "Ride taken with \(.applicationName)",
        "\(.applicationName) ride taken",
      ],
      shortTitle: "Course prise",
      systemImageName: "checkmark.circle.fill"
    )
    AppShortcut(
      intent: RideDeclinedVoiceIntent(),
      phrases: [
        "Course refusée avec \(.applicationName)",
        "\(.applicationName) course refusée",
        "Ride declined with \(.applicationName)",
        "\(.applicationName) ride declined",
      ],
      shortTitle: "Course refusée",
      systemImageName: "xmark.circle.fill"
    )
  }
}

import AppIntents
import UIKit
import UserNotifications
import ActivityKit
import CallKit

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

    // Jeton présent mais périmé. Le scan aurait tourné puis échoué à l'appel de
    // `gemini-proxy` : autant le dire tout de suite, avant l'OCR.
    //
    // Le message NE DIT PAS « reconnectez-vous ». Un jeton d'accès expiré ne
    // signifie pas que le compte est déconnecté : le refresh token reste valide
    // des semaines, et il suffit que l'app s'ouvre pour que tout reparte.
    // Annoncer une déconnexion ferait croire au chauffeur qu'il a perdu son
    // compte, en pleine journée de travail, pour quelque chose que deux
    // secondes d'ouverture corrigent.
    //
    // `session_off` au journal : le vocabulaire de `log_scan_failure` est fermé
    // et n'a pas de motif propre à ce cas. C'est la même famille — session
    // inutilisable — même si la cause diffère.
    guard !isSessionExpired else {
      sendLocalNotification(
        title: "Strive",
        body: localizedString(
          "notif.sessionStale",
          fr: "Ouvrez Strive pour réactiver le scan.",
          en: "Open Strive to reactivate scanning."
        )
      )
      logFailure("session_off")
      return .result(value: "session_stale")
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

    // AVANT le plafond du compte, et surtout avant le décodage de l'image : un
    // scan interdit ne doit coûter ni OCR, ni TomTom, ni Gemini. C'est tout
    // l'intérêt de tenir le compteur d'appareil ici plutôt que de laisser le
    // serveur refuser l'insertion — à ce moment-là, la dépense est déjà faite.
    guard !isDeviceQuotaReached else {
      sendLocalNotification(
        title: "Strive",
        // Sans chiffre, comme le message voisin : ce process ne connaît que la
        // limite poussée par le JS, et `plan_limits` est modifiable en base.
        body: localizedString(
          "notif.quotaDevice",
          fr: "Ce téléphone a déjà utilisé ses scans gratuits du jour, avec un autre compte. Revenez demain ou passez à Plus.",
          en: "This phone has already used today's free scans, on another account. Come back tomorrow or go Plus."
        )
      )
      logFailure("quota_reached")
      return .result(value: "device_quota_reached")
    }

    guard !isQuotaReached else {
      // Un free a une porte de sortie qui existe, elle : l'abonnement. On la lui
      // montre au seul moment où elle est vraie ET utile — il vient de buter sur
      // sa limite, sur une course qu'il ne pourra pas évaluer.
      //
      // Toujours pas de mention des CRÉDITS, en revanche : la boutique n'est pas
      // ouverte (`shop.comingSoonSub` — « la boutique de crédits sera bientôt
      // accessible »). Renvoyer vers un achat impossible depuis une
      // notification, c'est promettre une porte qui n'existe pas.
      //
      // Et pas de chiffre : ce process ne connaît que la limite du tier COURANT
      // (`scanQuotaLimit`), pas celle de Plus, et `plan_limits` est modifiable en
      // base. Annoncer « 15 » d'ici, c'est risquer d'annoncer faux. La
      // notification côté app, elle, a la vraie valeur et la donne.
      let isFree = (UserDefaults(suiteName: appGroupId)?.object(forKey: "isFreeTier") as? Bool) ?? true
      sendLocalNotification(
        title: "Strive",
        body: isFree
          ? localizedString(
              "notif.quotaFree",
              fr: "Quota journalier atteint — passez à Plus pour continuer à scanner aujourd'hui.",
              en: "Daily quota reached — go Plus to keep scanning today."
            )
          : localizedString(
              "notif.quota",
              fr: "Quota journalier atteint — revenez demain.",
              en: "Daily quota reached — come back tomorrow."
            )
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

    // Préchauffe ActivityKit MAINTENANT, pas au moment d'afficher.
    //
    // Le raccourci relance souvent le process À FROID, et `Activity.activities`
    // s'y remplit de façon asynchrone : `presentResult` trouvait la liste vide et
    // devait l'attendre en dormant (`waitForLiveActivity`, jusqu'à 1,5 s). Ce
    // délai s'intercalait entre le geste du chauffeur et l'update — la fenêtre
    // même qui vaut à la carte sa priorité d'affichage (voir `runPipeline`). Le
    // verdict finissait par s'afficher, mais l'île ne se dépliait plus : symptôme
    // « seul le premier scan ne s'affiche pas en étendu ».
    //
    // Ici, la connexion s'établit pendant l'OCR, TomTom et Gemini — du temps
    // qu'on passait de toute façon à attendre. Non bloquant.
    if #available(iOS 16.2, *), liveActivityReady {
      LiveActivityManager.shared.prewarm()
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
          // Adresses présentes → on présente. Sinon (ou aucun résultat) →
          // « scan échoué » affiché DANS la Live Activity, et RIEN n'est
          // enregistré : sans les deux adresses, pas de géocodage TomTom, et le
          // Dashboard refuse de toute façon la course (métriques non fiables).
          // Il n'y a plus de repli Gemini pour les rattraper.
          if let result = finalResult, self.hasBothAddresses(result) {
            // La continuation n'est reprise qu'une fois la course écrite en base :
            // `perform` rendu, iOS suspend le process et tuerait la requête en vol.
            self.presentResult(result) { value in
              once.resume(value)
              sem.signal()
            }
            return
          }
          self.presentFailure()
          once.resume("no_ride")
          sem.signal()
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

  // MARK: - Présentation résultat / échec

  private func hasBothAddresses(_ result: ScanProcessor.FinalResult) -> Bool {
    let p = result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let d = result.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !p.isEmpty && !d.isEmpty
  }

  /// Affiche le résultat (Live Activity ou notif) + l'enregistre pour l'app.
  ///
  /// `rideId` est frappé ICI, avant tout affichage et toute écriture : c'est
  /// l'identité de la course. Il part avec la carte (boutons Prise/Refusée),
  /// avec la notification de repli (`userInfo`), dans le journal App Group, et
  /// jusqu'à `rides.id`. Une seule valeur pour tout le trajet — c'est ce qui
  /// permet à un tap sur le lock screen de désigner la course sans que rien
  /// n'ait à la retrouver. `scanTs`, lui, ne fait plus que la dater.
  ///
  /// `done` est appelé quand TOUT est écrit, écriture en base comprise : c'est ce
  /// qui maintient le process en vie le temps de la requête. Le callback TomTom
  /// peut arriver sur le main thread ; on le déporte alors pour laisser
  /// `waitForLiveActivity` récupérer une carte dans un process relancé à froid.
  private func presentResult(
    _ result: ScanProcessor.FinalResult,
    geminiUsed: Bool = false,
    done: @escaping (String) -> Void
  ) {
    // TomTom et Gemini rappellent sur le main thread. `waitForLiveActivity()` ne
    // doit jamais attendre là, donc l'ancien chemin court-circuitait précisément
    // la récupération de l'activité après un lancement à froid.
    if Thread.isMainThread {
      DispatchQueue.global(qos: .userInitiated).async {
        self.presentResult(result, geminiUsed: geminiUsed, done: done)
      }
      return
    }
    // Verrou anti double-appui libéré dès qu'on a un résultat à montrer.
    ScanProcessor.markScanFinished()

    // RIEN N'A ÉTÉ MESURÉ → RIEN N'EST MONTRÉ, RIEN N'EST ENREGISTRÉ.
    //
    // Sans cette garde, un itinéraire manquant retombait ici avec la distance et
    // la durée LUES SUR L'ÉCRAN — celles de la plateforme — et les présentait
    // avec le même verdict coloré qu'une vraie mesure. Deux chauffeurs côte à
    // côte sur la même course ont vu 100 €/h et 38 €/h ; le second avait raison.
    // Strive existe pour contester le chiffre de la plateforme : le réafficher
    // en silence sous ses propres couleurs était le seul bug qu'elle n'avait pas
    // le droit d'avoir.
    if result.routeStatus != .ok {
      presentRouteFailure(result.routeStatus, done: done)
      return
    }

    let scanTs = Date().timeIntervalSince1970
    let rideId = UUID().uuidString
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
        verdictLevel: result.verdictLevel, rideId: rideId
      )
    }
    // ── Appel en cours : la carte affiche, mais l'îlot ne se déplie pas ──
    //
    // Pendant un appel, la pilule d'appel occupe le créneau ATTACHÉ du Dynamic
    // Island. Strive est reléguée au cercle `minimal` détaché et ne se déplie
    // plus d'elle-même, `AlertConfiguration` ou pas — il faut un appui manuel
    // pour lire le détail. Aucune API ne permet de réclamer le créneau.
    //
    // Le repli notification existait déjà, mais il ne se déclenche que si la
    // carte REFUSE l'update. Ici elle l'accepte parfaitement : `shown` vaut
    // true, et le chauffeur n'avait donc qu'un rond de couleur, sans les
    // chiffres, au moment précis où il a dix secondes pour décider.
    //
    // On envoie donc la notification EN PLUS de la carte quand un appel est en
    // cours. Elle porte le détail complet et les boutons Accepter/Refuser, et
    // une bannière par-dessus un écran d'appel est plus visible qu'une pastille
    // de 20 pt. C'est le seul cas où les deux surfaces partent ensemble.
    if shown && Self.hasActiveCall() {
      let verdict = result.verdictLevel == 2 ? "✅" : result.verdictLevel == 1 ? "⚠️" : "❌"
      sendLocalNotification(
        title: "\(result.scan.platform.rawValue) · \(striveFareText(result.displayFare)) · \(verdict)",
        // Quatre unités dans une ligne, et trois dépendent du marché.
        body: [
          StriveMarket.perHour(result.hourlyRate),
          StriveMarket.perDistance(result.kmRate),
          "\(result.totalDurationMin)min",
          StriveMarket.distanceText(result.totalDistanceKm),
        ].joined(separator: " · "),
        category: "STRIVE_SCAN_RESULT", rideId: rideId,
        // Même niveau que le repli : un verdict de course ne vaut que dans les
        // secondes qui suivent, et un chauffeur en appel est justement celui qui
        // risque le plus de le manquer.
        level: .timeSensitive
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
      //
      // Le cas (a) est désormais tracé LUI AUSSI, sous le même motif mais avec un
      // `detail` qui l'en distingue. Raison : on n'atteint cette ligne que si la
      // session est en ligne (garde de `perform`), et une session en ligne SANS
      // carte n'est pas si anodine — c'est la signature du process relancé à
      // froid, que `waitForLiveActivity` vient couvrir. Sans cette trace, ce cas
      // n'apparaissait nulle part : ni carte, ni ligne en base.
      if liveActivityReady {
        logFailure(
          "la_start_failed",
          detail: Activity<StriveActivityAttributes>.activities.isEmpty
            ? "no_card_session_online"
            : "update_refused"
        )
      }
      let verdict = result.verdictLevel == 2 ? "✅" : result.verdictLevel == 1 ? "⚠️" : "❌"
      var body = [
        StriveMarket.perHour(result.hourlyRate),
        StriveMarket.perDistance(result.kmRate),
        "\(result.totalDurationMin)min",
        StriveMarket.distanceText(result.totalDistanceKm),
      ].joined(separator: " · ")
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
        title: "\(result.scan.platform.rawValue) · \(striveFareText(result.displayFare)) · \(verdict)",
        body: body,
        category: "STRIVE_SCAN_RESULT", rideId: rideId,
        // Le repli notification est justement le chemin emprunté quand la carte
        // n'a rien pu afficher : s'il est silencé par la Concentration, le
        // chauffeur ne reçoit alors STRICTEMENT rien de son scan.
        level: .timeSensitive
      )
    }
    markPresented()
    incrementScanCount()
    // Retour parlé à Siri : même devise que la carte, sinon le chiffre entendu
    // et le chiffre lu ne sont pas le même.
    let summary = [
      result.scan.platform.rawValue,
      StriveMarket.money(result.scan.fare, decimals: 2),
      StriveMarket.perHour(result.hourlyRate),
      StriveMarket.perDistance(result.kmRate),
    ].joined(separator: " · ")
    saveResultForMainApp(result, rideId: rideId, scanTs: scanTs, geminiUsed: geminiUsed) { done(summary) }
  }

  /// « Scan échoué » : affiché DANS la Live Activity (ou notif si LA désactivée).
  /// Rien n'est enregistré → l'app ne reçoit aucun résultat à rejeter.
  private func presentFailure() {
    ScanProcessor.markScanFinished()
    // `lastScanMayBeRide` distingue les deux causes : écran sans signal VTC
    // (on n'a même pas appelé Gemini) vs Gemini appelé mais sans réponse
    // exploitable. Sans ça les deux se confondent dans les agrégats.
    // `gemini_ko` = les règles ont calé ET Gemini n'a pas rattrapé. C'est l'écran
    // le plus précieux du parc : celui qu'aucun des deux lecteurs n'a su lire.
    logFailure(
      ScanProcessor.shared.lastScanMayBeRide ? "gemini_ko" : "not_a_ride",
      blocks: ScanProcessor.shared.lastScanMayBeRide ? ScanProcessor.shared.lastBlocksJson : nil,
      screenHeight: ScanProcessor.shared.lastScreenHeight
    )
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

  /// Itinéraire impossible : on le dit, et on n'enregistre rien.
  ///
  /// Deux motifs, deux messages — parce qu'ils ne se soignent pas pareil. Le
  /// réseau se retente sur place ; une adresse illisible demande une autre
  /// capture. Le code de support, lui, distingue les trois causes réelles
  /// (réseau, adresse, clé absente) sans les exposer au chauffeur.
  private func presentRouteFailure(
    _ status: RouteStatus,
    done: @escaping (String) -> Void
  ) {
    guard !hasPresented else { done(""); return }
    // L'écran a été lu (on a des adresses), c'est l'itinéraire qui manque — la
    // capture reste utile : elle dit quelles adresses le parser a produites, donc
    // ce que le géocodeur a refusé.
    logFailure(
      status.errorCode?.reason ?? "route_ko",
      blocks: status == .unusable ? ScanProcessor.shared.lastBlocksJson : nil,
      screenHeight: ScanProcessor.shared.lastScreenHeight
    )

    let body = status.isNetwork
      ? StriveNativeStrings.get("networkFailed") + " — " + StriveNativeStrings.get("networkRetry")
      : StriveNativeStrings.get("analysisFailed") + " — " + StriveNativeStrings.get("tryAnother")

    var shown = false
    if liveActivityReady {
      shown = LiveActivityManager.shared.showError(network: status.isNetwork)
    }
    if !shown {
      sendLocalNotification(
        title: "Strive",
        body: body,
        code: status.errorCode,
        // Le chauffeur a dix secondes pour décider : un verdict qui ne vient
        // pas doit se dire tout de suite, pas après l'expiration de l'offre.
        level: .timeSensitive
      )
    }
    markPresented()
    done(body)
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

  /// Marge d'horloge avant de déclarer un jeton périmé.
  ///
  /// La comparaison se fait avec l'horloge DU TÉLÉPHONE, celle-là même qui peut
  /// dériver. Un appareil légèrement en avance ferait passer pour mort un jeton
  /// encore accepté par le serveur, et refuserait un scan parfaitement valide.
  /// La marge penche donc du côté du doute : en cas d'hésitation on laisse
  /// scanner, et c'est le serveur qui tranche — il est seul à faire autorité.
  private static let jwtClockGrace: TimeInterval = 120

  /// Le jeton stocké est-il périmé ?
  ///
  /// `isSignedIn` ne vérifie que la PRÉSENCE du jeton. Or un jeton d'accès
  /// Supabase vit une heure, et il n'est renouvelé que par le JS — donc
  /// seulement quand l'app tourne. Un chauffeur qui n'a pas ouvert Strive depuis
  /// deux heures en a donc un, bien présent et parfaitement mort.
  ///
  /// Sans ce test, le scan partait quand même : Vision faisait l'OCR, puis
  /// `gemini-proxy` rejetait l'appel (il revalide le jeton par `getUser`, qui
  /// contrôle l'expiration). Le chauffeur attendait pour rien.
  ///
  /// On lit `exp` en décodant le payload, SANS vérifier la signature — inutile
  /// ici : ce test ne protège rien, il évite une dépense. Falsifier son propre
  /// jeton pour s'autoriser un scan que le serveur refusera ensuite n'a aucun
  /// intérêt.
  ///
  /// Toute anomalie de lecture rend `false` : jeton illisible, payload non
  /// conforme, `exp` absent. On ne bloque JAMAIS sur un doute — le pire cas
  /// dégradé est le comportement d'avant.
  private var isSessionExpired: Bool {
    guard let d = UserDefaults(suiteName: appGroupId),
          let jwt = d.string(forKey: "supabaseUserJwt"),
          !jwt.isEmpty
    else { return false }

    let parts = jwt.split(separator: ".")
    guard parts.count == 3 else { return false }

    // base64url → base64, puis padding à un multiple de 4. `Data(base64Encoded:)`
    // refuse les deux écarts, et un payload JWT n'est presque jamais padé.
    var b64 = String(parts[1])
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while b64.count % 4 != 0 { b64 += "=" }

    guard let data = Data(base64Encoded: b64),
          let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let exp = payload["exp"] as? Double
    else { return false }

    return Date().timeIntervalSince1970 > exp + Self.jwtClockGrace
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
    //
    // `scanQuotaLimit` est la limite EFFECTIVE poussée par le JS : celle du plan
    // PLUS les crédits achetés. Ce calcul ne connaît pas les crédits, et sans
    // eux il bloquait un chauffeur qui venait d'en acheter.
    let limit = d.integer(forKey: "scanQuotaLimit")
    if limit <= 0 { return false }   // -1 = premium (illimité)
    return Self.scanCountForToday(d) >= limit
  }

  /// Plafond de l'APPAREIL, tous comptes confondus — l'anti-farming par
  /// suppression de compte.
  ///
  /// `scanCountToday` ne peut pas servir à ça : le JS le réécrit à chaque
  /// ouverture du Dashboard avec le compteur que le SERVEUR tient pour le compte
  /// courant. Un compte neuf le remet donc à zéro, ce qui est exactement le
  /// geste qu'on veut rendre inopérant. D'où un second compteur, que le JS
  /// n'écrase jamais et que seul un scan incrémente.
  ///
  /// `deviceUsed > ownUsed` : au moins un AUTRE compte a scanné depuis ce
  /// téléphone aujourd'hui. Sans ce test, un chauffeur seul au bout de ses scans
  /// verrait « avec un autre compte » alors qu'il n'y en a qu'un — son propre
  /// plafond le refuse déjà, avec le bon motif.
  ///
  /// Comptes GRATUITS seulement : un abonné n'a rien à farmer, et le bloquer
  /// parce qu'un remplaçant a utilisé le téléphone serait le punir de ce qu'il
  /// a payé pour éviter.
  ///
  /// Miroir exact de la règle serveur (`enforce_scan_quota`, plafond
  /// d'appareil). Un écart entre les deux ferait refuser ici ce que la base
  /// accepte, ou l'inverse.
  private var isDeviceQuotaReached: Bool {
    guard let d = UserDefaults(suiteName: appGroupId) else { return false }
    guard (d.object(forKey: "isFreeTier") as? Bool) ?? true else { return false }
    // 0 = limite inconnue (JS jamais passé, première installation). On laisse
    // scanner : le serveur, lui, refusera si c'est vraiment du farming.
    let freeLimit = d.integer(forKey: "deviceFreeLimit")
    if freeLimit <= 0 { return false }
    let deviceUsed = Self.deviceScanCountForToday(d)
    return deviceUsed >= freeLimit && deviceUsed > Self.scanCountForToday(d)
  }

  /// Compteur du jour, en ignorant une valeur datée d'hier.
  private static func scanCountForToday(_ d: UserDefaults) -> Int {
    if d.integer(forKey: "scanCountDay") != currentQuotaDay(d) { return 0 }
    return d.integer(forKey: "scanCountToday")
  }

  /// Idem pour le compteur d'appareil. Même bornage par la date : le plafond
  /// d'appareil se rouvre chaque jour comme celui du compte.
  private static func deviceScanCountForToday(_ d: UserDefaults) -> Int {
    if d.integer(forKey: "deviceScanCountDay") != currentQuotaDay(d) { return 0 }
    return d.integer(forKey: "deviceScanCountToday")
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
    // Le compteur d'appareil suit le même scan, dans la même foulée : les deux
    // doivent bouger ensemble, sinon `deviceUsed > ownUsed` se déclenche sur un
    // écart d'écriture et le chauffeur se voit refuser pour « un autre compte »
    // qui n'existe pas.
    let deviceBase = d.integer(forKey: "deviceScanCountDay") == today
      ? d.integer(forKey: "deviceScanCountToday") : 0
    d.set(today, forKey: "deviceScanCountDay")
    d.set(deviceBase + 1, forKey: "deviceScanCountToday")
  }

  private func localizedString(_ key: String, fr: String, en: String) -> String {
    // Les sept langues d'abord (cf. `StriveNativeStrings`). Le couple fr/en
    // reste écrit ici : il sert de repli, et il garde la phrase lisible à
    // côté de son point d'usage.
    if let translated = StriveNativeStrings.forFrench(fr) { return translated }
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
  /// Observateur d'appels, retenu pour toute la vie du process.
  ///
  /// `CXCallObserver` doit être GARDÉ EN VIE : une instance créée puis relâchée
  /// dans la même expression peut rendre une liste vide avant d'avoir été
  /// peuplée. D'où ce `static let` plutôt qu'un `CXCallObserver().calls` en
  /// ligne, qui est le piège classique de cette API.
  private static let callObserver = CXCallObserver()

  /// Un appel est-il en cours ? Couvre le cellulaire comme la VoIP passant par
  /// CallKit (WhatsApp, Messenger…), qui occupent le créneau attaché de la même
  /// façon. Un appel qui sonne sans être décroché compte aussi : l'îlot est déjà
  /// pris.
  ///
  /// Aucune autorisation ni entitlement : c'est une simple lecture d'état.
  private static func hasActiveCall() -> Bool {
    callObserver.calls.contains { !$0.hasEnded }
  }

  private func sendLocalNotification(
    title: String,
    body: String,
    category: String? = nil,
    rideId: String? = nil,
    code: ScanErrorCode? = nil,
    level: UNNotificationInterruptionLevel = .active
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = code == nil ? body : "\(body) (\(code!.rawValue))"
    content.sound = .default
    content.interruptionLevel = level
    // Boutons Accepter/Refuser : la catégorie STRIVE_SCAN_RESULT est enregistrée
    // par l'app principale (AppDelegate). `rideId` DÉSIGNE la course — il n'y a
    // plus rien à corréler à la réception.
    if let category = category { content.categoryIdentifier = category }
    if let rideId = rideId { content.userInfo = ["rideId": rideId] }
    let request = UNNotificationRequest(identifier: "strive-scan-\(UUID().uuidString)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  // MARK: - App Group

  /// Empile un ÉCHEC dans l'App Group. L'AppIntent tourne dans un autre process,
  /// sans session Supabase : il ne peut pas écrire la trace lui-même. L'app la
  /// relève au prochain passage au premier plan (`occurredAt` conserve l'heure
  /// réelle). Sans ça, un scan qui casse ici ne laisse aucune trace nulle part —
  /// c'est ce qui a rendu invisible le bug « ça scanne mais rien ne s'affiche ».
  /// Trace d'un scan qui n'aboutit pas.
  ///
  /// `blocks` joint LA CAPTURE qui a causé l'échec. Sans elle, `scan_debug` ne
  /// se remplissait que sur les scans qui RÉUSSISSENT — la capture était écrite
  /// après l'enregistrement de la course. Les écrans les plus durs, ceux que ni
  /// les règles ni Gemini n'ont su lire, ne laissaient donc rien à rejouer : on
  /// comptait les échecs sans jamais pouvoir les corriger. Ce sont pourtant les
  /// seuls qui feraient progresser le parser.
  private func logFailure(
    _ reason: String,
    detail: String? = nil,
    blocks: String? = nil,
    screenHeight: Int? = nil
  ) {
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
    // Plafond de taille : un dump OCR pèse quelques dizaines de Ko et cette file
    // vit dans l'App Group, relevée seulement au prochain passage de l'app. Mieux
    // vaut une capture perdue qu'un `UserDefaults` obese.
    if let blocks = blocks, blocks.count <= 96_000 {
      entry["blocks"] = blocks
      if let h = screenHeight, h > 0 { entry["screenHeight"] = h }
    }
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
    rideId: String,
    scanTs: Double,
    geminiUsed: Bool = false,
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
      // Identité de la course. Portée par le payload lui-même : dans la file,
      // chaque entrée doit être auto-suffisante.
      "rideId": rideId,
      // Tarif d'AFFICHAGE (net de carburant si l'option est active). `fare`
      // reste brut : c'est lui qui est enregistré en base.
      "displayFare": result.displayFare,
      // Le parsing local a-t-il dû passer la main à Gemini ?
      //
      // Sans ce booléen, le JS ne voyait que SON propre fallback (celui de
      // DashboardScreen), qui ne sert jamais quand le scan vient du raccourci :
      // `scan_events` enregistrait donc `gemini_fallback = false` sur 100 % des
      // scans — une constante, pas une mesure, et le coût unitaire de l'appel
      // LLM restait invisible. Les ÉCHECS remontaient déjà (`logFailure`
      // "gemini_ko") ; il manquait les réussites, seules à coûter un appel.
      "geminiUsed": geminiUsed,
    ]
    if let pickup = result.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = result.scan.destinationAddress { body["destinationAddress"] = dest }

    // Diagnostic parser : blocs OCR joints quand le parsing local n'a pas suffi.
    //
    // La condition était « une adresse manque », et elle ne s'est JAMAIS
    // déclenchée en production : le fallback Gemini natif remplit les adresses
    // avant que ce code s'exécute, si bien que `scan_debug` est restée vide
    // depuis sa création — et qu'aucun cas réel n'a jamais alimenté les
    // fixtures. `geminiUsed` est le vrai signal : il désigne exactement les
    // écrans que le parser par règles n'a pas su lire.
    if geminiUsed
      || result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
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
      ["rideId": rideId, "fare": result.displayFare, "km": result.totalDistanceKm],
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
    RideUploader.upload(result, rideId: rideId, scanTs: scanTs)
    done()
  }
}

// MARK: - Commandes vocales « course prise / refusée » (Siri, mains libres)

/// Écrit la décision pour la DERNIÈRE course scannée (`lastTaggableRide`) dans
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
  // `lastTaggableRide` et pas la file des scans : celle-ci est vidée entrée par
  // entrée dès que la course est en base, si bien qu'après une simple ouverture
  // de Strive, Siri répondait « aucune course récente à marquer » sur une course
  // tout juste scannée. Cette clé, elle, survit à la relève — elle n'est
  // réécrite qu'au scan suivant.
  guard let rideId = defaults.dictionary(forKey: "lastTaggableRide")?["rideId"] as? String,
        !rideId.isEmpty
  else { return false }

  // Persistance AVANT l'await, même raison que dans `RideDecisionIntent` : ce
  // process peut être suspendu pendant `activity.update`, et ce qui suit l'await
  // ne s'exécute alors jamais. La décision passe donc en premier.
  appendRideDecision(rideId: rideId, accepted: accepted, appGroupId: appGroupId)

  // Incrément KPI du jour + retour à l'état de base, IMMÉDIAT et sans JS
  // (helpers partagés avec le bouton Live Activity).
  if #available(iOS 16.2, *) {
    let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
    await revertLiveActivityToIdle(rideId: rideId, addFare: add.fare, addKm: add.km)
  }
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

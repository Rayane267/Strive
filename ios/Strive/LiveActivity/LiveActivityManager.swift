import Foundation
import ActivityKit
import UIKit

#if canImport(Sentry)
import Sentry
#endif

@available(iOS 16.2, *)
final class LiveActivityManager {

  static let shared = LiveActivityManager()
  private init() {}

  // ── État partagé ──────────────────────────────────────────────────────────
  //
  // Ce singleton est touché depuis QUATRE contextes d'exécution concurrents :
  //   • la queue de module React Native (bridge JS : start/update/stop/KPI),
  //   • le main thread (`autoDismiss` → backToIdle, didBecomeActive),
  //   • un thread de fond arbitraire (AnalyzeRideIntent appelle update() depuis
  //     le callback de ScanProcessor),
  //   • les `Task` de `observeState`.
  // Sans synchronisation, un scan par raccourci pendant que le JS pousse ses KPI
  // écrivait `current` depuis deux threads à la fois : l'app pilotait alors une
  // carte qui n'était plus celle affichée — verdict qui ne s'affiche pas, carte
  // figée sur un état ancien, sans crash ni erreur, donc introuvable en test.
  //
  // Verrou RÉCURSIF : un accesseur peut être appelé depuis une section déjà
  // verrouillée (ex. `liveActivity()` qui lit puis écrit `current`).
  // ⚠️ Ne JAMAIS tenir ce verrou pendant une attente (`sem.wait`, `await`) ni
  // pendant `Activity.request()` : il ne protège que les accès individuels aux
  // trois propriétés ci-dessous. Les séquences lire-puis-agir restent possibles,
  // mais elles sont sans danger — `applyUpdate` revalide `activityState` avant
  // d'écrire, et une update sur une carte morte est ignorée par iOS.
  private let stateLock = NSRecursiveLock()

  private var _current: Activity<StriveActivityAttributes>?
  private var current: Activity<StriveActivityAttributes>? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _current }
    set { stateLock.lock(); _current = newValue; stateLock.unlock() }
  }

  private var _autoDismiss: DispatchWorkItem?
  private var autoDismiss: DispatchWorkItem? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _autoDismiss }
    set { stateLock.lock(); _autoDismiss = newValue; stateLock.unlock() }
  }

  private var _stateObserverTask: Task<Void, Never>?
  private var stateObserverTask: Task<Void, Never>? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _stateObserverTask }
    set { stateLock.lock(); _stateObserverTask = newValue; stateLock.unlock() }
  }

  /// Dernier état poussé PAR CE PROCESS, avec sa date et la carte visée.
  ///
  /// `activity.content.state` n'est pas ce qu'on vient d'écrire : c'est l'écho
  /// d'ActivityKit, rafraîchi seulement quand le démon système a confirmé
  /// l'update. Toute méthode qui lisait `content.state` pour « garder ce qui est
  /// affiché » lisait donc l'état d'AVANT pendant quelques millisecondes.
  ///
  /// Concrètement : `update()` pousse un verdict, l'événement part au JS dans la
  /// foulée, le Dashboard pousse ses KPI sur changement de `rides` — et
  /// `updateSessionKPI` relit un écho encore à l'état précédent. S'il valait
  /// `IDLE`, elle conclut qu'aucun résultat n'est affiché et réécrit un IDLE
  /// par-dessus le verdict ; s'il portait la course d'AVANT, elle recopie les
  /// chiffres de celle-là sur le scan qui vient d'arriver. Les deux updates
  /// étant à quelques millisecondes d'écart, seule la dernière est rendue.
  ///
  /// ⚠️ Ce n'est PAS ce qui empêche un résultat de déplier le Dynamic Island :
  /// quand le cercle `minimal` affiche bien le verdict, l'état est arrivé et
  /// rien ne l'a écrasé. Ce cas-là ne dépend pas de nous — voir la note sur
  /// l'alerte dans `update()`.
  private var _lastPushed: (state: StriveActivityAttributes.ContentState, at: Date, activityId: String)?
  private var lastPushed: (state: StriveActivityAttributes.ContentState, at: Date, activityId: String)? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _lastPushed }
    set { stateLock.lock(); _lastPushed = newValue; stateLock.unlock() }
  }

  /// Au-delà de ce délai, l'écho fait foi de nouveau.
  ///
  /// Ce mémo ne vaut que pour ce process : `revertLiveActivityToIdle` (boutons
  /// ✅/❌ de la carte) écrit sans passer par ce manager, et l'AppIntent peut
  /// tourner ailleurs. Sans plafond, on ressusciterait un état que quelqu'un
  /// d'autre a déjà remplacé. Le retard de l'écho se compte en millisecondes ;
  /// cinq secondes le couvrent très largement.
  private static let echoLagWindow: TimeInterval = 5

  private static let appGroupId = "group.com.striveapp.app"
  /// Dernier état de session connu (KPI du jour + ancre du timer), rejoué quand
  /// iOS a retiré la carte alors que la session continue.
  private static let sessionSnapshotKey = "laSessionSnapshot"
  /// Drapeau de la trace persistée, piloté depuis l'écran Diagnostic.
  static let tracingKey = "laTracing"
  static let traceKey = "laSteps"
  static let lastStepKey = "laLastStep"

  /// Résout la langue UI (fr/en) : préférence poussée par l'app via l'App Group
  /// (`appLanguage`), sinon locale système. Même logique que la Share Extension
  /// et l'AppIntent — le texte des alertes s'affichait jusqu'ici en français
  /// quelle que soit la langue de l'utilisateur.
  private func localizedString(fr: String, en: String) -> String {
    // Anglais uniquement si l'app est réglée en anglais, français sinon — la
    // locale système ne fait PAS foi (cf. laString côté widget).
    guard let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    else { return fr }
    return appLang.hasPrefix("en") ? en : fr
  }

  /// `NSLog` est conservé en toutes configurations (diagnostic via Console.app,
  /// sans I/O disque). La trace persistée dans l'App Group, elle, est réservée
  /// au DEBUG : en production elle faisait une lecture + deux écritures dans un
  /// conteneur partagé entre trois process, à CHAQUE appel — sur le chemin chaud
  /// du scan — et laissait des données de diagnostic sur l'appareil sans finalité.
  private func log(_ msg: String) {
    NSLog("[Strive:LA] %@", msg)
    // La trace persistée est OPT-IN, plus réservée au DEBUG.
    //
    // Elle avait été coupée en production pour une bonne raison : une lecture et
    // deux écritures dans un conteneur partagé entre trois process, à chaque
    // appel, sur le chemin chaud du scan — et des données de diagnostic laissées
    // sur l'appareil sans finalité. Ce raisonnement tient toujours, d'où le
    // drapeau : éteint par défaut, le coût retombe à UNE lecture de dictionnaire,
    // et rien n'est écrit. Allumé depuis l'écran Diagnostic, elle permet de lire
    // la trace sans Mac ni Console.app — le seul moyen jusqu'ici.
    guard let defaults = UserDefaults(suiteName: Self.appGroupId),
          defaults.bool(forKey: Self.tracingKey)
    else { return }
    var trace = defaults.string(forKey: "laSteps") ?? ""
    let fmt = DateFormatter()
    fmt.dateFormat = "HH:mm:ss.SSS"
    trace += "[\(fmt.string(from: Date()))] \(msg)\n"
    if trace.count > 2000 { trace = String(trace.suffix(2000)) }
    defaults.set(trace, forKey: "laSteps")
    defaults.set(msg, forKey: "laLastStep")
  }

  @discardableResult
  func start(
    platform: String,
    fare: Double = 0,
    hourlyRate: Double = 0,
    kmRate: Double = 0,
    distanceKm: Double = 0,
    durationMin: Int = 0,
    verdictLevel: Int = 1,
    todayEarnings: Double = 0,
    todayHourlyRate: Double = 0,
    todayKm: Double = 0,
    onlineMinutes: Int = 0,
    rideId: String = "",
    sessionStartEpoch: Double = 0
  ) -> Bool {
    log("start(\(platform)) fare=\(fare) hr=\(hourlyRate) km=\(kmRate)")

    let existingCount = Activity<StriveActivityAttributes>.activities.count
    // Une SEULE lecture de `current` : le `x == nil ? … : x!.id` d'origine en
    // faisait deux, et un autre thread qui remettait la carte à nil entre les
    // deux faisait planter le force-unwrap — sur une simple ligne de log.
    log("existing=\(existingCount) current=\(current?.id ?? "nil")")

    // Termine TOUTE activité existante (pas seulement `current`) : l'AppIntent
    // tourne dans un autre process et peut avoir laissé une activité orpheline
    // → sinon deux cartes s'empilent sur le lock screen (résultat + session).
    let existing = Activity<StriveActivityAttributes>.activities
    if !existing.isEmpty {
      log("ending \(existing.count) existing activity(ies)")
      // Couper l'observer avant de terminer la carte explicitement : cette
      // branche ne sert qu'au démarrage volontaire d'une nouvelle session.
      stateObserverTask?.cancel()
      stateObserverTask = nil
      for activity in existing {
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
      }
      self.current = nil
    }

    let attributes = StriveActivityAttributes()
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel,
      todayEarnings: todayEarnings,
      todayHourlyRate: todayHourlyRate,
      todayKm: todayKm,
      onlineMinutes: onlineMinutes,
      rideId: rideId.isEmpty ? nil : rideId,
      sessionStartEpoch: sessionStartEpoch > 0 ? sessionStartEpoch : nil
    )

    do {
      let content = ActivityContent(
        state: state,
        staleDate: Date().addingTimeInterval(3600 * 8),
        relevanceScore: 100
      )
      log("calling Activity.request()...")
      current = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      log("OK id=\(current?.id ?? "nil")")
      observeState()
      if let created = current { rememberPush(state, on: created) }
      saveSessionSnapshot(state)
      return true
    } catch {
      log("FAILED: \(error.localizedDescription) domain=\((error as NSError).domain) code=\((error as NSError).code)")
      return false
    }
  }

  /// Mémorise l'état de session (KPI du jour + ancre du timer) dans l'App Group.
  /// C'est la seule copie qui survit à la mort de la carte : sans elle, une carte
  /// recréée repartirait à 0 € / 0 km / timer remis à zéro.
  private func saveSessionSnapshot(_ s: StriveActivityAttributes.ContentState) {
    guard let d = UserDefaults(suiteName: Self.appGroupId) else { return }
    var snap: [String: Any] = [
      "todayEarnings": s.todayEarnings,
      "todayHourlyRate": s.todayHourlyRate,
      "todayKm": s.todayKm,
      "onlineMinutes": s.onlineMinutes,
    ]
    if let start = s.sessionStartEpoch { snap["sessionStartEpoch"] = start }
    d.set(snap, forKey: Self.sessionSnapshotKey)
  }

  /// Mémorise ce qu'on vient d'écrire, pour que la prochaine lecture ne dépende
  /// pas du délai de retour d'ActivityKit.
  private func rememberPush(_ state: StriveActivityAttributes.ContentState,
                            on activity: Activity<StriveActivityAttributes>) {
    lastPushed = (state: state, at: Date(), activityId: activity.id)
  }

  /// L'état le plus récent CONNU de la carte.
  ///
  /// À utiliser partout où l'on lit l'état courant pour « garder ce qui est
  /// affiché » : `activity.content.state` seul est l'écho d'ActivityKit, en
  /// retard de quelques millisecondes sur nos propres écritures. Trois règles :
  ///
  ///  1. l'écho a rattrapé notre dernière écriture → il fait foi, on oublie le
  ///     mémo (un autre process pourra écrire sans qu'on le contredise) ;
  ///  2. notre écriture a moins de `echoLagWindow` et l'écho diffère → l'écho
  ///     est en retard, notre mémo fait foi ;
  ///  3. au-delà de la fenêtre → l'écho fait foi (`revertLiveActivityToIdle`,
  ///     déclenché par les boutons de la carte, écrit sans passer par ici).
  private func freshestState(of activity: Activity<StriveActivityAttributes>)
    -> StriveActivityAttributes.ContentState {
    let echo = activity.content.state
    guard let memo = lastPushed, memo.activityId == activity.id else { return echo }
    if echo == memo.state {
      lastPushed = nil
      return echo
    }
    guard Date().timeIntervalSince(memo.at) < Self.echoLagWindow else {
      lastPushed = nil
      return echo
    }
    // Écriture d'un autre chemin (boutons ✅/❌ → `revertLiveActivityToIdle`)
    // postérieure à la nôtre : c'est elle qui est à l'écran, pas notre mémo.
    if let foreign = UserDefaults(suiteName: Self.appGroupId)?
         .object(forKey: "laForeignWriteAt") as? Double,
       foreign > memo.at.timeIntervalSince1970 {
      lastPushed = nil
      return echo
    }
    return memo.state
  }

  /// Réarme uniquement l'affichage d'une session encore active. Une fermeture
  /// par iOS ne ferme jamais la session métier : seul le Dashboard peut le faire.
  /// Cette méthode est appelée quand Strive revient au premier plan, jamais à la
  /// réception d'un scan en arrière-plan.
  @discardableResult
  func ensureRunning() -> Bool {
    guard let d = UserDefaults(suiteName: Self.appGroupId), d.bool(forKey: "sessionOnline") else {
      return false
    }
    let prefOn = d.object(forKey: "useLiveActivity") == nil ? true : d.bool(forKey: "useLiveActivity")
    guard prefOn, ActivityAuthorizationInfo().areActivitiesEnabled, liveActivity() == nil else {
      return false
    }
    let snap = d.dictionary(forKey: Self.sessionSnapshotKey) ?? [:]
    return start(
      platform: "IDLE",
      todayEarnings: (snap["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
      todayHourlyRate: (snap["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
      todayKm: (snap["todayKm"] as? NSNumber)?.doubleValue ?? 0,
      onlineMinutes: (snap["onlineMinutes"] as? NSNumber)?.intValue ?? 0,
      sessionStartEpoch: (snap["sessionStartEpoch"] as? NSNumber)?.doubleValue ?? 0
    )
  }

  /// Retourne une activité RÉELLEMENT vivante. `activities.first` peut rendre une
  /// carte orpheline ou déjà `.dismissed` (l'AppIntent tourne dans un autre
  /// process, `current` peut être périmé) : on la met alors à jour, iOS ignore, et
  /// l'appelant croit avoir affiché le résultat.
  private func liveActivity() -> Activity<StriveActivityAttributes>? {
    if let c = current, c.activityState == .active { return c }
    let live = Activity<StriveActivityAttributes>.activities.first { $0.activityState == .active }
    current = live
    if live != nil {
      observeState()
      log("recovered live activity: \(live!.id)")
    }
    return live
  }

  /// Ouvre la connexion ActivityKit AVANT d'en avoir besoin.
  ///
  /// Dans un process relancé à froid par le raccourci, `Activity.activities` se
  /// remplit de façon asynchrone : au moment de présenter le verdict, la liste
  /// est encore vide et `waitForLiveActivity` DORT jusqu'à 1,5 s avant de pouvoir
  /// pousser quoi que ce soit. Ce délai s'intercale entre le geste du chauffeur
  /// et l'update — or c'est la fenêtre de l'intent qui vaut à la carte sa
  /// priorité d'affichage (voir `AnalyzeRideIntent.runPipeline` : « tant que
  /// l'intent est en cours, la présentation est traitée comme une action
  /// déclenchée par l'utilisateur et passe devant »).
  ///
  /// Le contenu finissait par arriver — la pastille du Dynamic Island changeait
  /// bien de couleur — mais le dépliage bref que déclenche l'alerte, lui, était
  /// passé. C'est ce qui distinguait le PREMIER scan (process froid, 1,5 s
  /// d'attente) de tous les suivants (process chaud, aucune attente).
  ///
  /// Appelée au DÉBUT du scan, elle laisse ActivityKit rejoindre le démon
  /// système pendant l'OCR, TomTom et Gemini — du temps qu'on passait de toute
  /// façon à attendre. Ne bloque pas l'appelant : lecture seule, sur un thread de
  /// fond, abandonnée dès que la carte apparaît.
  func prewarm() {
    // `.userInitiated` et non `.utility` : ce préchauffage est sur le chemin
    // critique de la fonctionnalité clé de l'app. En `.utility` — la classe la
    // plus basse — il se faisait dépasser par l'OCR et le réseau précisément
    // dans le cas qu'il doit couvrir : un process à froid, donc chargé. Il
    // arrivait alors trop tard, et `waitForLiveActivity` héritait du travail
    // avec 1,5 s seulement.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
      // 20 × 0,25 s = 5 s, contre 2 s auparavant. Le pipeline complet (OCR,
      // TomTom, parfois Gemini) dépasse régulièrement 2 s : prewarm abandonnait
      // alors qu'il restait tout le temps du monde avant l'arrivée du résultat.
      // Rallonger ne coûte RIEN — la boucle est concurrente au scan, en lecture
      // seule, et sort dès que la carte est là.
      for i in 0..<20 {
        // Test AVANT la pause : une carte déjà présente était trouvée avec
        // 250 ms de retard, sur chaque scan, pour rien.
        if self.liveActivity() != nil {
          self.log("prewarm: carte prête (\(i) tours)")
          return
        }
        Thread.sleep(forTimeInterval: 0.25)
      }
      self.log("prewarm: aucune carte après 5 s")
    }
  }

  /// Seconde chance quand `Activity.activities` n'est pas ENCORE peuplée.
  ///
  /// Le cas visé : le chauffeur est en communication, Waze tourne, et iOS a
  /// évincé Strive de la mémoire. Le raccourci relance donc le process À FROID
  /// pour analyser l'écran — et dans un process qui vient de démarrer, la liste
  /// des activités se remplit de façon asynchrone, le temps qu'ActivityKit
  /// rejoigne le démon système. `liveActivity()` la trouve vide, `update()`
  /// abandonne, et le verdict n'apparaît nulle part : la carte est pourtant bien
  /// là, à l'écran, avec sa session.
  ///
  /// C'est ce qui donnait « pendant un appel le résultat ne s'affiche plus, et
  /// après un clic ça remarche » — le clic ne débloquait rien, il gardait
  /// simplement le process chaud pour les scans suivants.
  ///
  /// JAMAIS sur le main thread : le bridge JS appelle depuis là, et ce
  /// process-là est chaud par construction — sa liste est déjà peuplée, il n'y a
  /// rien à attendre. Bloquer y gèlerait l'UI pour rien.
  private func waitForLiveActivity() -> Activity<StriveActivityAttributes>? {
    guard !Thread.isMainThread else { return nil }
    // Une session fermée n'a pas de carte à attendre — c'est l'état normal, pas
    // une liste en retard.
    guard UserDefaults(suiteName: Self.appGroupId)?.bool(forKey: "sessionOnline") == true else {
      return nil
    }
    // 1,5 s au plus, et volontairement PAS davantage : contrairement à
    // `prewarm`, cette attente est sur le chemin critique — le résultat est déjà
    // calculé, et chaque quart de seconde ici retarde d'autant le repli
    // notification, sur une fenêtre de décision de dix secondes. C'est à prewarm
    // de couvrir le démarrage à froid, pas à cette seconde chance.
    for i in 0..<6 {
      // Test AVANT la pause, comme dans prewarm : `liveActivity()` a pu être
      // renseignée entre-temps par le préchauffage, et attendre 250 ms pour s'en
      // apercevoir était du délai pur.
      if let live = liveActivity() {
        log("live activity trouvée après \(i) tours d'attente")
        return live
      }
      Thread.sleep(forTimeInterval: 0.25)
    }
    log("aucune activité après 1,5 s — session en ligne mais pas de carte")
    return nil
  }

  /// Applique une mise à jour et CONFIRME qu'elle a bien été appliquée sur une
  /// activité encore vivante. Le `Task { await … }` d'origine rendait la main
  /// avant même que l'update soit tentée : `update()` renvoyait `true` et le
  /// fallback notification était sauté alors que le chauffeur n'avait rien vu.
  /// Sur le main thread on ne bloque pas (le bridge JS appelle depuis là) — le
  /// contrôle d'état préalable fait foi.
  private func applyUpdate(
    _ activity: Activity<StriveActivityAttributes>,
    content: ActivityContent<StriveActivityAttributes.ContentState>,
    alert: AlertConfiguration?
  ) -> Bool {
    guard activity.activityState == .active else {
      log("update skipped — \(activity.id) is \(activity.activityState)")
      return false
    }
    if Thread.isMainThread {
      Task { await activity.update(content, alertConfiguration: alert) }
      return true
    }
    let sem = DispatchSemaphore(value: 0)
    Task {
      await activity.update(content, alertConfiguration: alert)
      sem.signal()
    }
    guard sem.wait(timeout: .now() + 3) == .success else {
      log("update TIMEOUT on \(activity.id)")
      return false
    }
    let ok = activity.activityState == .active
    if !ok { log("\(activity.id) died during update: \(activity.activityState)") }
    return ok
  }

  private func observeState() {
    stateObserverTask?.cancel()
    guard let activity = current else { return }
    stateObserverTask = Task {
      for await state in activity.activityStateUpdates {
        guard state != .active else { continue }
        // Fin de carte, quelle qu'en soit l'origine : balayage du chauffeur,
        // « Tout effacer » du centre de notifications, limite système de durée,
        // pression mémoire, fin déclenchée par un autre process (AppIntent).
        // Ces cas sont INDISCERNABLES ici : app suspendue, le flux ne livre au
        // réveil que l'état courant (`.dismissed`) et le `.ended` intermédiaire
        // est perdu. On ne ferme donc JAMAIS la session sur ce signal — la carte
        // n'est qu'un affichage, le toggle du Dashboard reste la seule façon de
        // passer hors ligne. Fermer ici coupait le service en plein travail.
        log("LA \(state) — session laissée en ligne")
        current = nil
        break
      }
    }
  }

  /// - Returns: `false` si la carte de session n'est pas active. L'appelant
  ///   doit alors envoyer la notification de résultat.
  @discardableResult
  func update(
    platform: String,
    fare: Double,
    hourlyRate: Double,
    kmRate: Double,
    distanceKm: Double,
    durationMin: Int,
    verdictLevel: Int,
    rideId: String = ""
  ) -> Bool {
    log("update(\(platform)) fare=\(fare) hr=\(hourlyRate)")
    // Un scan met toujours à jour la carte de session existante. Il ne la crée
    // ni ne la remplace : une création depuis le raccourci est fragile et casse
    // la continuité des KPI. `ensureRunning()` la réarme au prochain premier plan.
    //
    // `waitForLiveActivity` couvre le process relancé à froid, dont la liste
    // d'activités n'est pas encore peuplée — sans quoi on abandonnerait une
    // carte qui est bel et bien à l'écran.
    guard let activity = liveActivity() ?? waitForLiveActivity() else { return false }
    autoDismiss?.cancel()
    autoDismiss = nil
    // Les KPI du jour sont RECOPIÉS depuis l'état courant : les lire dans l'écho
    // faisait perdre une poussée KPI arrivée juste avant ce scan.
    let prev = freshestState(of: activity)
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel,
      todayEarnings: prev.todayEarnings,
      todayHourlyRate: prev.todayHourlyRate,
      todayKm: prev.todayKm,
      onlineMinutes: prev.onlineMinutes,
      rideId: rideId.isEmpty ? nil : rideId,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(3600 * 8), relevanceScore: 100)
    // L'ALERTE est ce qui déplie le Dynamic Island — pas le contenu.
    //
    // Apple, « Displaying live data with Live Activities » :
    //   « On iPhone and iPad, the system doesn't show a regular alert but instead
    //     shows the expanded Live Activity in the Dynamic Island […] »
    //   « [the expanded presentation] appears when a person touches and holds a
    //     compact or minimal presentation, and it also appears briefly for Live
    //     Activity updates. »
    //
    // Donc toute update de résultat DOIT porter une AlertConfiguration, sans quoi
    // le verdict change en silence dans une île que personne ne regarde. C'est
    // aussi pourquoi `backToIdle` et `updateSessionKPI` n'en passent pas : elles
    // ne portent aucune nouvelle à annoncer.
    //
    // ⚠️ Ce dépliage n'est PAS garanti. Quand une autre app a elle aussi une Live
    // Activity en cours (Waze, Plans, minuteur, musique), iOS bascule les deux en
    // présentation `minimal` : « The system chooses a Live Activity from one app
    // to appear attached to the Dynamic Island while it presents a Live Activity
    // from another app detached from the Dynamic Island. » Reléguée au cercle
    // détaché, Strive ne se déplie plus toute seule — seule la pastille change de
    // couleur, et il faut un appui long pour lire le détail.
    //
    // Aucune API ne permet de réclamer le créneau attaché : `relevanceScore`
    // n'ordonne que les activités D'UNE MÊME app entre elles (« the order in
    // which your Live Activities appear when you start several Live Activities
    // for your app »). C'est précisément pour ce cas que la présentation
    // `minimal` porte une pastille pleine du verdict plutôt qu'un glyphe fin —
    // voir StriveLiveActivity.swift.
    let verdict = verdictLevel == 2 ? "✅" : verdictLevel == 1 ? "⚠️" : "❌"
    let alertTitle = "\(platform.capitalized) · \(String(format: "%.0f€", fare)) · \(verdict)"
    let alertBody = String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", hourlyRate, kmRate, durationMin, distanceKm)
    let alert = AlertConfiguration(
        title: LocalizedStringResource(stringLiteral: alertTitle),
        body: LocalizedStringResource(stringLiteral: alertBody),
        sound: .default
    )
    guard applyUpdate(activity, content: content, alert: alert) else {
      log("update NOT delivered on \(activity.id) — caller must notify")
      return false
    }
    rememberPush(state, on: activity)
    log("updated \(activity.id), waiting for ride decision")
    return true
  }

  func backToIdle() {
    guard let activity = liveActivity() else { return }
    log("backToIdle")
    // Préserve les KPI du jour + le timer de session : sinon le petit dashboard
    // du lock screen se VIDE (0 €, 0 km, 0 min) à chaque retour à l'état de base.
    let prev = freshestState(of: activity)
    let idle = StriveActivityAttributes.State(
      platform: "IDLE",
      fare: 0, hourlyRate: 0, kmRate: 0,
      distanceKm: 0, durationMin: 0, verdictLevel: 1,
      todayEarnings: prev.todayEarnings,
      todayHourlyRate: prev.todayHourlyRate,
      todayKm: prev.todayKm,
      onlineMinutes: prev.onlineMinutes,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8), relevanceScore: 50)
    rememberPush(idle, on: activity)
    Task { await activity.update(content) }
  }

  /// Efface le verdict seulement s'il est encore celui de la course décidée.
  /// Une ancienne course acceptée/refusée dans le Dashboard ne doit pas masquer
  /// le scan plus récent qui attend encore sa décision.
  func clearResult(rideId: String) {
    // Même règle que `revertLiveActivityToIdle` : on ne s'abstient que si la
    // carte montre une AUTRE course, donc une offre plus récente. Une carte sans
    // `rideId` n'a rien à protéger — c'est le cas qui la laissait figée sur son
    // verdict dès que l'état n'était pas parfaitement synchronisé.
    guard let activity = liveActivity() else { return }
    // `freshestState` et pas l'écho : une décision prise dans l'app arrive juste
    // après l'insertion du scan. Sur l'écho encore à IDLE (rideId nil), la garde
    // concluait « rien à protéger » et effaçait le résultat qui venait de
    // s'afficher — la course décidée n'était même pas celle-là.
    if let prevId = freshestState(of: activity).rideId, prevId != rideId {
      return
    }
    backToIdle()
  }

  /// - Returns: `false` si aucune activité n'est en cours — l'erreur n'a donc été
  ///   montrée nulle part et l'appelant doit notifier à la place.
  @discardableResult
  func showError() -> Bool {
    guard let activity = liveActivity() else {
      log("showError() — no live activity, skip")
      return false
    }
    log("showError() on \(activity.id)")
    let prev = freshestState(of: activity)
    let errorState = StriveActivityAttributes.State(
      platform: "ERROR",
      fare: 0, hourlyRate: 0, kmRate: 0,
      distanceKm: 0, durationMin: 0, verdictLevel: 0,
      todayEarnings: prev.todayEarnings,
      todayHourlyRate: prev.todayHourlyRate,
      todayKm: prev.todayKm,
      onlineMinutes: prev.onlineMinutes,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(state: errorState, staleDate: Date().addingTimeInterval(7), relevanceScore: 90)
    let alert = AlertConfiguration(
      title: "Strive",
      body: LocalizedStringResource(stringLiteral: localizedString(
        fr: "Analyse impossible — réessayez.",
        en: "Analysis failed — please try again."
      )),
      sound: .default
    )
    guard applyUpdate(activity, content: content, alert: alert) else {
      log("showError NOT delivered on \(activity.id) — caller must notify")
      return false
    }
    rememberPush(errorState, on: activity)

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.backToIdle() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    return true
  }

  func updateSessionKPI(
    todayEarnings: Double,
    todayHourlyRate: Double,
    todayKm: Double,
    onlineMinutes: Int
  ) {
    guard let activity = liveActivity() else { return }
    // `freshestState` et pas `activity.content.state` : le Dashboard pousse ses
    // KPI sur changement de `rides`, donc dans les millisecondes qui suivent
    // l'insertion d'un scan. Sur l'écho encore à IDLE, `resultShowing` tombait à
    // false et cette méthode réécrivait un IDLE par-dessus le verdict tout juste
    // poussé — le premier résultat d'une session n'atteignait jamais l'écran.
    let prev = freshestState(of: activity)
    // Tant que la dernière course attend une décision, le dashboard ne doit pas
    // écraser son verdict. `RideDecisionIntent` efface `rideId` en revenant aux KPI.
    let resultShowing = prev.rideId != nil
      && prev.platform != "IDLE" && prev.platform != "ERROR"
    log("updateSessionKPI earnings=\(todayEarnings) rate=\(todayHourlyRate) resultShowing=\(resultShowing)")
    let state = StriveActivityAttributes.State(
      platform: resultShowing ? prev.platform : "IDLE",
      fare: resultShowing ? prev.fare : 0,
      hourlyRate: resultShowing ? prev.hourlyRate : 0,
      kmRate: resultShowing ? prev.kmRate : 0,
      distanceKm: resultShowing ? prev.distanceKm : 0,
      durationMin: resultShowing ? prev.durationMin : 0,
      verdictLevel: resultShowing ? prev.verdictLevel : 1,
      todayEarnings: todayEarnings,
      todayHourlyRate: todayHourlyRate,
      todayKm: todayKm,
      onlineMinutes: onlineMinutes,
      rideId: resultShowing ? prev.rideId : nil,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(
      state: state,
      staleDate: Date().addingTimeInterval(3600 * 8),
      relevanceScore: resultShowing ? 100 : 50
    )
    rememberPush(state, on: activity)
    Task { await activity.update(content) }
    saveSessionSnapshot(state)
  }

  func stop() {
    // Lecture unique (cf. start()) : deux lectures + force-unwrap = crash
    // possible si un autre thread libère la carte entre les deux.
    log("stop() current=\(current?.id ?? "nil")")
    lastPushed = nil
    autoDismiss?.cancel()
    autoDismiss = nil
    stateObserverTask?.cancel()
    stateObserverTask = nil
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else {
      for orphan in Activity<StriveActivityAttributes>.activities {
        Task { await orphan.end(nil, dismissalPolicy: .immediate) }
      }
      return
    }
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    current = nil
    for orphan in Activity<StriveActivityAttributes>.activities {
      Task { await orphan.end(nil, dismissalPolicy: .immediate) }
    }
  }
}

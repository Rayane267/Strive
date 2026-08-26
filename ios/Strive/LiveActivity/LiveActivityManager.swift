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

  // ── État EN VOL ───────────────────────────────────────────────────────────
  //
  // `activity.content.state` est l'état APPLIQUÉ, pas le dernier demandé : une
  // update part en `Task` et met un moment à atterrir. Tout ce qui lit `prev`
  // entre-temps repart donc de l'état d'AVANT.
  //
  // C'est exactement ce que fait le Dashboard quand une course est validée :
  // effacer le verdict (`clearResult` → `backToIdle`), puis pousser les gains
  // du jour (`updateSessionKPI`). Le second lisait un verdict encore affiché,
  // le premier des gains encore à zéro — et selon celui des deux qui atterrit
  // en dernier, la carte revenait au résumé de session avec les gains d'avant.
  // Sur la PREMIÈRE course de la journée, ça se lit « les gains n'ont pas
  // bougé » : ils valaient 0 et sont restés à 0.
  //
  // Deux garde-fous, parce que la carte peut aussi être écrite par un autre
  // process (le bouton ✅ de l'îlot passe par `revertLiveActivityToIdle`, qui
  // ne connaît pas ce manager) :
  //   • l'entrée est effacée dès que NOTRE update a atterri,
  //   • et ignorée passé 10 s, si le process a été suspendu entre-temps.
  private var _inFlight: (seq: UInt64, activityId: String, state: StriveActivityAttributes.ContentState, at: Date)?
  private var _seq: UInt64 = 0
  /// Chaîne des updates : deux `Task` lancés coup sur coup peuvent atterrir
  /// dans l'ordre inverse. Chacun attend le précédent — la dernière demandée
  /// est donc toujours celle qui reste affichée.
  private var _updateChain: Task<Void, Never>?

  /// Le dernier état DEMANDÉ pour cette carte, à défaut celui qui est appliqué.
  private func latestState(_ a: Activity<StriveActivityAttributes>) -> StriveActivityAttributes.ContentState {
    stateLock.lock(); defer { stateLock.unlock() }
    if let f = _inFlight, f.activityId == a.id, Date().timeIntervalSince(f.at) < 10 {
      return f.state
    }
    return a.content.state
  }

  private func beginInFlight(_ a: Activity<StriveActivityAttributes>,
                             _ s: StriveActivityAttributes.ContentState) -> UInt64 {
    stateLock.lock(); defer { stateLock.unlock() }
    _seq &+= 1
    _inFlight = (_seq, a.id, s, Date())
    return _seq
  }

  /// N'efface QUE sa propre entrée : une update plus récente lancée entre-temps
  /// est le nouvel état en vol, et doit le rester.
  private func endInFlight(_ seq: UInt64) {
    stateLock.lock(); defer { stateLock.unlock() }
    if _inFlight?.seq == seq { _inFlight = nil }
  }

  private func clearInFlight() {
    stateLock.lock(); _inFlight = nil; _updateChain = nil; stateLock.unlock()
  }

  /// Unique point d'envoi vers ActivityKit : mémorise l'état demandé et met
  /// l'update à la queue derrière les précédentes.
  private func enqueue(
    _ activity: Activity<StriveActivityAttributes>,
    _ content: ActivityContent<StriveActivityAttributes.ContentState>,
    alert: AlertConfiguration? = nil,
    completion: (() -> Void)? = nil
  ) {
    // Verrou tenu sur TOUTE la séquence (le verrou est récursif) : deux envois
    // concurrents pourraient sinon s'ordonner différemment dans `_inFlight` et
    // dans la chaîne, et `latestState` rendrait l'avant-dernier état demandé.
    stateLock.lock()
    let seq = beginInFlight(activity, content.state)
    let previous = _updateChain
    let task = Task { [weak self] in
      _ = await previous?.value
      await activity.update(content, alertConfiguration: alert)
      self?.endInFlight(seq)
      completion?()
    }
    _updateChain = task
    stateLock.unlock()
  }

  private static let appGroupId = "group.com.striveapp.app"
  /// Dernier état de session connu (KPI du jour + ancre du timer), rejoué quand
  /// iOS a retiré la carte alors que la session continue.
  private static let sessionSnapshotKey = "laSessionSnapshot"

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
    #if DEBUG
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    var trace = defaults.string(forKey: "laSteps") ?? ""
    let fmt = DateFormatter()
    fmt.dateFormat = "HH:mm:ss.SSS"
    trace += "[\(fmt.string(from: Date()))] \(msg)\n"
    if trace.count > 2000 { trace = String(trace.suffix(2000)) }
    defaults.set(trace, forKey: "laSteps")
    defaults.set(msg, forKey: "laLastStep")
    #endif
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
      // Nouvelle carte : ce qui restait en vol visait l'ancienne.
      clearInFlight()
      observeState()
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
  /// Délègue à `saveLiveActivitySessionSnapshot` : le bouton ✅ de la carte
  /// écrit le même snapshot depuis un process où ce manager n'existe pas, et
  /// deux copies de la même sérialisation finiraient par diverger.
  private func saveSessionSnapshot(_ s: StriveActivityAttributes.ContentState) {
    saveLiveActivitySessionSnapshot(s)
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
    // 1,5 s au plus, largement sous le budget de l'AppIntent (watchdog à 25 s).
    for _ in 0..<6 {
      Thread.sleep(forTimeInterval: 0.25)
      if let live = liveActivity() {
        log("live activity apparue après attente")
        return live
      }
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
      enqueue(activity, content, alert: alert)
      return true
    }
    let sem = DispatchSemaphore(value: 0)
    enqueue(activity, content, alert: alert) { sem.signal() }
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
    let prev = latestState(activity)
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
    log("updated \(activity.id), waiting for ride decision")
    return true
  }

  func backToIdle() {
    guard let activity = liveActivity() else { return }
    log("backToIdle")
    // Préserve les KPI du jour + le timer de session : sinon le petit dashboard
    // du lock screen se VIDE (0 €, 0 km, 0 min) à chaque retour à l'état de base.
    // `latestState` et pas `content.state` : le push de gains qui accompagne une
    // validation part juste avant, et n'a pas encore atterri.
    let prev = latestState(activity)
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
    enqueue(activity, content)
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
    if let prevId = latestState(activity).rideId, prevId != rideId {
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
    let prev = latestState(activity)
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
    let prev = latestState(activity)
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
    enqueue(activity, content)
    saveSessionSnapshot(state)
  }

  func stop() {
    // Lecture unique (cf. start()) : deux lectures + force-unwrap = crash
    // possible si un autre thread libère la carte entre les deux.
    log("stop() current=\(current?.id ?? "nil")")
    autoDismiss?.cancel()
    autoDismiss = nil
    clearInFlight()
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

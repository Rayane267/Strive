import Foundation
import ActivityKit
import UIKit
import UserNotifications

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
  //   • le main thread (`autoDismiss` → showRecap/backToIdle, didBecomeActive),
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

  /// App hôte au premier plan ? Renseigné par `ScanBridgeModule` (cible app), et
  /// NON lu depuis `UIApplication.shared` : ce fichier est aussi compilé dans la
  /// cible StriveShareExtension, où cette API est interdite par Apple — l'archive
  /// échouait avec « 'shared' is unavailable in application extensions ».
  /// Reste `false` dans l'extension, ce qui est la bonne réponse : une extension
  /// n'est jamais l'app au premier plan et ne peut pas créer d'activité.
  private var _hostAppIsActive = false
  var hostAppIsActive: Bool {
    stateLock.lock(); defer { stateLock.unlock() }
    return _hostAppIsActive
  }

  func setHostAppActive(_ active: Bool) {
    stateLock.lock()
    _hostAppIsActive = active
    stateLock.unlock()
  }

  private static let appGroupId = "group.com.striveapp.app"
  /// Dernier état de session connu (KPI du jour + ancre du timer), rejoué par
  /// `ensureRunning()` quand la carte doit être recréée.
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
    scanTs: Double = 0,
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
      // Couper l'observer AVANT de terminer : sinon la fin de l'activité qu'on
      // remplace nous-mêmes rappelle `ensureRunning()` en pleine création et
      // deux `Activity.request()` se marchent dessus.
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
      scanTs: scanTs > 0 ? scanTs : nil,
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
      // `Activity.request()` n'aboutit QUE si l'app est au premier plan : sa
      // réussite est donc une preuve d'état, qui rattrape le cas où la
      // notification `didBecomeActive` a précédé la création du module natif.
      setHostAppActive(true)
      // Une carte tourne de nouveau : le message « carte fermée » est caduc.
      UNUserNotificationCenter.current()
        .removeDeliveredNotifications(withIdentifiers: ["strive-la-closed"])
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

  /// Ré-arme la carte de session si elle a disparu alors que le chauffeur est
  /// toujours en ligne. Le chauffeur n'a rien balayé : iOS termine une Live
  /// Activity de lui-même (limite de durée ~8 h, pression mémoire, remplacement),
  /// et jusqu'ici PLUS RIEN ne la relançait avant un passage hors ligne/en ligne
  /// ou un démarrage à froid de l'app. Or sans carte vivante, un scan lancé
  /// depuis le raccourci ne peut rien afficher — `Activity.request()` échoue en
  /// arrière-plan — et le verdict retombait sur une simple notification.
  ///
  /// À n'appeler qu'avec l'app au premier plan : c'est le seul moment où
  /// `Activity.request()` est autorisé.
  @discardableResult
  func ensureRunning() -> Bool {
    guard let d = UserDefaults(suiteName: Self.appGroupId) else { return false }
    guard d.bool(forKey: "sessionOnline") else { return false }
    let prefOn = d.object(forKey: "useLiveActivity") == nil ? true : d.bool(forKey: "useLiveActivity")
    guard prefOn, ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    guard liveActivity() == nil else { return false }
    let snap = d.dictionary(forKey: Self.sessionSnapshotKey) ?? [:]
    log("ensureRunning — session en ligne sans carte vivante, ré-armement")
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
        // Si l'app est au premier plan à cet instant, on recrée la carte tout
        // de suite : c'est la seule fenêtre où `Activity.request()` passe, et
        // sans carte le prochain scan par raccourci retombe sur une notif.
        await MainActor.run {
          if self.hostAppIsActive {
            self.ensureRunning()
          } else {
            // App pas au premier plan : impossible de ré-armer maintenant. On
            // prévient, sinon le chauffeur voit sa carte disparaître sans savoir
            // ni si sa session tient, ni que ses prochains scans vont retomber
            // en notification tant qu'il n'aura pas rouvert l'app.
            self.notifyCardClosed()
          }
        }
        break
      }
    }
  }

  /// Notifie la disparition de la carte pendant une session en cours. Deux gardes
  /// contre le faux positif : appelée uniquement app hors premier plan (sinon la
  /// carte est ré-armée dans la seconde, rien à signaler), et seulement si la
  /// session est en ligne — hors session, plus rien ne dépend de la carte.
  /// Sans son : c'est un message d'état, pas un verdict de course, et iOS peut
  /// terminer la carte en pleine nuit (limite de durée ~8 h).
  private func notifyCardClosed() {
    guard let d = UserDefaults(suiteName: Self.appGroupId), d.bool(forKey: "sessionOnline") else { return }
    let content = UNMutableNotificationContent()
    content.title = "Strive"
    content.body = localizedString(
      fr: "Carte fermée — votre session reste active. Vos prochains scans arriveront en notification jusqu'à la réouverture de l'app.",
      en: "Card closed — your session is still active. Your next scans will arrive as notifications until you reopen the app."
    )
    content.sound = nil
    // `.passive` : message d'état, pas un verdict. Il ne doit ni sonner, ni
    // allumer l'écran, ni traverser une Concentration — il attend sagement dans
    // le centre de notifications.
    content.interruptionLevel = .passive
    // Identifiant fixe : une carte qui meurt plusieurs fois ne doit pas empiler
    // plusieurs fois le même message.
    let request = UNNotificationRequest(identifier: "strive-la-closed", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  /// Dernière tentative de carte neuve. Sert à borner la casse quand le
  /// chauffeur enchaîne les scans : recréer l'activité à chaque offre en pleine
  /// heure de pointe ferait tomber iOS en throttling, et on perdrait alors le
  /// punch-through pour tout le monde plutôt que pour un scan.
  ///
  /// Sous le même verrou que `current` : un scan par raccourci et un scan par
  /// la Share Extension peuvent viser cette valeur depuis deux threads.
  private var _lastFreshResultAt: Date?
  private var lastFreshResultAt: Date? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _lastFreshResultAt }
    set { stateLock.lock(); _lastFreshResultAt = newValue; stateLock.unlock() }
  }

  /// Présente le résultat comme une activité NEUVE plutôt que comme une mise à
  /// jour de la carte de session.
  ///
  /// Pourquoi c'est nécessaire. Une même Live Activity porte ici deux rôles :
  /// la carte de SESSION (persistante — KPI du jour, timer) et l'ALERTE de
  /// résultat (événementielle). iOS ne les distingue pas, mais il distingue
  /// très nettement `Activity.request()` de `activity.update()` : une activité
  /// qui APPARAÎT prend le Dynamic Island, une activité qui se MET À JOUR ne le
  /// reprend pas à ce qui l'occupe déjà — un appel en cours, l'activité d'une
  /// autre app. Le résultat était alors bien à jour mais replié en `minimal`,
  /// et il fallait toucher l'île pour le lire.
  ///
  /// C'est ce qui a régressé avec `ensureRunning()` : avant lui la carte de
  /// session mourait souvent sans être relancée, donc un scan tombait sur la
  /// branche `start()` et créait une activité neuve — d'où le comportement
  /// « ça s'affiche quoi qu'il arrive ». Depuis, une carte est toujours vivante
  /// et le résultat n'était plus qu'une mise à jour. `ensureRunning()` reste :
  /// il corrige un vrai problème, on lui retire seulement son effet de bord.
  ///
  /// ORDRE CRITIQUE : on demande la nouvelle carte AVANT de retirer l'ancienne.
  /// L'inverse (terminer puis demander) laisse le chauffeur sans aucune carte
  /// quand la requête est refusée — et elle peut l'être pour des raisons hors
  /// de notre contrôle : process en arrière-plan, throttling iOS, Live
  /// Activities désactivées entre-temps. Ici un refus ne coûte rien : rien n'a
  /// été détruit, l'appelant enchaîne sur la mise à jour classique.
  ///
  /// On ne branche PAS en dur selon le chemin d'appel (Share Extension vs
  /// raccourci). `AnalyzeRideIntent` est compilé dans le target principal, il
  /// n'y a donc pas de bundle id pour les séparer — et surtout un raccourci
  /// déclenché app au premier plan a parfaitement le droit de créer une
  /// activité. Tenter et laisser iOS trancher s'adapte à l'état réel.
  private func presentFreshResult(
    platform: String,
    fare: Double,
    hourlyRate: Double,
    kmRate: Double,
    distanceKm: Double,
    durationMin: Int,
    verdictLevel: Int,
    scanTs: Double
  ) -> Bool {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    if let last = lastFreshResultAt, Date().timeIntervalSince(last) < 8 {
      log("fresh result throttled (<8s) — mise à jour classique")
      return false
    }

    // État de session à reporter : celui de la carte vivante, sinon
    // l'instantané App Group. Sans ça la carte neuve repartirait à 0 € / 0 km
    // et le timer de session serait remis à zéro.
    let prev = liveActivity()?.content.state
    let snap = UserDefaults(suiteName: Self.appGroupId)?
      .dictionary(forKey: Self.sessionSnapshotKey) ?? [:]
    let state = StriveActivityAttributes.State(
      platform: platform,
      fare: fare,
      hourlyRate: hourlyRate,
      kmRate: kmRate,
      distanceKm: distanceKm,
      durationMin: durationMin,
      verdictLevel: verdictLevel,
      todayEarnings: prev?.todayEarnings ?? (snap["todayEarnings"] as? NSNumber)?.doubleValue ?? 0,
      todayHourlyRate: prev?.todayHourlyRate ?? (snap["todayHourlyRate"] as? NSNumber)?.doubleValue ?? 0,
      todayKm: prev?.todayKm ?? (snap["todayKm"] as? NSNumber)?.doubleValue ?? 0,
      onlineMinutes: prev?.onlineMinutes ?? (snap["onlineMinutes"] as? NSNumber)?.intValue ?? 0,
      scanTs: scanTs > 0 ? scanTs : nil,
      sessionStartEpoch: prev?.sessionStartEpoch ?? (snap["sessionStartEpoch"] as? NSNumber)?.doubleValue
    )

    let previous = Activity<StriveActivityAttributes>.activities

    // Couper l'observateur AVANT : la fin des anciennes cartes, plus bas, le
    // ferait rappeler `ensureRunning()` en pleine création — deux
    // `Activity.request()` concurrents. Même précaution que dans `start()`.
    stateObserverTask?.cancel()
    stateObserverTask = nil

    let fresh: Activity<StriveActivityAttributes>
    do {
      let content = ActivityContent(
        state: state,
        staleDate: Date().addingTimeInterval(20),
        relevanceScore: 100
      )
      fresh = try Activity.request(
        attributes: StriveActivityAttributes(),
        content: content,
        pushType: nil
      )
      log("fresh result activity id=\(fresh.id)")
    } catch {
      // Refus : l'ancienne carte est INTACTE, on n'a rien terminé. On remet
      // l'observateur en place et on laisse l'appelant faire une mise à jour.
      log("fresh result refused: \(error.localizedDescription) — repli sur update()")
      observeState()
      return false
    }

    lastFreshResultAt = Date()
    current = fresh
    // Seulement maintenant : retirer les anciennes. Il existe un bref instant à
    // deux activités (l'île les partage en leading/trailing) — c'est le prix de
    // l'ordre ci-dessus, et il vaut mieux que le trou inverse.
    for old in previous where old.id != fresh.id {
      Task { await old.end(nil, dismissalPolicy: .immediate) }
    }
    // Une requête réussie prouve que l'app est au premier plan.
    setHostAppActive(true)
    UNUserNotificationCenter.current()
      .removeDeliveredNotifications(withIdentifiers: ["strive-la-closed"])
    observeState()
    saveSessionSnapshot(state)
    return true
  }

  /// Programme le retour à la carte de récap. Extrait pour que les deux chemins
  /// de présentation (carte neuve et mise à jour) partagent exactement la même
  /// durée de vie du résultat.
  private func scheduleRecap() {
    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.showRecap() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
  }

  /// - Returns: `false` quand rien n'a pu être affiché — typiquement un appel
  ///   depuis l'AppIntent alors qu'aucune activité ne tourne : `Activity.request()`
  ///   exige que l'app soit au premier plan (hors push-to-start), et le raccourci
  ///   s'exécute en arrière-plan. L'appelant DOIT alors se rabattre sur une
  ///   notification, sinon le scan aboutit sans que rien ne s'affiche.
  @discardableResult
  func update(
    platform: String,
    fare: Double,
    hourlyRate: Double,
    kmRate: Double,
    distanceKm: Double,
    durationMin: Int,
    verdictLevel: Int,
    scanTs: Double = 0
  ) -> Bool {
    log("update(\(platform)) fare=\(fare) hr=\(hourlyRate)")

    // Carte NEUVE d'abord. iOS ne traite pas de la même façon une activité qui
    // apparaît et une activité qui se met à jour : la première prend le Dynamic
    // Island, la seconde ne le reprend pas à ce qui l'occupe (appel en cours,
    // activité d'une autre app). Voir `presentFreshResult`. En cas de refus on
    // enchaîne sur le chemin historique ci-dessous, qui n'a rien perdu.
    if presentFreshResult(
      platform: platform, fare: fare, hourlyRate: hourlyRate, kmRate: kmRate,
      distanceKm: distanceKm, durationMin: durationMin,
      verdictLevel: verdictLevel, scanTs: scanTs
    ) {
      scheduleRecap()
      return true
    }

    guard let activity = liveActivity() else {
      log("no activity — auto-starting then updating for banner")
      let started = start(
        platform: platform,
        fare: fare,
        hourlyRate: hourlyRate,
        kmRate: kmRate,
        distanceKm: distanceKm,
        durationMin: durationMin,
        verdictLevel: verdictLevel,
        scanTs: scanTs
      )
      guard started, let newActivity = current else { return false }
      let verdict = verdictLevel == 2 ? "✅" : verdictLevel == 1 ? "⚠️" : "❌"
      let alertTitle = "\(platform.capitalized) · \(String(format: "%.0f€", fare)) · \(verdict)"
      let alertBody = String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", hourlyRate, kmRate, durationMin, distanceKm)
      let alert = AlertConfiguration(
          title: LocalizedStringResource(stringLiteral: alertTitle),
          body: LocalizedStringResource(stringLiteral: alertBody),
          sound: .default
      )
      let content = ActivityContent(state: newActivity.content.state, staleDate: Date().addingTimeInterval(20), relevanceScore: 100)
      // La carte vient d'être créée : si l'alerte ne passe pas, le résultat est
      // perdu → on rend `false` pour que l'appelant notifie.
      guard applyUpdate(newActivity, content: content, alert: alert) else { return false }
      scheduleRecap()
      return true
    }
    let prev = activity.content.state
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
      scanTs: scanTs > 0 ? scanTs : nil,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(20), relevanceScore: 100)
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
    log("updated \(activity.id), dismiss in 20s")

    scheduleRecap()
    return true
  }

  /// Étape intermédiaire entre la carte résultat et le dashboard de session :
  /// pendant 20 s on ne garde que le prix de la course et le €/km, pour laisser
  /// le temps de les relire une fois la carte complète disparue. Sans montant à
  /// rappeler (erreur, état vide), on saute directement à l'idle.
  func showRecap() {
    guard let activity = liveActivity() else { return }
    let prev = activity.content.state
    guard prev.fare > 0 else { backToIdle(); return }
    log("showRecap fare=\(prev.fare) km=\(prev.kmRate)")

    let recap = StriveActivityAttributes.State(
      platform: "RECAP",
      fare: prev.fare,
      hourlyRate: prev.hourlyRate,
      kmRate: prev.kmRate,
      distanceKm: 0, durationMin: 0,
      verdictLevel: prev.verdictLevel,
      todayEarnings: prev.todayEarnings,
      todayHourlyRate: prev.todayHourlyRate,
      todayKm: prev.todayKm,
      onlineMinutes: prev.onlineMinutes,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(state: recap, staleDate: Date().addingTimeInterval(20), relevanceScore: 50)
    Task { await activity.update(content) }

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.backToIdle() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
  }

  func backToIdle() {
    guard let activity = liveActivity() else { return }
    log("backToIdle")
    // Préserve les KPI du jour + le timer de session : sinon le petit dashboard
    // du lock screen se VIDE (0 €, 0 km, 0 min) à chaque retour à l'état de base
    // (auto-dismiss 20 s, tap bouton, commande vocale).
    let prev = activity.content.state
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
    Task { await activity.update(content) }
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
    let prev = activity.content.state
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
    let prev = activity.content.state
    // Un résultat de scan est à l'écran (auto-dismiss en attente) : NE PAS
    // l'écraser avec le dashboard IDLE — le JS pousse ses KPI quelques secondes
    // après le scan et volait la place du verdict avant la fin des 20 s.
    // On rafraîchit seulement les KPI du jour, le verdict reste affiché ;
    // backToIdle() reprendra ces KPI à l'expiration du timer.
    let resultShowing = autoDismiss != nil
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
      scanTs: resultShowing ? prev.scanTs : nil,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    let content = ActivityContent(
      state: state,
      staleDate: Date().addingTimeInterval(resultShowing ? 20 : 3600 * 8),
      relevanceScore: resultShowing ? 100 : 50
    )
    Task { await activity.update(content) }
    saveSessionSnapshot(state)
  }

  func stop() {
    // Lecture unique (cf. start()) : deux lectures + force-unwrap = crash
    // possible si un autre thread libère la carte entre les deux.
    log("stop() current=\(current?.id ?? "nil")")
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

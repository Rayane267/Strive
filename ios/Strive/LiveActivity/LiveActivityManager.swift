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

  private var current: Activity<StriveActivityAttributes>?
  private var autoDismiss: DispatchWorkItem?
  private var stateObserverTask: Task<Void, Never>?

  static let dismissedNotification = Notification.Name("StriveLiveActivityDismissed")

  private static let appGroupId = "group.com.striveapp.app"

  /// Résout la langue UI (fr/en) : préférence poussée par l'app via l'App Group
  /// (`appLanguage`), sinon locale système. Même logique que la Share Extension
  /// et l'AppIntent — le texte des alertes s'affichait jusqu'ici en français
  /// quelle que soit la langue de l'utilisateur.
  private func localizedString(fr: String, en: String) -> String {
    let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    let lang = appLang ?? Locale.current.languageCode ?? "en"
    return lang.hasPrefix("fr") ? fr : en
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
    log("existing=\(existingCount) current=\(current == nil ? "nil" : current!.id)")

    // Termine TOUTE activité existante (pas seulement `current`) : l'AppIntent
    // tourne dans un autre process et peut avoir laissé une activité orpheline
    // → sinon deux cartes s'empilent sur le lock screen (résultat + session).
    let existing = Activity<StriveActivityAttributes>.activities
    if !existing.isEmpty {
      log("ending \(existing.count) existing activity(ies)")
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
        staleDate: Date().addingTimeInterval(3600 * 8)
      )
      log("calling Activity.request()...")
      current = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      log("OK id=\(current?.id ?? "nil")")
      observeState()
      return true
    } catch {
      log("FAILED: \(error.localizedDescription) domain=\((error as NSError).domain) code=\((error as NSError).code)")
      return false
    }
  }

  private func observeState() {
    stateObserverTask?.cancel()
    guard let activity = current else { return }
    stateObserverTask = Task {
      for await state in activity.activityStateUpdates {
        if state == .dismissed || state == .ended {
          log("LA dismissed/ended by user")
          await MainActor.run {
            NotificationCenter.default.post(name: Self.dismissedNotification, object: nil)
          }
          current = nil
          break
        }
      }
    }
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
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
      if current != nil { observeState() }
      log("recovered existing activity: \(current?.id ?? "none")")
    }
    guard let activity = current else {
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
      if started, let newActivity = current {
        let verdict = verdictLevel == 2 ? "✅" : verdictLevel == 1 ? "⚠️" : "❌"
        let alertTitle = "\(platform.capitalized) · \(String(format: "%.0f€", fare)) · \(verdict)"
        let alertBody = String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", hourlyRate, kmRate, durationMin, distanceKm)
        let alert = AlertConfiguration(
            title: LocalizedStringResource(stringLiteral: alertTitle),
            body: LocalizedStringResource(stringLiteral: alertBody),
            sound: .default
        )
        let content = ActivityContent(state: newActivity.content.state, staleDate: Date().addingTimeInterval(20))
        Task { await newActivity.update(content, alertConfiguration: alert) }
        autoDismiss?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.showRecap() }
        autoDismiss = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
      }
      return started
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
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(20))
    let verdict = verdictLevel == 2 ? "✅" : verdictLevel == 1 ? "⚠️" : "❌"
    let alertTitle = "\(platform.capitalized) · \(String(format: "%.0f€", fare)) · \(verdict)"
    let alertBody = String(format: "%.0f€/h · %.2f€/km · %dmin · %.1fkm", hourlyRate, kmRate, durationMin, distanceKm)
    let alert = AlertConfiguration(
        title: LocalizedStringResource(stringLiteral: alertTitle),
        body: LocalizedStringResource(stringLiteral: alertBody),
        sound: .default
    )
    Task { await activity.update(content, alertConfiguration: alert) }
    log("updated \(activity.id), dismiss in 20s")

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.showRecap() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
    return true
  }

  /// Étape intermédiaire entre la carte résultat et le dashboard de session :
  /// pendant 20 s on ne garde que le prix de la course et le €/km, pour laisser
  /// le temps de les relire une fois la carte complète disparue. Sans montant à
  /// rappeler (erreur, état vide), on saute directement à l'idle.
  func showRecap() {
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else { return }
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
    let content = ActivityContent(state: recap, staleDate: Date().addingTimeInterval(20))
    Task { await activity.update(content) }

    autoDismiss?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.backToIdle() }
    autoDismiss = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
  }

  func backToIdle() {
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else { return }
    log("backToIdle")
    // Préserve les KPI du jour + le timer de session : sinon le petit dashboard
    // du lock screen se VIDE (0 €, 0 km, 0 min) à chaque retour à l'état de base
    // (auto-dismiss 10 s, tap bouton, commande vocale).
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
    let content = ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8))
    Task { await activity.update(content) }
  }

  /// - Returns: `false` si aucune activité n'est en cours — l'erreur n'a donc été
  ///   montrée nulle part et l'appelant doit notifier à la place.
  @discardableResult
  func showError() -> Bool {
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else {
      log("showError() — no activity, skip")
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
    let content = ActivityContent(state: errorState, staleDate: Date().addingTimeInterval(7))
    let alert = AlertConfiguration(
      title: "Strive",
      body: LocalizedStringResource(stringLiteral: localizedString(
        fr: "Analyse impossible — réessayez.",
        en: "Analysis failed — please try again."
      )),
      sound: .default
    )
    Task { await activity.update(content, alertConfiguration: alert) }

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
    if current == nil {
      current = Activity<StriveActivityAttributes>.activities.first
    }
    guard let activity = current else { return }
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
      staleDate: Date().addingTimeInterval(resultShowing ? 20 : 3600 * 8)
    )
    Task { await activity.update(content) }
  }

  func stop() {
    log("stop() current=\(current == nil ? "nil" : current!.id)")
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

import CarPlay
import Foundation

/// Tableau de bord Strive sur l'écran de la voiture.
///
/// ── Ce que CarPlay autorise ────────────────────────────────────────────────
/// Une app CarPlay ne dessine RIEN : elle décrit des templates système, qu'Apple
/// rend elle-même selon le véhicule (taille d'écran, thème jour/nuit, molette ou
/// tactile). Aucune couleur, aucune police, aucune mise en page ne sont à nous.
/// La qualité d'affichage se joue donc entièrement sur : quel template, combien
/// d'informations, et dans quel ordre. D'où les partis pris ci-dessous.
///
/// ── Partis pris ────────────────────────────────────────────────────────────
/// • QUATRE lignes, pas une de plus. Au volant, une donnée qu'on doit chercher
///   est une donnée qu'on ne lit pas. Le €/h est en tête : c'est la seule qui
///   répond à « ma journée est-elle bonne ? ».
/// • Aucun bouton d'action. Passer en ligne / hors ligne depuis la voiture
///   écrirait un état que seul le JS peut réconcilier avec Supabase — l'app
///   étant suspendue, la session partirait en désynchronisation silencieuse.
///   Tant que ce n'est pas traité côté serveur, CarPlay reste en lecture seule.
/// • Pas de liste des courses : faire défiler une liste en conduisant est
///   exactement ce que les règles CarPlay d'Apple cherchent à éviter.
///
/// ── Source des données ─────────────────────────────────────────────────────
/// `laSessionSnapshot` dans l'App Group, entretenu par `LiveActivityManager`
/// (mêmes chiffres que la Live Activity, donc jamais de divergence entre l'écran
/// du téléphone et celui de la voiture). Aucun appel réseau, aucun besoin que le
/// pont React Native tourne : l'affichage reste juste même app suspendue.
///
/// ── Câblage requis (Xcode, non fait ici) ───────────────────────────────────
/// 1. Ajouter ce fichier à la cible `Strive`.
/// 2. Entitlement `com.apple.developer.carplay-driving-task`, APRÈS accord
///    d'Apple — l'ajouter avant fait échouer la signature (le profil de
///    provisioning ne la contient pas).
/// 3. Le bloc `UIApplicationSceneManifest` de l'Info.plist (cf. réponse).
@available(iOS 16.0, *)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

  private var interfaceController: CPInterfaceController?
  private var dashboard: CPInformationTemplate?
  private var refreshTimer: Timer?

  private static let appGroupId =
    Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
      ?? "group.com.striveapp.app"
  private static let snapshotKey = "laSessionSnapshot"

  // MARK: - Cycle de vie de la scène

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    let template = CPInformationTemplate(
      title: "Strive",
      layout: .twoColumn,
      items: currentItems(),
      actions: []
    )
    dashboard = template
    interfaceController.setRootTemplate(template, animated: false, completion: nil)
    startRefreshing()
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    stopRefreshing()
    self.interfaceController = nil
    dashboard = nil
  }

  // MARK: - Rafraîchissement

  /// 20 s : le compteur de temps en ligne et le €/h avancent tout seuls entre
  /// deux scans, il faut donc redessiner même quand rien n'est scanné. Plus
  /// rapide serait inutile (aucune de ces valeurs ne bouge à la seconde près) et
  /// réveillerait le process pour rien.
  private func startRefreshing() {
    stopRefreshing()
    let timer = Timer(timeInterval: 20, repeats: true) { [weak self] _ in
      self?.refresh()
    }
    RunLoop.main.add(timer, forMode: .common)
    refreshTimer = timer
  }

  private func stopRefreshing() {
    refreshTimer?.invalidate()
    refreshTimer = nil
  }

  private func refresh() {
    dashboard?.items = currentItems()
  }

  // MARK: - Contenu

  private func currentItems() -> [CPInformationItem] {
    let defaults = UserDefaults(suiteName: Self.appGroupId)

    guard defaults?.bool(forKey: "sessionOnline") == true else {
      // Hors session : une seule ligne, qui dit quoi faire. Un tableau de bord à
      // zéro (0 €, 0 km) laisserait croire à une journée blanche alors que le
      // chauffeur n'a simplement pas démarré sa session.
      return [
        CPInformationItem(
          title: localized(fr: "Aucune session", en: "No session"),
          detail: localized(
            fr: "Démarrez votre session dans Strive.",
            en: "Start your session in Strive."
          )
        )
      ]
    }

    let snapshot = defaults?.dictionary(forKey: Self.snapshotKey) ?? [:]
    let earnings = (snapshot["todayEarnings"] as? NSNumber)?.doubleValue ?? 0
    let km = (snapshot["todayKm"] as? NSNumber)?.doubleValue ?? 0

    // Secondes en ligne recalculées depuis l'ancre plutôt que lues telles
    // quelles : `onlineMinutes` date du dernier scan, il serait figé pendant
    // toute une attente. L'ancre, elle, avance seule.
    let onlineSeconds = liveOnlineSeconds(snapshot: snapshot)
    let hours = Double(onlineSeconds) / 3600.0
    // €/h recalculé avec ce temps vivant, pour la même raison. Sous ~1 minute en
    // ligne le ratio explose (30 € en 20 s = 5 400 €/h) : on affiche un tiret
    // plutôt qu'un chiffre absurde.
    let hourlyRate: Double? = hours >= (1.0 / 60.0) ? earnings / hours : nil

    return [
      CPInformationItem(
        title: localized(fr: "Par heure", en: "Per hour"),
        detail: hourlyRate.map { String(format: "%.0f €/h", $0) } ?? "—"
      ),
      CPInformationItem(
        title: localized(fr: "Gains", en: "Earnings"),
        detail: String(format: "%.0f €", earnings)
      ),
      CPInformationItem(
        title: localized(fr: "En ligne", en: "Online"),
        detail: formatDuration(onlineSeconds)
      ),
      CPInformationItem(
        title: localized(fr: "Distance", en: "Distance"),
        detail: String(format: "%.0f km", km)
      ),
    ]
  }

  /// Temps en ligne du JOUR, en secondes. `sessionStartEpoch` vaut
  /// « début de session − temps déjà cumulé aujourd'hui » (cf. Live Activity) :
  /// l'écart à maintenant est donc directement le cumul du jour.
  private func liveOnlineSeconds(snapshot: [String: Any]) -> Int {
    if let epoch = (snapshot["sessionStartEpoch"] as? NSNumber)?.doubleValue, epoch > 0 {
      let elapsed = Date().timeIntervalSince1970 - epoch
      if elapsed > 0 { return Int(elapsed) }
    }
    // Repli : ancre absente (session restaurée par un ancien build).
    return ((snapshot["onlineMinutes"] as? NSNumber)?.intValue ?? 0) * 60
  }

  /// « 4 h 32 » / « 47 min ». Les secondes ne servent à rien au volant, et un
  /// format qui change de longueur à chaque tick attire l'œil pour rien.
  private func formatDuration(_ seconds: Int) -> String {
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    return h > 0 ? String(format: "%d h %02d", h, m) : "\(m) min"
  }

  /// Même résolution de langue que le reste de l'app (App Group `appLanguage`,
  /// sinon locale système) — cf. LiveActivityManager / AnalyzeRideIntent.
  private func localized(fr: String, en: String) -> String {
    guard let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    else { return fr }
    return appLang.hasPrefix("en") ? en : fr
  }
}

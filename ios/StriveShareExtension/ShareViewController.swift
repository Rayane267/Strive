import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers
import Vision
import UserNotifications

/// Share Extension — reçoit un screenshot depuis le Share Sheet et analyse la course VTC.
/// Équivalent iOS de FloatingBubbleService.kt + StriveAccessibilityService.kt d'Android.
///
/// Flow : Screenshot → Share Sheet → "Analyser avec Strive" → Vision OCR → résultat affiché
class ShareViewController: UIViewController {

  // MARK: - App Group

  /// Lu depuis Info.plist (`StriveAppGroupId`) — fallback hardcodé pour
  /// fiabilité. Doit matcher la même clé dans l'app principale.
  private static let appGroupId: String = {
    Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String
      ?? "group.com.striveapp.app"
  }()
  private static let scanResultKey = "lastScanResult"
  private static let scanTimestampKey = "lastScanTimestamp"

  /// Résout la langue UI (fr/en) : pref synchronisée par l'app principale via
  /// App Group (`appLanguage`), sinon locale système. Même logique que AnalyzeRideIntent.
  private func localizedString(fr: String, en: String) -> String {
    // Anglais uniquement si l'app est réglée en anglais, français sinon — la
    // locale système ne fait PAS foi.
    guard let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    else { return fr }
    return appLang.hasPrefix("en") ? en : fr
  }

  // MARK: - UI Elements

  private let containerView = UIView()
  private let headerView = UIView()
  private let logoLabel = UILabel()
  private let titleLabel = UILabel()
  private let closeButton = UIButton(type: .system)
  private let statusLabel = UILabel()
  private let spinnerView = UIActivityIndicatorView(style: .medium)

  // Résultat
  private let resultContainer = UIView()
  private let platformBadge = UILabel()
  private let fareLabel = UILabel()
  private let hourlyRateLabel = UILabel()
  private let kmRateLabel = UILabel()
  private let distanceLabel = UILabel()
  private let durationLabel = UILabel()
  private let verdictTriangle = UIView()
  private let routeView = UIView()
  private let pickupLabel = UILabel()
  private let destinationLabel = UILabel()

  // Couleurs (même thème que l'app)
  private let bgColor = UIColor(red: 0.07, green: 0.07, blue: 0.10, alpha: 1.0)
  private let surfaceColor = UIColor(red: 0.11, green: 0.11, blue: 0.15, alpha: 1.0)
  private let primaryColor = UIColor(red: 0.0, green: 0.90, blue: 0.46, alpha: 1.0)
  private let textMain = UIColor.white
  private let textMuted = UIColor(white: 1.0, alpha: 0.55)
  private let textDimmed = UIColor(white: 1.0, alpha: 0.35)

  private let platformColors: [String: UIColor] = [
    "UBER": .white,
    "BOLT": UIColor(red: 0.20, green: 0.73, blue: 0.47, alpha: 1.0),
    "HEETCH": UIColor(red: 1.0, green: 0.23, blue: 0.50, alpha: 1.0),
    "UNKNOWN": UIColor(white: 1.0, alpha: 0.55),
  ]

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    setupUI()
    processSharedImage()
  }

  // MARK: - UI Setup

  private func setupUI() {
    view.backgroundColor = UIColor.black.withAlphaComponent(0.5)

    // Container principal (bottom sheet)
    containerView.backgroundColor = bgColor
    containerView.layer.cornerRadius = 24
    containerView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
    containerView.clipsToBounds = true
    containerView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(containerView)

    NSLayoutConstraint.activate([
      containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      containerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      containerView.heightAnchor.constraint(greaterThanOrEqualToConstant: 320),
    ])

    // Drag indicator
    let dragIndicator = UIView()
    dragIndicator.backgroundColor = UIColor(white: 1.0, alpha: 0.2)
    dragIndicator.layer.cornerRadius = 2.5
    dragIndicator.translatesAutoresizingMaskIntoConstraints = false
    containerView.addSubview(dragIndicator)

    NSLayoutConstraint.activate([
      dragIndicator.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 10),
      dragIndicator.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
      dragIndicator.widthAnchor.constraint(equalToConstant: 40),
      dragIndicator.heightAnchor.constraint(equalToConstant: 5),
    ])

    // Header
    headerView.translatesAutoresizingMaskIntoConstraints = false
    containerView.addSubview(headerView)

    NSLayoutConstraint.activate([
      headerView.topAnchor.constraint(equalTo: dragIndicator.bottomAnchor, constant: 16),
      headerView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
      headerView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
      headerView.heightAnchor.constraint(equalToConstant: 36),
    ])

    // Logo icon
    logoLabel.text = "🏎️"
    logoLabel.font = .systemFont(ofSize: 22)
    logoLabel.translatesAutoresizingMaskIntoConstraints = false
    headerView.addSubview(logoLabel)

    titleLabel.text = "Strive"
    titleLabel.font = .systemFont(ofSize: 18, weight: .bold)
    titleLabel.textColor = textMain
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    headerView.addSubview(titleLabel)

    closeButton.setTitle("✕", for: .normal)
    closeButton.setTitleColor(textMuted, for: .normal)
    closeButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .medium)
    closeButton.backgroundColor = surfaceColor
    closeButton.layer.cornerRadius = 18
    closeButton.translatesAutoresizingMaskIntoConstraints = false
    closeButton.addTarget(self, action: #selector(dismissExtension), for: .touchUpInside)
    headerView.addSubview(closeButton)

    NSLayoutConstraint.activate([
      logoLabel.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),
      logoLabel.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),

      titleLabel.leadingAnchor.constraint(equalTo: logoLabel.trailingAnchor, constant: 8),
      titleLabel.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),

      closeButton.trailingAnchor.constraint(equalTo: headerView.trailingAnchor),
      closeButton.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),
      closeButton.widthAnchor.constraint(equalToConstant: 36),
      closeButton.heightAnchor.constraint(equalToConstant: 36),
    ])

    // Loading state
    statusLabel.text = localizedString(fr: "Analyse en cours…", en: "Analyzing…")
    statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
    statusLabel.textColor = textMuted
    statusLabel.textAlignment = .center
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    containerView.addSubview(statusLabel)

    spinnerView.color = primaryColor
    spinnerView.startAnimating()
    spinnerView.translatesAutoresizingMaskIntoConstraints = false
    containerView.addSubview(spinnerView)

    NSLayoutConstraint.activate([
      spinnerView.topAnchor.constraint(equalTo: headerView.bottomAnchor, constant: 40),
      spinnerView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
      statusLabel.topAnchor.constraint(equalTo: spinnerView.bottomAnchor, constant: 12),
      statusLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
      statusLabel.bottomAnchor.constraint(lessThanOrEqualTo: containerView.bottomAnchor, constant: -40),
    ])

    // Result container (hidden initially)
    resultContainer.isHidden = true
    resultContainer.translatesAutoresizingMaskIntoConstraints = false
    containerView.addSubview(resultContainer)

    NSLayoutConstraint.activate([
      resultContainer.topAnchor.constraint(equalTo: headerView.bottomAnchor, constant: 20),
      resultContainer.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
      resultContainer.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
      resultContainer.bottomAnchor.constraint(equalTo: containerView.safeAreaLayoutGuide.bottomAnchor, constant: -20),
    ])

    setupResultUI()
  }

  private func setupResultUI() {
    // Platform badge
    platformBadge.font = .systemFont(ofSize: 13, weight: .heavy)
    platformBadge.textAlignment = .center
    platformBadge.layer.cornerRadius = 12
    platformBadge.clipsToBounds = true
    platformBadge.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(platformBadge)

    // Fare (gros chiffre)
    fareLabel.font = .systemFont(ofSize: 40, weight: .black)
    fareLabel.textColor = textMain
    fareLabel.textAlignment = .center
    fareLabel.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(fareLabel)

    // Hourly rate
    hourlyRateLabel.font = .systemFont(ofSize: 22, weight: .bold)
    hourlyRateLabel.textColor = primaryColor
    hourlyRateLabel.textAlignment = .center
    hourlyRateLabel.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(hourlyRateLabel)

    // KM rate
    kmRateLabel.font = .systemFont(ofSize: 14, weight: .semibold)
    kmRateLabel.textColor = textMuted
    kmRateLabel.textAlignment = .center
    kmRateLabel.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(kmRateLabel)

    // Stats row (distance + durée)
    let statsStack = UIStackView()
    statsStack.axis = .horizontal
    statsStack.distribution = .fillEqually
    statsStack.spacing = 12
    statsStack.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(statsStack)

    distanceLabel.font = .systemFont(ofSize: 14, weight: .semibold)
    distanceLabel.textColor = textMain
    distanceLabel.textAlignment = .center
    let distCard = makeStatCard(icon: "📍", label: distanceLabel)
    statsStack.addArrangedSubview(distCard)

    durationLabel.font = .systemFont(ofSize: 14, weight: .semibold)
    durationLabel.textColor = textMain
    durationLabel.textAlignment = .center
    let durCard = makeStatCard(icon: "⏱", label: durationLabel)
    statsStack.addArrangedSubview(durCard)

    // Addresses
    pickupLabel.font = .systemFont(ofSize: 12, weight: .medium)
    pickupLabel.textColor = textMuted
    pickupLabel.numberOfLines = 1
    pickupLabel.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(pickupLabel)

    destinationLabel.font = .systemFont(ofSize: 12, weight: .medium)
    destinationLabel.textColor = textMuted
    destinationLabel.numberOfLines = 1
    destinationLabel.translatesAutoresizingMaskIntoConstraints = false
    resultContainer.addSubview(destinationLabel)

    // Open in app button
    let openButton = UIButton(type: .system)
    openButton.setTitle(localizedString(fr: "Ouvrir dans Strive", en: "Open in Strive"), for: .normal)
    openButton.setTitleColor(bgColor, for: .normal)
    openButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
    openButton.backgroundColor = primaryColor
    openButton.layer.cornerRadius = 14
    openButton.translatesAutoresizingMaskIntoConstraints = false
    openButton.addTarget(self, action: #selector(openMainApp), for: .touchUpInside)
    resultContainer.addSubview(openButton)

    NSLayoutConstraint.activate([
      platformBadge.topAnchor.constraint(equalTo: resultContainer.topAnchor),
      platformBadge.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),
      platformBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 70),
      platformBadge.heightAnchor.constraint(equalToConstant: 24),

      fareLabel.topAnchor.constraint(equalTo: platformBadge.bottomAnchor, constant: 12),
      fareLabel.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),

      hourlyRateLabel.topAnchor.constraint(equalTo: fareLabel.bottomAnchor, constant: 4),
      hourlyRateLabel.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),

      kmRateLabel.topAnchor.constraint(equalTo: hourlyRateLabel.bottomAnchor, constant: 2),
      kmRateLabel.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),

      statsStack.topAnchor.constraint(equalTo: kmRateLabel.bottomAnchor, constant: 16),
      statsStack.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor),
      statsStack.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor),
      statsStack.heightAnchor.constraint(equalToConstant: 52),

      pickupLabel.topAnchor.constraint(equalTo: statsStack.bottomAnchor, constant: 14),
      pickupLabel.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor, constant: 4),
      pickupLabel.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor, constant: -4),

      destinationLabel.topAnchor.constraint(equalTo: pickupLabel.bottomAnchor, constant: 4),
      destinationLabel.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor, constant: 4),
      destinationLabel.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor, constant: -4),

      openButton.topAnchor.constraint(equalTo: destinationLabel.bottomAnchor, constant: 18),
      openButton.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor),
      openButton.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor),
      openButton.heightAnchor.constraint(equalToConstant: 50),
      openButton.bottomAnchor.constraint(lessThanOrEqualTo: resultContainer.bottomAnchor),
    ])
  }

  private func makeStatCard(icon: String, label: UILabel) -> UIView {
    let card = UIView()
    card.backgroundColor = surfaceColor
    card.layer.cornerRadius = 12

    let iconLabel = UILabel()
    iconLabel.text = icon
    iconLabel.font = .systemFont(ofSize: 16)
    iconLabel.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(iconLabel)

    label.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(label)

    NSLayoutConstraint.activate([
      iconLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
      iconLabel.centerYAnchor.constraint(equalTo: card.centerYAnchor),
      label.leadingAnchor.constraint(equalTo: iconLabel.trailingAnchor, constant: 6),
      label.centerYAnchor.constraint(equalTo: card.centerYAnchor),
      label.trailingAnchor.constraint(lessThanOrEqualTo: card.trailingAnchor, constant: -12),
    ])

    return card
  }

  // MARK: - Image Processing

  // Garde-fou : `loadItem` peut invoquer son completion plusieurs fois (timeout
  // interne, retry du provider…). Sans ce flag, on lance plusieurs analyses
  // Gemini en parallèle pour la même image → coûts dupliqués + UI flicker.
  private var hasProcessed = false

  // Filet global : garantit que l'extension atteint TOUJOURS un état terminal.
  // Armé une fois à l'entrée de `analyzeImage`, désarmé dans les deux méthodes
  // terminales (`showResult` / `showError`) — et non à chaque site d'appel, pour
  // qu'un futur chemin de sortie ne puisse pas oublier de le faire.
  //
  // 25 s = le budget total du pipeline (OCR ≤ 20 s watchdog ScanProcessor, puis
  // Gemini ≤ 12 s, puis TomTom ~4 s/requête). Ne se déclenche jamais en usage
  // normal (médiane ~3 s) : c'est un filet, pas une cible.
  private var hasShownOutcome = false
  private var uiWatchdog: DispatchWorkItem?

  private func armWatchdog(_ seconds: TimeInterval = 25) {
    uiWatchdog?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self = self, !self.hasShownOutcome else { return }
      self.showError(self.localizedString(
        fr: "Analyse trop longue — vérifie ta connexion",
        en: "Analysis timed out — check your connection"
      ), code: .timeout)
    }
    uiWatchdog = work
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
  }

  /// Vrai si CETTE exécution a pris le verrou anti double-scan. Indispensable :
  /// le verrou est un horodatage global dans l'App Group, sans notion de
  /// propriétaire — une extension qui affiche « analyse déjà en cours » puis se
  /// ferme libérerait le verrou d'un scan appartenant à un autre process.
  private var ownsScanLock = false

  /// Libère le verrou, uniquement si on l'a pris. Idempotent.
  private func releaseScanLockIfOwned() {
    guard ownsScanLock else { return }
    ownsScanLock = false
    ScanProcessor.markScanFinished()
  }

  /// Marque l'état terminal atteint et désarme le filet. Idempotent.
  /// Libère aussi le verrou de scan : centralisé ici pour qu'un futur chemin de
  /// sortie ne puisse pas l'oublier et bloquer les scans suivants 30 s durant.
  private func disarmWatchdog() {
    hasShownOutcome = true
    uiWatchdog?.cancel()
    uiWatchdog = nil
    releaseScanLockIfOwned()
  }

  /// Le partage de capture N'ANALYSE PLUS. Le scan iOS passe exclusivement par le
  /// bouton Action / raccourci (`AnalyzeRideIntent`) : c'est le seul chemin qui
  /// peut afficher le verdict dans la Live Activity et taguer la course sans
  /// ouvrir l'app. Ici on se contente de renvoyer le chauffeur vers Strive.
  ///
  /// Le pipeline complet (OCR → Gemini → TomTom → App Group) reste plus bas dans
  /// ce fichier mais n'est plus atteignable — à supprimer dans un second temps.
  private func processSharedImage() {
    showUseTheApp()
  }

  /// Message de redirection + bouton d'ouverture de l'app.
  private func showUseTheApp() {
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.text = localizedString(
      fr: "📱  Passez par l'application\nLe scan se lance depuis Strive, avec le bouton Action ou le raccourci.",
      en: "📱  Use the app\nScanning runs from Strive, via the Action button or the shortcut."
    )
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.textColor = UIColor(white: 1.0, alpha: 0.7)

    // Bouton autonome : celui de `resultContainer` est contraint aux libellés du
    // résultat, qu'on n'affiche plus.
    let openButton = UIButton(type: .system)
    openButton.setTitle(localizedString(fr: "Ouvrir Strive", en: "Open Strive"), for: .normal)
    openButton.setTitleColor(bgColor, for: .normal)
    openButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
    openButton.backgroundColor = primaryColor
    openButton.layer.cornerRadius = 14
    openButton.translatesAutoresizingMaskIntoConstraints = false
    openButton.addTarget(self, action: #selector(openMainApp), for: .touchUpInside)
    containerView.addSubview(openButton)

    NSLayoutConstraint.activate([
      openButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 24),
      openButton.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
      openButton.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
      openButton.heightAnchor.constraint(equalToConstant: 50),
      openButton.bottomAnchor.constraint(
        lessThanOrEqualTo: containerView.safeAreaLayoutGuide.bottomAnchor, constant: -20),
    ])
  }

  /// ⚠️ Plus appelé — cf. `processSharedImage`. Conservé le temps de valider la
  /// bascule vers le raccourci, puis à supprimer avec le reste du pipeline.
  private func legacyProcessSharedImage() {
    // Court-circuit : quota journalier atteint → on n'engage ni Vision ni
    // TomTom ni Gemini (zéro coût). L'utilisateur voit un message dédié.
    let defaults = UserDefaults(suiteName: Self.appGroupId)
    // Scanner désactivé dans Strive (toggle "Trip ID actif") → on ne scanne pas.
    // Défaut = activé (clé absente).
    if let d = defaults, d.object(forKey: "scannerEnabled") != nil, !d.bool(forKey: "scannerEnabled") {
      showScannerDisabled()
      return
    }
    // Quota appliqué CÔTÉ NATIF (compteur App Group) → ne dépend pas du JS, qui
    // est suspendu pendant un scan via l'extension. On bloque si le compteur
    // natif atteint la limite OU si le drapeau JS le dit — ce dernier seulement
    // s'il date d'aujourd'hui. Non daté, il survivait à la nuit et refusait les
    // scans du lendemain alors que le compteur, lui, était bien reparti à zéro.
    let flagIsToday = defaults.map {
      $0.bool(forKey: "scanQuotaReached")
        && $0.integer(forKey: "scanQuotaReachedDay") == Self.currentQuotaDay($0)
    } ?? false
    if isScanQuotaReached() || flagIsToday {
      showQuotaReached()
      return
    }
    // Verrou anti double-scan, partagé avec le raccourci via l'App Group. Posé
    // APRÈS les gardes ci-dessus : un scan refusé d'entrée ne doit pas bloquer le
    // suivant. Sans ce verrou, deux partages rapprochés lançaient deux pipelines
    // complets — deux appels Gemini payants, deux courses en base, deux scans
    // décomptés du quota — pour une seule offre à l'écran. Le raccourci était
    // protégé depuis longtemps, le Share Sheet non, alors que le commentaire de
    // `shouldThrottleRapidScan` affirmait le couvrir.
    if ScanProcessor.shouldThrottleRapidScan() {
      showScanAlreadyRunning()
      return
    }
    ownsScanLock = true

    guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
          let attachments = extensionItem.attachments
    else {
      showError(localizedString(fr: "Aucune image reçue", en: "No image received"), code: .invalidImage)
      return
    }

    let imageType = UTType.image.identifier

    for attachment in attachments {
      if attachment.hasItemConformingToTypeIdentifier(imageType) {
        attachment.loadItem(forTypeIdentifier: imageType, options: nil) { [weak self] item, error in
          DispatchQueue.main.async {
            guard let self = self, !self.hasProcessed else { return }

            if let error = error {
              // Pas de set hasProcessed=true : si loadItem retry et réussit,
              // on veut pouvoir traiter cette 2e tentative.
              self.showError(self.localizedString(fr: "Erreur : ", en: "Error: ") + error.localizedDescription, code: .invalidImage)
              return
            }

            var image: UIImage?

            if let url = item as? URL, let data = try? Data(contentsOf: url) {
              image = UIImage(data: data)
            } else if let data = item as? Data {
              image = UIImage(data: data)
            } else if let img = item as? UIImage {
              image = img
            }

            if let image = image {
              self.hasProcessed = true
              self.analyzeImage(image)
            } else {
              self.showError(self.localizedString(fr: "Format d'image non supporté", en: "Unsupported image format"), code: .invalidImage)
            }
          }
        }
        return
      }
    }

    showError(localizedString(fr: "Aucune image trouvée dans le partage", en: "No image found in the share"), code: .invalidImage)
  }

  private func analyzeImage(_ image: UIImage) {
    armWatchdog()
    ScanProcessor.shared.process(image: image) { [weak self] finalResult in
      DispatchQueue.main.async {
        guard let self = self else { return }
        guard let result = finalResult else {
          self.fallbackToGemini(image: image)
          return
        }
        // Sans les 2 adresses, TomTom n'a pas pu géocoder → les métriques
        // viennent de l'OCR brut (durée d'approche souvent confondue avec la
        // course → €/h gonflé). On ne valide pas une telle course : on tente
        // Gemini, qui récupère les adresses puis relance TomTom.
        let pickup = result.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let dest = result.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !pickup.isEmpty, !dest.isEmpty else {
          self.fallbackToGemini(image: image)
          return
        }
        self.incrementScanCount()
        self.showResult(from: result)
        self.saveSharedResult(result)
      }
    }
  }

  private func fallbackToGemini(image: UIImage) {
    // Pré-filtre anti-pub : si l'OCR a lu du texte mais aucun signal d'offre VTC
    // (prix €, km/min, plateforme), inutile de payer un appel Gemini — c'est
    // probablement une pub ou un écran quelconque. (true aussi si OCR vide.)
    guard ScanProcessor.shared.lastScanMayBeRide else {
      showError(localizedString(
        fr: "Aucune offre de course détectée",
        en: "No ride offer detected"
      ))
      return
    }
    statusLabel.text = localizedString(fr: "Analyse IA en cours…", en: "AI analysis in progress…")

    // Charger la config Gemini depuis App Group — l'app principale a écrit ces
    // clés via `ScanBridge.setGeminiConfig` / `setSupabaseUserJwt`.
    //
    // Service PARTAGÉ avec l'app et l'AppIntent (target membership ajoutée) :
    // prompt, bornes de validation, timeouts et auth sont désormais définis à un
    // seul endroit. La copie locale `GeminiVisionServiceLight` avait divergé
    // (tarif min 5 € vs 3 €, distance max 500 vs 1000 km, prompt différent) →
    // une même course pouvait être acceptée par le raccourci Siri et refusée
    // par le Share Sheet.
    let defaults = UserDefaults(suiteName: Self.appGroupId)
    let service = GeminiVisionService.shared
    service.edgeFunctionUrl = defaults?.string(forKey: "geminiEdgeUrl")
    service.supabaseAnonKey = defaults?.string(forKey: "geminiSupabaseKey")
    service.apiKey = defaults?.string(forKey: "geminiApiKey")
    service.supabaseUserJwt = defaults?.string(forKey: "supabaseUserJwt")

    service.analyze(image: image) { [weak self] geminiResult in
      guard let self = self else { return }
      // `analyze` rend la main sur le main thread ; les `DispatchQueue.main.async`
      // ci-dessous restent inoffensifs (async, jamais sync → pas de deadlock).
      guard let result = geminiResult?.asScanResult else {
        DispatchQueue.main.async { self.showError(self.localizedString(fr: "Impossible d'analyser cette image", en: "Could not analyze this image"), code: .geminiKo) }
        return
      }

      // B : si Gemini a récupéré les 2 adresses, on les envoie à TomTom pour la
      // VRAIE distance/durée — c'est le cœur du produit (les valeurs affichées
      // par Uber/Bolt sont minorées). Sinon on affiche le résultat Gemini brut.
      let pickup = result.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let dest = result.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      // Gemini n'a pas lu les 2 adresses → ni géocodage ni métriques fiables
      // possibles. Règle produit : pas de course sans ses 2 adresses. On affiche
      // scan échoué et on n'enregistre RIEN (ni UI extension, ni App Group).
      guard !pickup.isEmpty, !dest.isEmpty else {
        DispatchQueue.main.async {
          self.showError(self.localizedString(
            fr: "Scan échoué — adresses illisibles, réessaie",
            en: "Scan failed — addresses unreadable, try again"
          ), code: .noAddresses)
        }
        return
      }

      // On repasse par ScanProcessor.computeFinal comme le chemin OCR : c'est lui
      // qui applique les seuils ET la préférence `includePickup` (l'ancien calcul
      // local ici ignorait le réglage → verdict identique ON/OFF).
      guard TomTomService.shared.isReady else {
        DispatchQueue.main.async {
          let final = ScanProcessor.shared.computeFinal(scan: result)
          self.incrementScanCount()
          self.showResult(from: final)
          self.saveSharedResult(final)
        }
        return
      }

      DispatchQueue.main.async { self.statusLabel.text = self.localizedString(fr: "Calcul de l'itinéraire…", en: "Calculating the route…") }
      TomTomService.shared.calculateRoute(pickupAddress: pickup, destinationAddress: dest) { route in
        // calculateRoute rend la main sur le main thread.
        var refined = result
        if let route = route,
           route.distanceKm >= 0.3, route.distanceKm <= 500, route.durationMin <= 300 {
          let ratio = result.fare / route.distanceKm
          if ratio >= 0.2, ratio <= 12.0 {
            refined = result.copy(
              distanceKm: route.distanceKm, durationMin: route.durationMin,
              pickupAddress: route.pickupFormatted, destinationAddress: route.destFormatted
            )
          }
        }
        let final = ScanProcessor.shared.computeFinal(scan: refined)
        self.incrementScanCount()
        self.showResult(from: final)
        self.saveSharedResult(final)
      }
    }
  }

  // MARK: - Adapter pour les anciennes vues du résultat (struct Light)
  //
  // Les vues SwiftUI/UIKit du Share Extension ont été écrites avant le port de
  // OcrParser.swift. On garde la struct legacy pour ne pas tout réécrire — elle
  // n'est plus alimentée que par l'adapter ci-dessous.

  struct ParsedResult {
    let platform: String
    let fare: Double
    let distanceKm: Double
    let durationMin: Int?
    let pickupAddress: String?
    let destinationAddress: String?
  }

  /// Adapter ScanProcessor.FinalResult → ancienne struct utilisée par showResult.
  private func showResult(from final: ScanProcessor.FinalResult) {
    let legacy = ParsedResult(
      platform: final.scan.platform.rawValue,
      fare: final.displayFare,
      distanceKm: final.totalDistanceKm,
      durationMin: final.totalDurationMin,
      pickupAddress: final.scan.pickupAddress,
      destinationAddress: final.scan.destinationAddress
    )
    // On passe les valeurs déjà calculées par computeFinal (qui gère
    // l'inclusion du trajet d'approche selon includePickup) au lieu de les
    // recalculer ici → cohérence stricte avec l'app principale et le verdict.
    showResult(legacy, hourlyRate: final.hourlyRate, kmRate: final.kmRate, verdictLevel: final.verdictLevel)
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
    // Plafond : au-delà, c'est que l'app n'a pas tourné depuis longtemps — on
    // garde les plus récents plutôt que de laisser enfler indéfiniment.
    // 100 et non 20 : la file n'est vidée qu'au passage au premier plan, et
    // l'usage visé est un chauffeur qui n'ouvre pas l'app de la journée.
    // Doit rester aligné avec AnalyzeRideIntent.enqueueScanResult.
    if queue.count > 100 { queue = Array(queue.suffix(100)) }
    if let data = try? JSONSerialization.data(withJSONObject: queue) {
      defaults.set(data, forKey: "pendingScanResults")
    }
  }

  /// Repousse d'1h le rappel « Session inactive ». Il est planifié côté JS au
  /// passage en ligne et re-planifié à chaque scan traité par le JS — or un scan
  /// fait depuis la Share Extension arrive dans la file App Group sans que l'app
  /// tourne : le chauffeur recevait la notif en pleine tournée. Identifiant et
  /// délai alignés sur `localNotifications.ts`. Doit rester aligné avec
  /// AnalyzeRideIntent.rescheduleInactivityReminder.
  private func rescheduleInactivityReminder(defaults: UserDefaults) {
    guard defaults.bool(forKey: "sessionOnline") else { return }
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: ["inactivity"])
    let content = UNMutableNotificationContent()
    content.title = localizedString(fr: "Session inactive", en: "Inactive session")
    content.body = localizedString(
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

  /// Sauve le résultat pour que l'app principale puisse le picker au foreground.
  private func saveSharedResult(_ final: ScanProcessor.FinalResult) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    var body: [String: Any] = [
      "platform": final.scan.platform.rawValue,
      "fare": final.scan.fare,
      "distanceKm": final.totalDistanceKm,
      "durationMin": final.totalDurationMin,
      "hourlyRate": final.hourlyRate,
      "kmRate": final.kmRate,
      "verdictLevel": final.verdictLevel,
      // Tarif d'AFFICHAGE (net de carburant si l'option est active) ; `fare`
      // reste brut pour l'enregistrement en base.
      "displayFare": final.displayFare,
    ]
    // Champ purement diagnostique : hors DEBUG il n'est plus émis (le payload
    // est persisté dans la file `pendingScanResults` de l'App Group). Le lecteur
    // côté ScanBridgeModule le lit déjà avec un repli `?? "unknown"`.
    #if DEBUG
    body["_liveActivityDebug"] = defaults.string(forKey: "liveActivityDebug") ?? "not-written"
    #endif
    if let pickup = final.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = final.scan.destinationAddress { body["destinationAddress"] = dest }

    // Diagnostic parser : blocs OCR joints UNIQUEMENT quand une adresse manque —
    // seul cas exploitable pour corriger l'heuristique, et seul cas où le JS
    // écrit dans `scan_debug`. Les joindre systématiquement gonflerait la file
    // App Group (plafonnée à 20 entrées) sans usage.
    if final.scan.pickupAddress?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
      || final.scan.destinationAddress?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false,
      let blocks = ScanProcessor.shared.lastBlocksJson {
      body["debugBlocks"] = blocks
      body["screenHeight"] = ScanProcessor.shared.lastScreenHeight
    }

    // scanTs porté par le payload lui-même : dans la file, chaque entrée doit
    // être auto-suffisante (la clé timestamp globale ne vaut que pour la dernière).
    let scanTs = Date().timeIntervalSince1970
    body["scanTs"] = scanTs
    enqueueScanResult(body, defaults: defaults)
    rescheduleInactivityReminder(defaults: defaults)

    // Écriture immédiate, en session de FOND : le démon système porte le
    // transfert même si le chauffeur referme le panneau dans la seconde, et
    // attend le réseau au lieu d'abandonner. L'outbox ci-dessus reste écrite
    // d'abord et reste LA garantie — cet envoi ne fait que raccourcir le délai,
    // et son échec est sans conséquence (le drain rattrape, l'index unique sur
    // `scan_ts` interdit le doublon).
    RideUploader.upload(final, scanTs: scanTs)

    // Jumelle minimale que le drain de l'app NE purge PAS — source de l'incrément
    // KPI natif du bouton ✅ / des commandes Siri (cf. lastScannedFareKm).
    defaults.set(
      ["scanTs": scanTs, "fare": final.displayFare, "km": final.totalDistanceKm],
      forKey: "lastTaggableRide"
    )

    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: Self.scanResultKey)
      defaults.set(scanTs, forKey: Self.scanTimestampKey)
      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center,
        CFNotificationName("com.striveapp.app.scanResult" as CFString),
        nil, nil, true
      )
    }
  }

  // MARK: - Display Result

  /// Affiche le résultat. `hourlyRate`/`kmRate`/`verdictLevel` optionnels :
  /// fournis pour le chemin principal (valeurs autoritatives de computeFinal),
  /// `nil` pour les chemins sans FinalResult (teaser quota, fallback Gemini) →
  /// recalcul local de secours.
  private func showResult(
    _ result: ParsedResult,
    hourlyRate hourlyRateOverride: Double? = nil,
    kmRate kmRateOverride: Double? = nil,
    verdictLevel verdictOverride: Int? = nil
  ) {
    disarmWatchdog()
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.isHidden = true
    resultContainer.isHidden = false

    let color = platformColors[result.platform] ?? textMuted

    // Platform
    platformBadge.text = "  \(result.platform)  "
    platformBadge.textColor = bgColor
    platformBadge.backgroundColor = color

    // Fare
    fareLabel.text = String(format: "%.2f €", result.fare)

    // Rates — valeurs autoritatives si fournies, sinon recalcul de secours.
    let durationMin = result.durationMin ?? Int(result.distanceKm / 25 * 60)
    let hourlyRate = hourlyRateOverride ?? result.fare / (Double(durationMin) / 60.0)
    let kmRate = kmRateOverride ?? result.fare / result.distanceKm

    hourlyRateLabel.text = String(format: "%.0f €/h", hourlyRate)
    kmRateLabel.text = String(format: "%.2f €/km", kmRate)

    // Stats
    distanceLabel.text = String(format: "%.1f km", result.distanceKm)
    durationLabel.text = "\(durationMin) min"

    // Addresses
    if let pickup = result.pickupAddress {
      pickupLabel.text = "📌 \(pickup)"
    } else {
      pickupLabel.text = ""
    }
    if let dest = result.destinationAddress {
      destinationLabel.text = "🏁 \(dest)"
    } else {
      destinationLabel.text = ""
    }

    // Verdict color — niveau autoritatif si fourni, sinon recalcul local.
    let hrOk: Bool
    let kmOk: Bool
    if let level = verdictOverride {
      hrOk = level >= 1
      kmOk = level >= 2
    } else {
      let prefs = UserDefaults(suiteName: Self.appGroupId)
      // `object(forKey:)` : `double(forKey:)` rend 0.0 sur clé absente → seuils
      // à 0, tout passait pour rentable. Même correctif que ScanProcessor.
      let minHourly = (prefs?.object(forKey: "minHourlyRate") as? Double) ?? 25
      let minKm = (prefs?.object(forKey: "minKmRate") as? Double) ?? 1.2
      hrOk = hourlyRate >= minHourly
      kmOk = kmRate >= minKm
    }

    if hrOk && kmOk {
      hourlyRateLabel.textColor = primaryColor
      fareLabel.textColor = primaryColor
    } else if hrOk || kmOk {
      hourlyRateLabel.textColor = UIColor.orange
      fareLabel.textColor = UIColor.orange
    } else {
      hourlyRateLabel.textColor = UIColor(red: 1.0, green: 0.3, blue: 0.3, alpha: 1.0)
      fareLabel.textColor = UIColor(red: 1.0, green: 0.3, blue: 0.3, alpha: 1.0)
    }
  }

  /// Un scan tourne déjà (ce partage, un précédent, ou le raccourci). On ne
  /// relance pas un pipeline en parallèle : le résultat en cours s'affichera dans
  /// l'app / la Live Activity, on y renvoie le chauffeur.
  private func showScanAlreadyRunning() {
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.text = localizedString(
      fr: "⏳  Analyse déjà en cours\nOuvrez Strive pour voir le résultat",
      en: "⏳  Analysis already running\nOpen Strive to see the result"
    )
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.textColor = UIColor(white: 1.0, alpha: 0.6)
  }

  private func showScannerDisabled() {
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.text = localizedString(
      fr: "⏸  Scanner désactivé\nActivez-le dans Strive › Préférences",
      en: "⏸  Scanner disabled\nEnable it in Strive › Preferences"
    )
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.textColor = UIColor(white: 1.0, alpha: 0.6)
  }

  /// Quota appliqué côté natif : le JS pousse le compteur réel (`scanCountToday`)
  /// + la limite ; le natif incrémente entre deux syncs. Indépendant du JS.
  private func isScanQuotaReached() -> Bool {
    guard let d = UserDefaults(suiteName: Self.appGroupId) else { return false }
    let isFree = (d.object(forKey: "isFreeTier") as? Bool) ?? true
    if !isFree { return false }
    let limit = d.integer(forKey: "scanQuotaLimit")
    if limit <= 0 { return false }   // limite inconnue / illimitée → on ne bloque pas
    return Self.scanCountForToday(d) >= limit
  }

  /// Compteur du jour, en ignorant une valeur datée d'hier (app pas rouverte
  /// depuis l'heure de reset → `scanCountToday` tiendrait encore le compte de la veille).
  private static func scanCountForToday(_ d: UserDefaults) -> Int {
    if d.integer(forKey: "scanCountDay") != currentQuotaDay(d) { return 0 }
    return d.integer(forKey: "scanCountToday")
  }

  /// Jour de quota (yyyymmdd) en tenant compte du `quotaResetHour` (0 ou 4h)
  /// poussé par le JS via setScanQuota. Aligné sur getDayStart() côté JS.
  private static func currentQuotaDay(_ d: UserDefaults) -> Int {
    let resetHour = d.integer(forKey: "quotaResetHour")
    let shifted = Date().addingTimeInterval(TimeInterval(-resetHour * 3600))
    let c = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
    return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
  }

  private func incrementScanCount() {
    guard let d = UserDefaults(suiteName: Self.appGroupId) else { return }
    // Nouveau jour → on repart de 0 avant d'incrémenter (l'app n'a pas forcément
    // été rouverte pour pousser le reset via setScanQuota).
    let today = Self.currentQuotaDay(d)
    let base = d.integer(forKey: "scanCountDay") == today ? d.integer(forKey: "scanCountToday") : 0
    d.set(today, forKey: "scanCountDay")
    d.set(base + 1, forKey: "scanCountToday")
  }

  private func showQuotaReached() {
    // Free → teaser verrouillé (vendre Plus). Plus → simple message (déjà abonné).
    let isFree = (UserDefaults(suiteName: Self.appGroupId)?.object(forKey: "isFreeTier") as? Bool) ?? true
    if isFree {
      showQuotaLockedTeaser()
      return
    }
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.text = localizedString(
      fr: "🔒  Quota journalier atteint\nReviens demain ou achète des crédits",
      en: "🔒  Daily quota reached\nCome back tomorrow or buy credits"
    )
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.textColor = UIColor(red: 1.0, green: 0.60, blue: 0.0, alpha: 1.0)
  }

  /// Teaser quota free : on réutilise le VRAI affichage résultat avec une course
  /// rentable factice (zéro scan, zéro API), puis on floute le tout + cadenas.
  /// Le chauffeur voit qu'il rate une bonne course → pousse vers Plus.
  private func showQuotaLockedTeaser() {
    showResult(ParsedResult(
      platform: "UBER",
      fare: 24.0,
      distanceKm: 12.6,
      durationMin: 29,
      pickupAddress: nil,
      destinationAddress: nil
    ))

    // Flou par-dessus le résultat
    let blur = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
    blur.translatesAutoresizingMaskIntoConstraints = false
    blur.layer.cornerRadius = 16
    blur.clipsToBounds = true
    resultContainer.addSubview(blur)

    let lock = UILabel()
    lock.text = "🔒"
    lock.font = .systemFont(ofSize: 30)
    lock.textAlignment = .center
    lock.translatesAutoresizingMaskIntoConstraints = false

    let title = UILabel()
    title.text = localizedString(fr: "Passe Plus pour voir", en: "Go Plus to see")
    title.font = .systemFont(ofSize: 17, weight: .bold)
    title.textColor = .white
    title.textAlignment = .center
    title.translatesAutoresizingMaskIntoConstraints = false

    let sub = UILabel()
    sub.text = localizedString(fr: "Se rembourse en une course", en: "Pays for itself in one ride")
    sub.font = .systemFont(ofSize: 13, weight: .medium)
    sub.textColor = UIColor(white: 1.0, alpha: 0.7)
    sub.textAlignment = .center
    sub.numberOfLines = 0
    sub.translatesAutoresizingMaskIntoConstraints = false

    resultContainer.addSubview(lock)
    resultContainer.addSubview(title)
    resultContainer.addSubview(sub)

    NSLayoutConstraint.activate([
      blur.topAnchor.constraint(equalTo: resultContainer.topAnchor),
      blur.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor),
      blur.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor),
      blur.bottomAnchor.constraint(equalTo: resultContainer.bottomAnchor),

      title.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),
      title.centerYAnchor.constraint(equalTo: resultContainer.centerYAnchor),
      lock.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),
      lock.bottomAnchor.constraint(equalTo: title.topAnchor, constant: -8),
      sub.centerXAnchor.constraint(equalTo: resultContainer.centerXAnchor),
      sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
      sub.leadingAnchor.constraint(equalTo: resultContainer.leadingAnchor, constant: 16),
      sub.trailingAnchor.constraint(equalTo: resultContainer.trailingAnchor, constant: -16),
    ])
  }

  /// `code` est affiché en fin de message pour que le chauffeur puisse le citer
  /// en support. C'est le seul canal de remontée des échecs de cette extension :
  /// contrairement à l'AppIntent, elle n'écrit rien dans `scan_failures`.
  private func showError(_ message: String, code: ScanErrorCode? = nil) {
    disarmWatchdog()
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.text = code == nil
      ? "✕ \(message)"
      : "✕ \(message)\n(\(code!.rawValue))"
    statusLabel.textColor = UIColor(red: 1.0, green: 0.3, blue: 0.3, alpha: 1.0)
  }

  // MARK: - App Group Communication

  // Le chemin Gemini passe désormais par `saveSharedResult(_: FinalResult)` —
  // seule source de vérité pour les métriques (seuils + includePickup).

  // MARK: - Actions

  /// Sorties manuelles : iOS tue le process dès la fermeture de la feuille. Sans
  /// libération ici, un verrou pris par un scan encore en cours resterait tenu
  /// jusqu'à son plafond de 30 s et bloquerait les scans par raccourci.
  @objc private func openMainApp() {
    releaseScanLockIfOwned()
    // Apple rejette en review tout walk de la responder-chain pour récupérer
    // UIApplication depuis une extension. La seule API publique pour ouvrir
    // l'app hôte est `extensionContext.open(_:completionHandler:)`.
    guard let url = URL(string: "strive://scan-result") else {
      dismissExtension()
      return
    }
    extensionContext?.open(url) { [weak self] _ in
      self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  @objc private func dismissExtension() {
    releaseScanLockIfOwned()
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}

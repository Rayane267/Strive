import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers
import Vision

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
    let appLang = UserDefaults(suiteName: Self.appGroupId)?.string(forKey: "appLanguage")
    let lang = appLang ?? Locale.current.languageCode ?? "en"
    return lang.hasPrefix("fr") ? fr : en
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
    statusLabel.text = "Analyse en cours…"
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
    openButton.setTitle("Ouvrir dans Strive", for: .normal)
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

  private func processSharedImage() {
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
    // natif atteint la limite OU si le flag JS le dit (ceinture + bretelles).
    if isScanQuotaReached() || defaults?.bool(forKey: "scanQuotaReached") == true {
      showQuotaReached()
      return
    }

    guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
          let attachments = extensionItem.attachments
    else {
      showError("Aucune image reçue")
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
              self.showError("Erreur : \(error.localizedDescription)")
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
              self.showError("Format d'image non supporté")
            }
          }
        }
        return
      }
    }

    showError("Aucune image trouvée dans le partage")
  }

  private func analyzeImage(_ image: UIImage) {
    ScanProcessor.shared.process(image: image) { [weak self] finalResult in
      DispatchQueue.main.async {
        guard let self = self else { return }
        guard let result = finalResult else {
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
    statusLabel.text = "Analyse IA en cours…"

    // Charger la config Gemini depuis App Group — l'app principale a écrit ces
    // clés via `ScanBridge.setGeminiConfig` / `setSupabaseUserJwt`.
    let defaults = UserDefaults(suiteName: Self.appGroupId)
    let service = GeminiVisionServiceLight()
    service.edgeFunctionUrl = defaults?.string(forKey: "geminiEdgeUrl")
    service.supabaseAnonKey = defaults?.string(forKey: "geminiSupabaseKey")
    service.apiKey = defaults?.string(forKey: "geminiApiKey")
    service.supabaseUserJwt = defaults?.string(forKey: "supabaseUserJwt")

    service.analyze(image: image) { [weak self] result in
      DispatchQueue.main.async {
        guard let self = self else { return }
        if let result = result {
          self.incrementScanCount()
          self.showResult(result)
          self.saveResultForMainApp(result)
        } else {
          self.showError("Impossible d'analyser cette image")
        }
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
      fare: final.scan.fare,
      distanceKm: final.totalDistanceKm,
      durationMin: final.totalDurationMin,
      pickupAddress: final.scan.pickupAddress,
      destinationAddress: final.scan.destinationAddress
    )
    showResult(legacy)
  }

  /// Sauve le résultat pour que l'app principale puisse le picker au foreground.
  private func saveSharedResult(_ final: ScanProcessor.FinalResult) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    let laStatus = defaults.string(forKey: "liveActivityDebug") ?? "not-written"
    var body: [String: Any] = [
      "platform": final.scan.platform.rawValue,
      "fare": final.scan.fare,
      "distanceKm": final.totalDistanceKm,
      "durationMin": final.totalDurationMin,
      "hourlyRate": final.hourlyRate,
      "kmRate": final.kmRate,
      "verdictLevel": final.verdictLevel,
      "_liveActivityDebug": laStatus,
    ]
    if let pickup = final.scan.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = final.scan.destinationAddress { body["destinationAddress"] = dest }
    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: Self.scanResultKey)
      defaults.set(Date().timeIntervalSince1970, forKey: Self.scanTimestampKey)
      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center,
        CFNotificationName("com.striveapp.app.scanResult" as CFString),
        nil, nil, true
      )
    }
  }

  // MARK: - Display Result

  private func showResult(_ result: ParsedResult) {
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

    // Rates
    let durationMin = result.durationMin ?? Int(result.distanceKm / 25 * 60)
    let hourlyRate = result.fare / (Double(durationMin) / 60.0)
    let kmRate = result.fare / result.distanceKm

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

    // Verdict color
    let prefs = UserDefaults(suiteName: Self.appGroupId)
    let minHourly = prefs?.double(forKey: "minHourlyRate") ?? 25
    let minKm = prefs?.double(forKey: "minKmRate") ?? 1.2

    let hrOk = hourlyRate >= minHourly
    let kmOk = kmRate >= minKm

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

  private func showError(_ message: String) {
    spinnerView.stopAnimating()
    spinnerView.isHidden = true
    statusLabel.text = "✕ \(message)"
    statusLabel.textColor = UIColor(red: 1.0, green: 0.3, blue: 0.3, alpha: 1.0)
  }

  // MARK: - App Group Communication

  private func saveResultForMainApp(_ result: ParsedResult) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }

    let durationMin = result.durationMin ?? Int(result.distanceKm / 25 * 60)
    let hourlyRate = durationMin > 0 ? result.fare / (Double(durationMin) / 60.0) : 0
    let kmRate = result.distanceKm > 0 ? result.fare / result.distanceKm : 0

    let minH = defaults.double(forKey: "minHourlyRate")
    let minK = defaults.double(forKey: "minKmRate")
    let hrOk = hourlyRate >= (minH > 0 ? minH : 25.0)
    let kmOk = kmRate >= (minK > 0 ? minK : 1.2)
    let verdictLevel = (hrOk && kmOk) ? 2 : (hrOk || kmOk) ? 1 : 0

    let laStatus = defaults.string(forKey: "liveActivityDebug") ?? "not-written"

    var body: [String: Any] = [
      "platform": result.platform,
      "fare": result.fare,
      "distanceKm": result.distanceKm,
      "durationMin": durationMin,
      "hourlyRate": hourlyRate,
      "kmRate": kmRate,
      "verdictLevel": verdictLevel,
      "_liveActivityDebug": laStatus,
    ]
    if let pickup = result.pickupAddress { body["pickupAddress"] = pickup }
    if let dest = result.destinationAddress { body["destinationAddress"] = dest }

    if let data = try? JSONSerialization.data(withJSONObject: body) {
      defaults.set(data, forKey: Self.scanResultKey)
      defaults.set(Date().timeIntervalSince1970, forKey: Self.scanTimestampKey)

      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(center, CFNotificationName("com.striveapp.app.scanResult" as CFString), nil, nil, true)
    }
  }

  // MARK: - Actions

  @objc private func openMainApp() {
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
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}

// MARK: - Gemini Service Light (pour la Share Extension — version simplifiée sans dépendance)
//
// FIX DÉFINITIF ATTENDU : ajouter Target Membership `StriveShareExtension` sur
// `ios/Strive/ScanBridge/GeminiVisionService.swift` (Xcode → File Inspector),
// puis supprimer cette classe et appeler `GeminiVisionService.shared` ici.
// Tant que la passe Xcode n'est pas faite, toute modif du prompt / parsing /
// auth dans le service principal DOIT être répercutée ci-dessous, et inversement.

private class GeminiVisionServiceLight {
  var apiKey: String?
  var edgeFunctionUrl: String?
  var supabaseAnonKey: String?
  /// JWT user — exigé par l'edge function durcie (rate-limit + audit par user_id).
  /// Sans ça, l'edge function rejette la requête en 401/403.
  var supabaseUserJwt: String?

  func analyze(image: UIImage, completion: @escaping (ShareViewController.ParsedResult?) -> Void) {
    let maxWidth: CGFloat = 512
    let scaledImage: UIImage
    if image.size.width > maxWidth {
      let scale = maxWidth / image.size.width
      let newSize = CGSize(width: maxWidth, height: image.size.height * scale)
      UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
      image.draw(in: CGRect(origin: .zero, size: newSize))
      scaledImage = UIGraphicsGetImageFromCurrentImageContext() ?? image
      UIGraphicsEndImageContext()
    } else {
      scaledImage = image
    }

    guard let jpegData = scaledImage.jpegData(compressionQuality: 0.8) else {
      completion(nil)
      return
    }
    let base64 = jpegData.base64EncodedString()
    let prompt = """
    Analyse cette capture d'écran d'une offre de course VTC (Uber, Bolt ou Heetch).
    Retourne UNIQUEMENT un objet JSON avec ces champs :
    {
      "platform": "UBER" | "BOLT" | "HEETCH" | "UNKNOWN",
      "fare": <montant en euros, ex: 12.50>,
      "distance_km": <distance de la COURSE en km, ex: 11.8>,
      "duration_min": <durée de la course en minutes ou null si non visible>
    }
    IMPORTANT : distance_km = la distance TOTALE de la course (parfois affichée "Course de X km").
    Ne PAS confondre avec la distance d'approche pickup ("X min • Y km", ou "à X min (Y km)" sous l'adresse de prise en charge).
    Ne retourne rien d'autre que le JSON.
    """

    let request: URLRequest
    if let edgeUrl = edgeFunctionUrl, let anonKey = supabaseAnonKey,
       let url = URL(string: edgeUrl) {
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      // JWT user si dispo (edge function durcie l'exige), sinon anon key.
      // Doit rester aligné avec GeminiVisionService.swift de l'app principale.
      let bearer = (supabaseUserJwt?.isEmpty == false ? supabaseUserJwt! : anonKey)
      req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
      req.setValue(anonKey, forHTTPHeaderField: "apikey")
      // L'edge function durcie n'accepte QUE le format natif Gemini
      // (`contents[].parts[]`) — cf. isValidGeminiPayload dans gemini-proxy.
      // Doit rester aligné avec GeminiVisionService.swift / geminiFallback.ts.
      req.httpBody = try? JSONSerialization.data(withJSONObject: [
        "contents": [[
          "parts": [
            ["inline_data": ["mime_type": "image/jpeg", "data": base64]],
            ["text": prompt],
          ]
        ]]
      ])
      request = req
    } else if let key = apiKey,
              let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)") {
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try? JSONSerialization.data(withJSONObject: [
        "contents": [["parts": [
          ["text": prompt],
          ["inline_data": ["mime_type": "image/jpeg", "data": base64]]
        ]]]
      ])
      request = req
    } else {
      completion(nil)
      return
    }

    URLSession.shared.dataTask(with: request) { data, _, error in
      guard error == nil, let data = data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        completion(nil)
        return
      }

      var text: String?
      if let candidates = json["candidates"] as? [[String: Any]],
         let content = candidates.first?["content"] as? [String: Any],
         let parts = content["parts"] as? [[String: Any]],
         let t = parts.first?["text"] as? String { text = t }
      else if let t = json["result"] as? String { text = t }

      guard let responseText = text,
            let start = responseText.range(of: "{"),
            let end = responseText.range(of: "}", options: .backwards)
      else { completion(nil); return }

      let jsonStr = String(responseText[start.lowerBound...end.upperBound])
      guard let parsed = try? JSONSerialization.jsonObject(with: Data(jsonStr.utf8)) as? [String: Any],
            let platform = parsed["platform"] as? String,
            let fare = (parsed["fare"] as? NSNumber)?.doubleValue,
            let distKm = (parsed["distance_km"] as? NSNumber)?.doubleValue,
            fare >= 3, fare <= 200, distKm >= 0.3, distKm <= 150,
            // Ratio plausible : rejette les €/km démentiels (distance hallucinée).
            fare / distKm >= 0.2, fare / distKm <= 15
      else { completion(nil); return }

      let durMin = (parsed["duration_min"] as? NSNumber)?.intValue

      completion(ShareViewController.ParsedResult(
        platform: platform, fare: fare, distanceKm: distKm,
        durationMin: durMin, pickupAddress: nil, destinationAddress: nil
      ))
    }.resume()
  }
}

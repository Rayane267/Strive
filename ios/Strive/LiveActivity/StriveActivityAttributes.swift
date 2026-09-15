import Foundation
import ActivityKit
import AppIntents

/// Ce que le NATIF écrit, dans les sept langues de l'app.
///
/// La Live Activity et CarPlay ne peuvent pas appeler i18next : ils tournent
/// dans des processus qui n'ont jamais chargé JavaScript. Ils avaient donc leur
/// propre paire `laString(fr:en:)` — deux langues, et un repli sur le FRANÇAIS.
/// Un chauffeur espagnol qui avait mis Strive en espagnol lisait « Analyse… »
/// sur son écran verrouillé : ni sa langue, ni même celle de repli de l'app.
///
/// La langue vient de l'App Group, où `ScanBridge.setAppLanguage` l'écrit à
/// chaque choix. Pas de repli sur la locale SYSTÈME : un chauffeur qui a mis
/// Strive en français sur un iPhone en anglais doit lire du français partout, y
/// compris ici.
public enum StriveNativeStrings {
  static let table: [String: [String: String]] = [
    "analysisFailed": ["fr": "Analyse impossible", "en": "Analysis failed", "es": "Análisis imposible", "pt": "Análise impossível", "nl": "Analyse mislukt", "de": "Analyse fehlgeschlagen", "it": "Analisi impossibile"],
    "analyzing": ["fr": "Analyse…", "en": "Analyzing…", "es": "Analizando…", "pt": "A analisar…", "nl": "Analyseren…", "de": "Analyse…", "it": "Analisi…"],
    "goPlus": ["fr": "Passe Plus pour voir", "en": "Go Plus to see", "es": "Pasa a Plus para verlo", "pt": "Passe a Plus para ver", "nl": "Ga naar Plus om te zien", "de": "Plus holen, um zu sehen", "it": "Passa a Plus per vedere"],
    "sessionRunning": ["fr": "Session en cours", "en": "Session running", "es": "Sesión en curso", "pt": "Sessão em curso", "nl": "Sessie bezig", "de": "Sitzung läuft", "it": "Sessione in corso"],
    "tryAnother": ["fr": "Réessayez avec une autre capture", "en": "Try another screenshot", "es": "Prueba con otra captura", "pt": "Tente com outra captura", "nl": "Probeer een andere schermafbeelding", "de": "Versuch einen anderen Screenshot", "it": "Riprova con un'altra schermata"],
    "paysForItself": ["fr": "Se rembourse en une course", "en": "Pays for itself in one ride", "es": "Se paga en un solo viaje", "pt": "Paga-se numa só viagem", "nl": "Verdient zich terug in één rit", "de": "Zahlt sich in einer Fahrt aus", "it": "Si ripaga in una corsa"],
    "error": ["fr": "Erreur", "en": "Error", "es": "Error", "pt": "Erro", "nl": "Fout", "de": "Fehler", "it": "Errore"],
    "ride": ["fr": "Course", "en": "Ride", "es": "Viaje", "pt": "Viagem", "nl": "Rit", "de": "Fahrt", "it": "Corsa"],
    "earningsCaps": ["fr": "GAINS", "en": "EARNINGS", "es": "GANANCIAS", "pt": "GANHOS", "nl": "VERDIENSTEN", "de": "EINNAHMEN", "it": "GUADAGNI"],
    "perHourCaps": ["fr": "/HEURE", "en": "/HOUR", "es": "/HORA", "pt": "/HORA", "nl": "/UUR", "de": "/STUNDE", "it": "/ORA"],
    "declined": ["fr": "Refusée", "en": "Declined", "es": "Rechazada", "pt": "Recusada", "nl": "Geweigerd", "de": "Abgelehnt", "it": "Rifiutata"],
    "taken": ["fr": "Prise", "en": "Taken", "es": "Aceptada", "pt": "Aceite", "nl": "Aangenomen", "de": "Angenommen", "it": "Accettata"],
    "noSession": ["fr": "Aucune session", "en": "No session", "es": "Sin sesión", "pt": "Sem sessão", "nl": "Geen sessie", "de": "Keine Sitzung", "it": "Nessuna sessione"],
    "startSession": ["fr": "Démarrez votre session dans Strive.", "en": "Start your session in Strive.", "es": "Inicia tu sesión en Strive.", "pt": "Inicie a sua sessão no Strive.", "nl": "Start je sessie in Strive.", "de": "Starte deine Sitzung in Strive.", "it": "Avvia la tua sessione su Strive."],
    "perHour": ["fr": "Par heure", "en": "Per hour", "es": "Por hora", "pt": "Por hora", "nl": "Per uur", "de": "Pro Stunde", "it": "All'ora"],
    "earnings": ["fr": "Gains", "en": "Earnings", "es": "Ganancias", "pt": "Ganhos", "nl": "Verdiensten", "de": "Einnahmen", "it": "Guadagni"],
    "online": ["fr": "En ligne", "en": "Online", "es": "En línea", "pt": "Online", "nl": "Online", "de": "Online", "it": "Online"],
    "distance": ["fr": "Distance", "en": "Distance", "es": "Distancia", "pt": "Distância", "nl": "Afstand", "de": "Distanz", "it": "Distanza"],
    "signIn": ["fr": "Connectez-vous à Strive pour analyser vos courses.", "en": "Sign in to Strive to analyse your rides.", "es": "Inicia sesión en Strive para analizar tus viajes.", "pt": "Inicie sessão no Strive para analisar as suas viagens.", "nl": "Meld je aan bij Strive om je ritten te analyseren.", "de": "Melde dich bei Strive an, um deine Fahrten zu analysieren.", "it": "Accedi a Strive per analizzare le tue corse."],
    "scannerOff": ["fr": "Scanner désactivé — activez-le dans Strive › Préférences.", "en": "Scanner disabled — enable it in Strive › Preferences.", "es": "Escáner desactivado — actívalo en Strive › Preferencias.", "pt": "Scanner desativado — ative-o em Strive › Preferências.", "nl": "Scanner uitgeschakeld — zet hem aan in Strive › Voorkeuren.", "de": "Scanner deaktiviert — aktiviere ihn in Strive › Einstellungen.", "it": "Scanner disattivato — attivalo in Strive › Preferenze."],
    "sessionRequired": ["fr": "Session requise", "en": "Session required", "es": "Sesión necesaria", "pt": "Sessão necessária", "nl": "Sessie vereist", "de": "Sitzung erforderlich", "it": "Sessione richiesta"],
    "sessionRequiredBody": ["fr": "Veuillez démarrer votre session dans Strive pour commencer à scanner.", "en": "Please start your session in Strive to begin scanning.", "es": "Inicia tu sesión en Strive para empezar a escanear.", "pt": "Inicie a sua sessão no Strive para começar a analisar.", "nl": "Start je sessie in Strive om te beginnen met scannen.", "de": "Starte deine Sitzung in Strive, um mit dem Scannen zu beginnen.", "it": "Avvia la tua sessione su Strive per iniziare a scansionare."],
    "quotaPlus": ["fr": "Quota journalier atteint — passez à Plus pour continuer à scanner aujourd'hui.", "en": "Daily quota reached — go Plus to keep scanning today.", "es": "Cuota diaria alcanzada — pasa a Plus para seguir escaneando hoy.", "pt": "Quota diária atingida — passe a Plus para continuar hoje.", "nl": "Daglimiet bereikt — ga naar Plus om vandaag verder te scannen.", "de": "Tageslimit erreicht — hol dir Plus, um heute weiterzuscannen.", "it": "Quota giornaliera raggiunta — passa a Plus per continuare oggi."],
    "quotaTomorrow": ["fr": "Quota journalier atteint — revenez demain.", "en": "Daily quota reached — come back tomorrow.", "es": "Cuota diaria alcanzada — vuelve mañana.", "pt": "Quota diária atingida — volte amanhã.", "nl": "Daglimiet bereikt — kom morgen terug.", "de": "Tageslimit erreicht — komm morgen wieder.", "it": "Quota giornaliera raggiunta — torna domani."],
    "invalidImage": ["fr": "Image invalide — réessayez avec une capture d'écran.", "en": "Invalid image — try again with a screenshot.", "es": "Imagen no válida — inténtalo con una captura de pantalla.", "pt": "Imagem inválida — tente com uma captura de ecrã.", "nl": "Ongeldige afbeelding — probeer het met een schermafbeelding.", "de": "Ungültiges Bild — versuch es mit einem Screenshot.", "it": "Immagine non valida — riprova con un'istantanea."],
    "alreadyRunning": ["fr": "Analyse déjà en cours — patiente une seconde.", "en": "Analysis already running — hold on a second.", "es": "Análisis ya en curso — espera un segundo.", "pt": "Análise já em curso — aguarde um segundo.", "nl": "Analyse loopt al — wacht even.", "de": "Analyse läuft bereits — einen Moment.", "it": "Analisi già in corso — attendi un secondo."],
    "cardHidden": ["fr": "Carte masquée — session toujours active. Ouvrez Strive pour la réafficher.", "en": "Card hidden — session still active. Open Strive to bring it back.", "es": "Tarjeta oculta — la sesión sigue activa. Abre Strive para recuperarla.", "pt": "Cartão oculto — a sessão continua ativa. Abra o Strive para o repor.", "nl": "Kaart verborgen — sessie loopt nog. Open Strive om hem terug te halen.", "de": "Karte ausgeblendet — Sitzung läuft noch. Öffne Strive, um sie zurückzuholen.", "it": "Scheda nascosta — sessione ancora attiva. Apri Strive per ripristinarla."],
    "noOfferRetry": ["fr": "Aucune offre détectée — réessayez avec une autre capture.", "en": "No ride offer detected — try again with another screenshot.", "es": "Ninguna oferta detectada — inténtalo con otra captura.", "pt": "Nenhuma oferta detetada — tente com outra captura.", "nl": "Geen rit gevonden — probeer een andere schermafbeelding.", "de": "Kein Angebot erkannt — versuch einen anderen Screenshot.", "it": "Nessuna offerta rilevata — riprova con un'altra schermata."],
    "interrupted": ["fr": "Analyse interrompue — relancez le scan.", "en": "Analysis interrupted — run the scan again.", "es": "Análisis interrumpido — vuelve a escanear.", "pt": "Análise interrompida — volte a analisar.", "nl": "Analyse onderbroken — scan opnieuw.", "de": "Analyse abgebrochen — scanne erneut.", "it": "Analisi interrotta — riavvia la scansione."],
    "inactiveSession": ["fr": "Session inactive", "en": "Inactive session", "es": "Sesión inactiva", "pt": "Sessão inativa", "nl": "Inactieve sessie", "de": "Inaktive Sitzung", "it": "Sessione inattiva"],
    "inactiveSessionBody": ["fr": "Vous n'avez pas scanné depuis 1h. Pensez à fermer votre session.", "en": "You haven't scanned in 1 hour. Consider ending your session.", "es": "No escaneas desde hace 1 h. Piensa en cerrar tu sesión.", "pt": "Não analisa há 1 hora. Pense em fechar a sua sessão.", "nl": "Je hebt al een uur niet gescand. Denk aan het sluiten van je sessie.", "de": "Du hast seit einer Stunde nicht gescannt. Denk ans Beenden der Sitzung.", "it": "Non scansioni da 1 ora. Pensa a chiudere la sessione."],
    "analysisFailedRetry": ["fr": "Analyse impossible — réessayez.", "en": "Analysis failed — please try again.", "es": "Análisis imposible — inténtalo de nuevo.", "pt": "Análise impossível — tente novamente.", "nl": "Analyse mislukt — probeer opnieuw.", "de": "Analyse fehlgeschlagen — versuch es erneut.", "it": "Analisi impossibile — riprova."],
    "analyzingLong": ["fr": "Analyse en cours…", "en": "Analyzing…", "es": "Analizando…", "pt": "A analisar…", "nl": "Analyseren…", "de": "Analyse läuft…", "it": "Analisi in corso…"],
    "openInStrive": ["fr": "Ouvrir dans Strive", "en": "Open in Strive", "es": "Abrir en Strive", "pt": "Abrir no Strive", "nl": "Openen in Strive", "de": "In Strive öffnen", "it": "Apri in Strive"],
    "timeout": ["fr": "Analyse trop longue — vérifie ta connexion", "en": "Analysis timed out — check your connection", "es": "Análisis demasiado largo — comprueba tu conexión", "pt": "Análise demasiado longa — verifique a sua ligação", "nl": "Analyse duurt te lang — check je verbinding", "de": "Analyse dauert zu lange — prüf deine Verbindung", "it": "Analisi troppo lunga — controlla la connessione"],
    "useTheApp": ["fr": "📱  Passez par l'application\nLe scan se lance depuis Strive, avec le bouton Action ou le raccourci.", "en": "📱  Use the app\nScanning runs from Strive, via the Action button or the shortcut.", "es": "📱  Usa la aplicación\nEl escaneo se lanza desde Strive, con el botón Acción o el atajo.", "pt": "📱  Use a aplicação\nA análise arranca no Strive, com o botão Ação ou o atalho.", "nl": "📱  Gebruik de app\nScannen start vanuit Strive, via de Actieknop of de snelkoppeling.", "de": "📱  Nutze die App\nDer Scan startet in Strive, über die Aktionstaste oder den Kurzbefehl.", "it": "📱  Usa l'app\nLa scansione parte da Strive, con il tasto Azione o la scorciatoia."],
    "openStrive": ["fr": "Ouvrir Strive", "en": "Open Strive", "es": "Abrir Strive", "pt": "Abrir o Strive", "nl": "Strive openen", "de": "Strive öffnen", "it": "Apri Strive"],
    "noImage": ["fr": "Aucune image reçue", "en": "No image received", "es": "No se recibió ninguna imagen", "pt": "Nenhuma imagem recebida", "nl": "Geen afbeelding ontvangen", "de": "Kein Bild empfangen", "it": "Nessuna immagine ricevuta"],
    "errorPrefix": ["fr": "Erreur : ", "en": "Error: ", "es": "Error: ", "pt": "Erro: ", "nl": "Fout: ", "de": "Fehler: ", "it": "Errore: "],
    "unsupportedFormat": ["fr": "Format d'image non supporté", "en": "Unsupported image format", "es": "Formato de imagen no compatible", "pt": "Formato de imagem não suportado", "nl": "Niet-ondersteund afbeeldingsformaat", "de": "Nicht unterstütztes Bildformat", "it": "Formato immagine non supportato"],
    "noImageInShare": ["fr": "Aucune image trouvée dans le partage", "en": "No image found in the share", "es": "No se encontró ninguna imagen en lo compartido", "pt": "Nenhuma imagem encontrada na partilha", "nl": "Geen afbeelding gevonden in het gedeelde item", "de": "Kein Bild in der Freigabe gefunden", "it": "Nessuna immagine trovata nella condivisione"],
    "noOffer": ["fr": "Aucune offre de course détectée", "en": "No ride offer detected", "es": "Ninguna oferta de viaje detectada", "pt": "Nenhuma oferta de viagem detetada", "nl": "Geen ritaanbod gevonden", "de": "Kein Fahrtangebot erkannt", "it": "Nessuna offerta di corsa rilevata"],
    "aiAnalysis": ["fr": "Analyse IA en cours…", "en": "AI analysis in progress…", "es": "Análisis IA en curso…", "pt": "Análise IA em curso…", "nl": "AI-analyse bezig…", "de": "KI-Analyse läuft…", "it": "Analisi IA in corso…"],
    "cannotAnalyze": ["fr": "Impossible d'analyser cette image", "en": "Could not analyze this image", "es": "No se pudo analizar esta imagen", "pt": "Não foi possível analisar esta imagem", "nl": "Deze afbeelding kon niet worden geanalyseerd", "de": "Dieses Bild konnte nicht analysiert werden", "it": "Impossibile analizzare questa immagine"],
    "addressesUnreadable": ["fr": "Scan échoué — adresses illisibles, réessaie", "en": "Scan failed — addresses unreadable, try again", "es": "Escaneo fallido — direcciones ilegibles, inténtalo otra vez", "pt": "Análise falhou — moradas ilegíveis, tente outra vez", "nl": "Scan mislukt — adressen onleesbaar, probeer opnieuw", "de": "Scan fehlgeschlagen — Adressen unlesbar, versuch es erneut", "it": "Scansione fallita — indirizzi illeggibili, riprova"],
    "routing": ["fr": "Calcul de l'itinéraire…", "en": "Calculating the route…", "es": "Calculando la ruta…", "pt": "A calcular o itinerário…", "nl": "Route berekenen…", "de": "Route wird berechnet…", "it": "Calcolo dell'itinerario…"],
    "alreadyRunningShare": ["fr": "⏳  Analyse déjà en cours\nOuvrez Strive pour voir le résultat", "en": "⏳  Analysis already running\nOpen Strive to see the result", "es": "⏳  Análisis ya en curso\nAbre Strive para ver el resultado", "pt": "⏳  Análise já em curso\nAbra o Strive para ver o resultado", "nl": "⏳  Analyse loopt al\nOpen Strive om het resultaat te zien", "de": "⏳  Analyse läuft bereits\nÖffne Strive, um das Ergebnis zu sehen", "it": "⏳  Analisi già in corso\nApri Strive per vedere il risultato"],
    "scannerOffShare": ["fr": "⏸  Scanner désactivé\nActivez-le dans Strive › Préférences", "en": "⏸  Scanner disabled\nEnable it in Strive › Preferences", "es": "⏸  Escáner desactivado\nActívalo en Strive › Preferencias", "pt": "⏸  Scanner desativado\nAtive-o em Strive › Preferências", "nl": "⏸  Scanner uitgeschakeld\nZet hem aan in Strive › Voorkeuren", "de": "⏸  Scanner deaktiviert\nAktiviere ihn in Strive › Einstellungen", "it": "⏸  Scanner disattivato\nAttivalo in Strive › Preferenze"],
    "quotaShare": ["fr": "🔒  Quota journalier atteint\nReviens demain ou achète des crédits", "en": "🔒  Daily quota reached\nCome back tomorrow or buy credits", "es": "🔒  Cuota diaria alcanzada\nVuelve mañana o compra créditos", "pt": "🔒  Quota diária atingida\nVolte amanhã ou compre créditos", "nl": "🔒  Daglimiet bereikt\nKom morgen terug of koop credits", "de": "🔒  Tageslimit erreicht\nKomm morgen wieder oder kauf Credits", "it": "🔒  Quota giornaliera raggiunta\nTorna domani o compra crediti"],
  ]

  /// La langue choisie DANS Strive, réduite à son code de base (« pt-BR » →
  /// « pt »), et le français si rien n'a été choisi.
  public static var language: String {
    let gid = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    guard let raw = UserDefaults(suiteName: gid)?.string(forKey: "appLanguage")
    else { return "fr" }
    let base = raw.split(separator: "-").first.map(String.init) ?? raw
    return table["error"]?[base] != nil ? base : "fr"
  }

  public static func get(_ key: String) -> String {
    let row = table[key]
    return row?[language] ?? row?["fr"] ?? key
  }

  /// Index inversé : la PHRASE FRANÇAISE sert de clé.
  ///
  /// Les trois helpers `localizedString(fr:en:)` du scanner passent leur phrase
  /// française en clair, à côté de son point d'usage — c'est lisible, et
  /// réécrire une quarantaine de sites d'appel pour y glisser une clé aurait
  /// coûté plus cher que ça ne rapporte.
  ///
  /// Une phrase absente de la table retombe proprement sur le couple fr/en
  /// écrit sur place : ajouter un message ne casse rien, il reste simplement
  /// bilingue jusqu'à ce qu'on le traduise. Corriger une coquille côté français
  /// sans toucher la table a le même effet — dégradation, pas panne.
  private static let byFrench: [String: [String: String]] = {
    var out: [String: [String: String]] = [:]
    for (_, row) in table {
      if let fr = row["fr"] { out[fr] = row }
    }
    return out
  }()

  /// La traduction d'une phrase française, ou `nil` si elle n'est pas connue.
  public static func forFrench(_ fr: String) -> String? {
    byFrench[fr]?[language]
  }
}

/// Devise et unité de distance du chauffeur, pour tout ce que le NATIF affiche :
/// la Dynamic Island, l'écran verrouillé, les notifications, CarPlay.
///
/// Le « € » était écrit en dur à une dizaine d'endroits. Un chauffeur londonien
/// voyait donc son verdict en euros sur l'écran verrouillé alors que l'app, elle,
/// lui parlait en livres — deux monnaies pour la même course, et celle qui compte
/// au moment de décider était la fausse.
///
/// POSÉ ICI parce que ce fichier est déjà partagé entre l'app et la Widget
/// Extension : la Live Activity a besoin du symbole, et un nouveau fichier
/// demanderait de toucher au projet Xcode pour rien.
///
/// Le pays vient de l'App Group, où `ScanBridge.setMarketCountry` l'écrit. Il
/// n'est PAS mis en cache : il change quand le chauffeur corrige sa devise, et
/// un scan doit le voir tout de suite.
public enum StriveMarket {
  static var country: String {
    let gid = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"
    return UserDefaults(suiteName: gid)?.string(forKey: "marketCountry") ?? "FR"
  }

  /// « € », « CHF » ou « £ ».
  public static var symbol: String {
    switch country {
    case "GB": return "£"
    case "CH": return "CHF"
    default:   return "€"
    }
  }

  /// « km » partout, « mi » au Royaume-Uni.
  public static var distanceUnit: String { country == "GB" ? "mi" : "km" }

  /// Le scanner rend toujours des kilomètres — c'est ce que stocke
  /// `rides.distance_km`, et les bornes de plausibilité raisonnent dessus. La
  /// conversion n'a lieu qu'ici, au dernier pixel.
  public static func distance(_ km: Double) -> Double {
    country == "GB" ? km / 1.609344 : km
  }

  /// La livre se pose AVANT le nombre, l'euro et le franc après. S'y tromper
  /// suffit à faire lire le prix comme une traduction automatique, et c'est le
  /// premier chiffre que le chauffeur regarde.
  ///
  /// Espace avant « CHF » seulement : c'est un mot, et « 37CHF » se lit comme
  /// une coquille. Les glyphes, eux, restent collés — l'îlot compact et la
  /// pastille de tarif comptent leurs points de largeur.
  public static func money(_ value: Double, decimals: Int = 0) -> String {
    // `String(format:)` écrit toujours un POINT décimal, quelle que soit la
    // locale. Un chauffeur français lisait donc « 19.61€ » sur son écran
    // verrouillé et « 19,61 € » dans l'app, pour la même course. La virgule
    // suit la LANGUE, le symbole suit le MARCHÉ — les deux se choisissent
    // séparément et n'ont aucune raison de se suivre.
    let s = String(format: "%.\(decimals)f", value)
      .replacingOccurrences(of: ".", with: StriveMarket.decimalSeparator)
    if symbol == "£" { return "£" + s }
    return symbol.count > 1 ? s + " " + symbol : s + symbol
  }

  /// « , » dans six des sept langues, « . » en anglais.
  public static var decimalSeparator: String {
    StriveNativeStrings.language == "en" ? "." : ","
  }

  /// « 57€/h », « £37/h ».
  public static func perHour(_ value: Double) -> String { money(value, decimals: 0) + "/h" }

  /// Un taux « par kilomètre » ramené à l'unité du marché.
  ///
  /// Le tarif divisé par la distance donne toujours des « par kilomètre » — c'est
  /// en kilomètres que le parser rend la course, sur les six marchés. Coller
  /// « /mi » derrière sans convertir affichait donc 0,80 £/mile là où le chauffeur
  /// gagne 1,29 £/mile : un tiers de son revenu effacé par une étiquette.
  ///
  /// Un taux par mile est PLUS GRAND que le même taux par kilomètre — on parcourt
  /// plus de chemin pour le gagner. D'où la multiplication, là où une distance se
  /// divise. Affichage seulement : les seuils, eux, restent au kilomètre.
  public static func rate(_ perKm: Double) -> Double {
    country == "GB" ? perKm * 1.609344 : perKm
  }

  /// « 3.15€/km », « £3.24/mi ». Prend un taux PAR KILOMÈTRE.
  public static func perDistance(_ perKm: Double) -> String {
    money(rate(perKm), decimals: 2) + "/" + distanceUnit
  }

  /// « 5.4km », « 3.4mi ».
  public static func distanceText(_ km: Double) -> String {
    String(format: "%.1f", distance(km))
      .replacingOccurrences(of: ".", with: decimalSeparator) + distanceUnit
  }
}

/// Attributs Live Activity Strive — partagés entre l'app principale et la
/// Widget Extension (cible `StriveWidget`).
///
/// IMPORTANT (Xcode) : ce fichier DOIT avoir Target Membership coché à la fois
/// pour `Strive` et pour `StriveWidget`, sinon les vues de la Live Activity ne
/// pourront pas instancier `StriveActivityAttributes`.
@available(iOS 16.2, *)
public struct StriveActivityAttributes: ActivityAttributes {

  public typealias ContentState = State

  /// Données mutables affichées dans la Dynamic Island / Lock Screen.
  /// Mise à jour via `Activity.update(...)` quand TomTom répond après l'OCR.
  public struct State: Codable, Hashable {
    public let platform: String     // UBER, BOLT, HEETCH, SCANNING, IDLE, ERROR
    /// Dans la devise du marché — voir `StriveMarket`. Les valeurs voyagent
    /// nues : c'est l'affichage qui met le symbole.
    public let fare: Double
    public let hourlyRate: Double
    public let kmRate: Double
    public let distanceKm: Double
    public let durationMin: Int
    /// 0 = rouge (refuse), 1 = orange (limite), 2 = vert (accepte)
    public let verdictLevel: Int

    // KPI session (Lock Screen)
    public let todayEarnings: Double
    public let todayHourlyRate: Double
    public let todayKm: Double
    public let onlineMinutes: Int

    /// Identité de la course affichée — frappée au scan, portée jusqu'ici, et
    /// renvoyée telle quelle par les boutons Prise/Refusée (iOS 17+). C'est ce
    /// qui permet à un tap sur le lock screen de désigner la course sans que
    /// personne ait à la retrouver.
    ///
    /// Optionnel → décodage tolérant des activités déjà en cours lors d'une
    /// mise à jour de l'app. nil = pas de course taguable (idle / scanning /
    /// error), et donc pas de boutons.
    public let rideId: String?

    /// Epoch (s) « de référence » pour la durée de session du JOUR : posé à
    /// `débutSession - tempsEnLigneDéjàCumuléAujourdhui`. La Live Activity affiche
    /// `Text(date, style: .timer)` à partir de là → le compteur tourne SEUL sur le
    /// lock screen (aucun réveil de l'app nécessaire). nil = pas de timer.
    public let sessionStartEpoch: Double?

    public init(
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
      rideId: String? = nil,
      sessionStartEpoch: Double? = nil
    ) {
      self.platform = platform
      self.fare = fare
      self.hourlyRate = hourlyRate
      self.kmRate = kmRate
      self.distanceKm = distanceKm
      self.durationMin = durationMin
      self.verdictLevel = verdictLevel
      self.todayEarnings = todayEarnings
      self.todayHourlyRate = todayHourlyRate
      self.todayKm = todayKm
      self.onlineMinutes = onlineMinutes
      self.rideId = rideId
      self.sessionStartEpoch = sessionStartEpoch
    }
  }

  /// Données fixes pour la durée de l'activité (id de scan, démarrage…).
  public let scanId: String
  public let startedAt: Date

  public init(scanId: String = UUID().uuidString, startedAt: Date = Date()) {
    self.scanId = scanId
    self.startedAt = startedAt
  }
}

// MARK: - Boutons interactifs de la Live Activity (iOS 17+)

/// Intent déclenché par les boutons ✅/❌ de la Dynamic Island / Live Activity.
/// Écrit la décision dans l'App Group — même file que les actions de
/// notification et que les commandes vocales. L'app la lit à sa prochaine
/// synchro du Dashboard et l'écrit en base.
///
/// Défini dans CE fichier (partagé Strive + StriveWidget) pour être disponible
/// aux deux process — le bouton est rendu par le widget, l'intent s'exécute côté app.
@available(iOS 17.0, *)
struct RideDecisionIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Tag a scanned ride"
  static var isDiscoverable: Bool = false
  static var openAppWhenRun: Bool = false

  @Parameter(title: "rideId") var rideId: String
  @Parameter(title: "accepted") var accepted: Bool

  init() {}
  init(rideId: String, accepted: Bool) {
    self.rideId = rideId
    self.accepted = accepted
  }

  func perform() async throws -> some IntentResult {
    let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
      ?? "group.com.striveapp.app"

    guard !rideId.isEmpty else { return .result() }

    // 1) PERSISTANCE D'ABORD, et c'est un ordre, pas une préférence de style.
    //
    // Cet `await` peut ne jamais rendre la main : iOS lance l'app en arrière-plan
    // pour exécuter l'intent, et peut la suspendre pendant `activity.update`.
    // Tout ce qui suivait l'await disparaissait alors avec le process — la
    // décision n'était jamais écrite, le JS n'avait rien à réconcilier, et la
    // carte n'avait pas bougé non plus. Le tap ne laissait aucune trace, nulle
    // part : « des fois je clique et rien ne se passe ».
    //
    // L'écriture App Group, elle, est synchrone et tient en microsecondes. En la
    // passant devant, le pire cas devient « la carte ne bouge pas mais la course
    // est bien taguée à la réouverture », au lieu d'une décision perdue.
    appendRideDecision(rideId: rideId, accepted: accepted, appGroupId: appGroupId)

    // 2) Retour à l'état de base + incrément KPI immédiat (gains/km/€h), sans JS.
    if #available(iOS 16.2, *) {
      let add = accepted ? lastScannedFareKm(appGroupId: appGroupId) : (fare: 0.0, km: 0.0)
      await revertLiveActivityToIdle(rideId: rideId, addFare: add.fare, addKm: add.km)
    }
    return .result()
  }
}

// MARK: - Helpers partagés (boutons Live Activity + commandes vocales)

/// Tarif/distance de la DERNIÈRE course scannée, pour incrémenter les KPI de la
/// Live Activity côté natif sans attendre le JS.
///
/// Source = `lastTaggableRide`, une clé minuscule (montant + km) écrite à chaque
/// résultat et JAMAIS purgée. `lastScanResult`, elle, est supprimée par
/// `handleShareExtensionResult` quand l'app vide sa file : lire cette clé-là
/// rendait (0, 0) dès que l'app avait été ouverte une fois — donc le bouton ✅
/// n'ajoutait plus rien aux gains du jour, précisément dans le cas (app
/// suspendue) que cet incrément natif existe pour couvrir.
///
/// Le prix d'une course, tel qu'il doit s'afficher.
///
/// POURQUOI PAS `%.0f` PARTOUT. Toutes les surfaces de scan arrondissaient à
/// l'euro. Tant que le tarif est brut ça ne se voit pas — les plateformes
/// affichent des montants ronds. Mais dès que « Retirer le carburant du prix »
/// est actif, le net tombe sur des centimes : une course à 20 € avec 0,39 € de
/// carburant valait 19,61 €, que `%.0f` réaffichait… 20 €. La déduction était
/// calculée, poussée, reçue — et effacée au dernier pixel. Le chauffeur ne
/// pouvait qu'en conclure que l'option ne marchait pas.
///
/// L'euro rond reste affiché rond : la précision n'apparaît que lorsqu'elle
/// porte une information.
public func striveFareText(_ fare: Double) -> String {
  let rounded = (fare * 100).rounded() / 100
  return rounded == rounded.rounded()
    ? StriveMarket.money(rounded, decimals: 0)
    : StriveMarket.money(rounded, decimals: 2)
}

/// Le montant porté est le tarif AFFICHÉ (net de carburant si l'option est
/// active), cohérent avec ce que la carte montre — `lastScanResult.fare` est
/// brut et faisait monter les gains en brut sous un affichage net.
func lastScannedFareKm(appGroupId: String) -> (fare: Double, km: Double) {
  // (la clé porte aussi `rideId`, lu séparément par `tagLastScannedRide`)
  guard let defaults = UserDefaults(suiteName: appGroupId) else { return (0, 0) }
  if let entry = defaults.dictionary(forKey: "lastTaggableRide") {
    let fare = (entry["fare"] as? NSNumber)?.doubleValue ?? 0
    let km = (entry["km"] as? NSNumber)?.doubleValue ?? 0
    return (fare, km)
  }
  // Repli : résultat écrit par un build antérieur, encore en attente de relève.
  guard let data = defaults.data(forKey: "lastScanResult"),
        let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return (0, 0) }
  let fare = (body["displayFare"] as? NSNumber)?.doubleValue
    ?? (body["fare"] as? NSNumber)?.doubleValue ?? 0
  let km = (body["distanceKm"] as? NSNumber)?.doubleValue ?? 0
  return (fare, km)
}

/// Recopie les KPI de session dans l'App Group (`laSessionSnapshot`).
///
/// C'est la SEULE copie qui survit à la mort de la carte : quand iOS la retire
/// alors que la session continue, `LiveActivityManager.ensureRunning()` la recrée
/// à partir de là. Une mise à jour qui ne passe pas par ici est donc oubliée dès
/// que la carte disparaît — c'était le cas du bouton ✅, qui incrémentait les
/// gains à l'écran et les laissait revenir à leur valeur d'avant.
///
/// DUPLIQUE délibérément `LiveActivityManager.saveSessionSnapshot`, qui garde sa
/// version privée : ce fichier tourne aussi dans des contextes où le manager n'est
/// pas compilé, et le manager doit rester identique à sa version de référence.
/// Les deux écrivent la MÊME clé et la même forme — à tenir en phase.
@available(iOS 16.2, *)
func saveLiveActivitySessionSnapshot(_ s: StriveActivityAttributes.ContentState) {
  let appGroupId = (Bundle.main.object(forInfoDictionaryKey: "StriveAppGroupId") as? String)
    ?? "group.com.striveapp.app"
  guard let d = UserDefaults(suiteName: appGroupId) else { return }
  var snap: [String: Any] = [
    "todayEarnings": s.todayEarnings,
    "todayHourlyRate": s.todayHourlyRate,
    "todayKm": s.todayKm,
    "onlineMinutes": s.onlineMinutes,
  ]
  if let start = s.sessionStartEpoch { snap["sessionStartEpoch"] = start }
  d.set(snap, forKey: "laSessionSnapshot")
  // Signale à `LiveActivityManager` qu'une écriture lui a échappé.
  //
  // Le manager mémorise son dernier état poussé pour ne pas dépendre du délai de
  // retour d'ActivityKit (`freshestState`). Mais CE chemin-ci — les boutons
  // ✅/❌ de la carte — repasse à l'idle sans passer par lui : sans ce repère,
  // une poussée KPI arrivant juste après un tap ressuscitait le verdict que le
  // chauffeur venait de trancher. Un tap dans les secondes qui suivent
  // l'affichage du résultat, c'est le cas NORMAL, pas un cas limite.
  d.set(Date().timeIntervalSince1970, forKey: "laForeignWriteAt")
}

/// Empile la décision Accepter/Refuser dans l'App Group. Rien d'autre : l'app
/// vient la chercher (`getPendingRideDecisions`) au moment où elle peut l'écrire
/// en base, et l'acquitte alors. Supabase reste la source de vérité et corrige
/// l'optimiste natif affiché sur la carte.
func appendRideDecision(rideId: String, accepted: Bool, appGroupId: String) {
  guard !rideId.isEmpty, let defaults = UserDefaults(suiteName: appGroupId) else { return }
  var arr: [[String: Any]] = []
  if let data = defaults.data(forKey: "pendingRideDecisions"),
     let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    arr = existing
  }
  // Une seule décision par course, la dernière : deux taps successifs sur la
  // même carte ne doivent pas laisser deux entrées à appliquer dans l'ordre où
  // elles sortent de la file.
  arr.removeAll { ($0["rideId"] as? String) == rideId }
  arr.append(["rideId": rideId, "status": accepted ? "ACCEPTED" : "DECLINED"])
  if let data = try? JSONSerialization.data(withJSONObject: arr) {
    defaults.set(data, forKey: "pendingRideDecisions")
  }
}

/// Repasse la Live Activity à l'état de base (résumé de session) en ajoutant
/// éventuellement une course acceptée aux KPI du jour. €/h recalculé via le timer
/// (`sessionStartEpoch`). Met la carte à jour IMMÉDIATEMENT, app fermée incluse —
/// le petit dashboard du lock screen devient live sans réouverture de l'app.
@available(iOS 16.2, *)
func revertLiveActivityToIdle(rideId: String, addFare: Double, addKm: Double) async {
  for activity in Activity<StriveActivityAttributes>.activities {
    let prev = activity.content.state
    // On n'écarte QUE ce que la garde doit protéger : une AUTRE offre, qui a
    // déjà remplacé l'affichage et ne doit pas être effacée par une décision
    // portant sur la précédente. La carte n'en montre qu'une à la fois, et la
    // plus récente écrase toujours celle d'avant — un id différent est donc
    // exactement « une offre plus récente ».
    //
    // Une carte sans `rideId` (idle, ou état pas encore synchronisé quand iOS
    // lance l'app en arrière-plan pour cet intent) n'a rien à protéger : on
    // passe. C'était le cas qui laissait la carte figée sur son verdict alors
    // que la décision partait bien vers le JS — « des fois ça met à jour, des
    // fois non ».
    //
    // Ce qui a disparu avec `scanTs` : une comparaison de `Double` à 17
    // chiffres significatifs, tolérante à la milliseconde parce que la valeur
    // se faisait rogner par les encodages successifs (paramètres d'AppIntent,
    // JSON App Group, `userInfo` de notification). Une chaîne traverse tout
    // sans perte.
    if let prevId = prev.rideId, prevId != rideId {
      continue
    }
    let newEarnings = prev.todayEarnings + addFare
    let newKm = prev.todayKm + addKm
    var newRate = prev.todayHourlyRate
    if let epoch = prev.sessionStartEpoch {
      let hours = (Date().timeIntervalSince1970 - epoch) / 3600.0
      if hours > 0.0003 { newRate = newEarnings / hours }   // > ~1 s en ligne
    }
    let idle = StriveActivityAttributes.ContentState(
      platform: "IDLE",
      todayEarnings: newEarnings,
      todayHourlyRate: newRate,
      todayKm: newKm,
      onlineMinutes: prev.onlineMinutes,
      sessionStartEpoch: prev.sessionStartEpoch
    )
    // AVANT l'await, comme l'écriture de la décision dans `RideDecisionIntent` :
    // ce process peut être suspendu pendant `activity.update`, et tout ce qui
    // suit l'await disparaît alors avec lui. Écrire dans l'App Group est
    // synchrone et tient en microsecondes.
    saveLiveActivitySessionSnapshot(idle)
    await activity.update(
      ActivityContent(state: idle, staleDate: Date().addingTimeInterval(3600 * 8), relevanceScore: 50)
    )
  }
}

package com.strive.scanner

import android.graphics.Bitmap
import android.util.Log
import com.google.mlkit.vision.text.Text
import com.strive.BuildConfig
import org.json.JSONArray
import org.json.JSONObject

object OcrParser {

    data class ScanResult(
        val platform: Platform,
        val fare: Double,
        val distanceKm: Double,
        val durationMin: Int? = null,          // null si non détecté → estimé côté RN
        val pickupAddress: String? = null,      // adresse prise en charge
        val destinationAddress: String? = null, // adresse destination
        val pickupDurationMin: Int? = null,     // temps d'approche — ligne "X min • X.X km"
        val pickupDistanceKm: Double? = null,   // distance d'approche
    )

    enum class Platform { UBER, BOLT, HEETCH, UNKNOWN }

    // ─── Remote config (valeurs par défaut — patchables via Supabase sans republier) ───

    private var priceAnchors = mutableMapOf(
        Platform.UBER   to listOf("total", "fare", "trip fare", "estimated fare", "gain", "net"),
        Platform.BOLT   to listOf("gain", "earning", "revenu", "estimé", "total", "net"),
        Platform.HEETCH to listOf("course", "tarif", "prix", "total", "net"),
        Platform.UNKNOWN to listOf("total", "gain", "fare", "tarif", "net"),
    )

    private var distanceAnchors = listOf("km", "kilomètre", "distance", "away")

    private var fareMin = 5.0
    private var fareMax = 200.0
    private var distMin = 0.3
    private var distMax = 500.0
    private var rateMin = 0.4
    private var rateMax = 12.0

    /**
     * Applique la remote config reçue depuis Supabase.
     * Format JSON attendu :
     * {
     *   "priceAnchors": { "UBER": [...], "BOLT": [...], "HEETCH": [...] },
     *   "distanceAnchors": [...],
     *   "sanity": { "fareMin": 3.0, "fareMax": 200.0, "distMin": 0.3, "distMax": 1000.0, "rateMin": 0.4, "rateMax": 12.0 }
     * }
     */
    fun updateConfig(configJson: String) {
        try {
            val root = JSONObject(configJson)

            root.optJSONObject("priceAnchors")?.let { anchors ->
                for (key in listOf("UBER", "BOLT", "HEETCH", "UNKNOWN")) {
                    val platform = try { Platform.valueOf(key) } catch (e: Exception) { continue }
                    val arr = anchors.optJSONArray(key) ?: continue
                    val list = (0 until arr.length()).map { arr.getString(it).lowercase() }
                    priceAnchors[platform] = list
                }
            }

            root.optJSONArray("distanceAnchors")?.let { arr ->
                distanceAnchors = (0 until arr.length()).map { arr.getString(it).lowercase() }
            }

            root.optJSONObject("sanity")?.let { s ->
                if (s.has("fareMin")) fareMin = s.getDouble("fareMin")
                if (s.has("fareMax")) fareMax = s.getDouble("fareMax")
                if (s.has("distMin")) distMin = s.getDouble("distMin")
                if (s.has("distMax")) distMax = s.getDouble("distMax")
                if (s.has("rateMin")) rateMin = s.getDouble("rateMin")
                if (s.has("rateMax")) rateMax = s.getDouble("rateMax")
            }
        } catch (e: Exception) {
            // Garde les valeurs par défaut si le JSON est invalide
        }
    }

    private val platformKeywords = mapOf(
        Platform.UBER   to listOf("uber"),
        Platform.BOLT   to listOf("bolt"),
        Platform.HEETCH to listOf("heetch"),
    )

    /**
     * Heuristique légère : le texte OCR ressemble-t-il à une offre VTC ?
     * Permet de court-circuiter le fallback Gemini (coût) quand l'utilisateur
     * scanne une pub / un écran quelconque. Bilingue FR + EN.
     * Mirror de `ScanProcessor.looksLikeRideOffer` (iOS).
     * Permissive volontairement : un faux positif coûte 1 appel Gemini, un faux
     * négatif fait rater une course → on privilégie de laisser passer.
     */
    fun looksLikeRideOffer(rawText: String): Boolean {
        val text = rawText.lowercase()
        val hasPlatform = text.contains("uber") || text.contains("bolt") || text.contains("heetch")
        val hasRideWords = listOf(
            // FR
            "course", "trajet", "prise en charge", "dépose", "gains", "accepter", "min de marche",
            // EN
            "trip", "ride", "pickup", "pick-up", "drop-off", "dropoff", "earnings", "accept", "min walk",
        ).any { text.contains(it) }
        val hasPrice = Regex("""\d{1,3}[.,]\d{2}\s*€""").containsMatchIn(text)
            || Regex("""€\s*\d""").containsMatchIn(text)
        val hasKm = Regex("""\d[\d.,]*\s*km""").containsMatchIn(text)
        val hasMin = Regex("""\d+\s*min""").containsMatchIn(text)
        return hasPlatform || hasRideWords || (hasPrice && (hasKm || hasMin))
    }

    // Mots-clés de voie à matcher comme MOT ENTIER (FR, EN, ES, IT, NL, PT) + POIs
    private val addressStreetKeywords = listOf(
        // FR
        "rue", "avenue", "av.", "boulevard", "blvd", "bd", "bd.",
        "place", "pl.", "impasse", "imp.", "allée", "allee", "all.",
        "chemin", "ch.", "route", "rte", "rte.", "passage",
        "quai", "villa", "cité", "cite", "esplanade", "cours",
        "faubourg", "fg.", "voie", "sq.", "square",
        // EN
        "street", "road", "lane", "drive", "st.", "rd.", "ave.", "way",
        // ES
        "calle", "avenida", "plaza", "paseo", "carretera", "camino", "ronda",
        // IT
        "via", "viale", "corso", "piazza", "strada", "vicolo", "largo",
        // NL
        "straat", "laan", "plein", "gracht",
        // PT
        "travessa", "rua",
        // POIs VTC — FR/EN + traductions EU
        "gare", "aéroport", "aeroport", "airport", "terminal",
        "porte", "hôpital", "hopital", "hospital", "station",
        "bahnhof", "hauptbahnhof", "flughafen", "krankenhaus",
        "estación", "estacion", "aeropuerto",
        "stazione", "aeroporto", "ospedale",
    )
    // Suffixes de rue allemands : peuvent former des mots composés (Hauptstraße).
    // Matchés en fin de mot (pas de word-boundary à gauche).
    private val addressStreetSuffixes = listOf(
        "straße", "strasse", "str.", "gasse", "weg", "allee", "platz",
        "damm", "ufer", "ring",
    )
    private val nonAddressWords = setOf(
        "uber", "bolt", "heetch", "total", "fare", "gain", "tarif",
        "accepted", "accepté", "min", "km", "estimated", "estimé",
    )

    // Regex : tolèrent des espaces internes autour du séparateur (OCR fantaisiste).
    private val PRICE_REGEX = Regex("""(\d{1,3})\s*[.,]\s*(\d{2})(?!\d)""")
    // Tarif sans séparateur ("1743€" ou "17 €"). Min 2 chiffres : un "5€" sec
    // n'est jamais un tarif — contrat fixtures/ocr/fare-ocr.json (aligné TS/Swift).
    private val PRICE_GLUED_REGEX = Regex("""(\d{2,6})\s*€""")
    // Note de l'app ("★ 5,00", "* 5,00") à retirer avant de chercher un tarif.
    private val RATING_SEGMENT_REGEX = Regex("""[★⭐✩✪✯*]\s*\d{1,2}\s*[.,]\s*\d{1,2}""")
    private val DISTANCE_REGEX = Regex("""(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km""", RegexOption.IGNORE_CASE)
    private val DURATION_REGEX = Regex("""(\d{1,3})\s*min""", RegexOption.IGNORE_CASE)
    // Ligne combinée pickup : "4 min • 1,2 km" ou "1,2 km • 4 min"
    private val PICKUP_COMBO_MIN_FIRST = Regex("""(\d{1,3})\s*min[^0-9a-zà-ü]{0,6}(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km""", RegexOption.IGNORE_CASE)
    private val PICKUP_COMBO_KM_FIRST  = Regex("""(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km[^0-9a-zà-ü]{0,6}(\d{1,3})\s*min""", RegexOption.IGNORE_CASE)

    /** Supprime tous les espaces internes et remplace virgule par point — prêt pour toDouble(). */
    private fun cleanNum(raw: String) = raw.replace("\\s+".toRegex(), "").replace(',', '.')

    /**
     * Corrige les confusions classiques OCR chiffre↔lettre UNIQUEMENT en contexte
     * numérique (entre deux chiffres, ou entre chiffre et séparateur décimal).
     * Cible réelle observée : "1l.8 km" (ML Kit lit le 1 comme un L minuscule).
     * Safe pour les adresses : "Libération" n'a pas de digit adjacent à son "l".
     */
    private fun normalizeOcrDigits(s: String): String {
        // Cas ciblés :
        //   "ll.8", "1l.8", "l1.8"  → "11.8"  (run de l/I avant ".X")
        //   "11.l8", "1.l"          → "11.18", "1.1" (run de l/I après "X.")
        //   "1l8", "1o8"            → "118", "108"   (lettre isolée entre chiffres)
        // Les runs l/I/o/O à côté de lettres (ex: "Libération") ne matchent pas
        // grâce aux lookbehind/lookahead `(?<![a-zA-Zà-ü])`.
        return s
            // Runs l/I avant ".X" ou avant un nombre décimal "X.Y"
            .replace(Regex("""(?<![a-zA-Zà-ü])[lI]+(?=[.,]\d)""")) { "1".repeat(it.value.length) }
            .replace(Regex("""(?<![a-zA-Zà-ü])[lI]+(?=\d[.,]\d)""")) { "1".repeat(it.value.length) }
            // Runs l/I après "X." (partie décimale)
            .replace(Regex("""(?<=\d[.,])[lI]+(?![a-zA-Zà-ü])""")) { "1".repeat(it.value.length) }
            // Lettre isolée entre chiffres
            .replace(Regex("""(?<=\d)[lI](?=\d)"""), "1")
            // Idem O/o
            .replace(Regex("""(?<![a-zA-Zà-ü])[oO]+(?=[.,]\d)""")) { "0".repeat(it.value.length) }
            .replace(Regex("""(?<![a-zA-Zà-ü])[oO]+(?=\d[.,]\d)""")) { "0".repeat(it.value.length) }
            .replace(Regex("""(?<=\d[.,])[oO]+(?![a-zA-Zà-ü])""")) { "0".repeat(it.value.length) }
            .replace(Regex("""(?<=\d)[oO](?=\d)"""), "0")
    }

    // ─── Sanity bounds (voir les vars mutables dans remote config) ───────────────

    // ─── Entry point ─────────────────────────────────────────────────────────────

    fun parse(visionText: Text, screenWidth: Int, screenHeight: Int, bitmap: Bitmap? = null): ScanResult? {
        val blocks = visionText.textBlocks
        if (blocks.isEmpty()) return null

        val fullText = blocks.joinToString(" ") { it.text }.lowercase()
        // Détection texte d'abord (marque → tournures → mode), indépendante du
        // dark/light mode. En dernier recours : couleur du BOUTON d'action (bas
        // de l'écran), pas la carte → vert = Bolt, bleu = Uber.
        var platform = detectPlatform(fullText)
        if (platform == Platform.UNKNOWN && bitmap != null) {
            platform = detectPlatformByButtonColor(bitmap)
        }

        val fare = extractFare(blocks, platform, screenHeight) ?: return null
        val fareBlockY = locateFareBlockY(blocks, fare)

        // Invariant layout VTC : 1ʳᵉ adresse = pickup, 2ᵉ = destination. On s'en
        // sert pour catégoriser les km/min par zone verticale.
        if (BuildConfig.DEBUG) {
            Log.d("StriveScan", "──── OCR blocks (${blocks.size}) ────")
            blocks.sortedBy { it.boundingBox?.top ?: 0 }.forEach {
                Log.d("StriveScan", "  y=${it.boundingBox?.top} | ${it.text.replace("\n", " ⏎ ")}")
            }
            Log.d("StriveScan", "platform=$platform fare=$fare fareY=$fareBlockY")
        }

        val addressBlocks = findAddressBlocks(blocks, screenHeight, fareBlockY)
        val pickupAddrBlock = addressBlocks.getOrNull(0)
        val destAddrBlock = addressBlocks.getOrNull(1)

        if (BuildConfig.DEBUG) {
            Log.d("StriveScan", "ADRESSES retenues (${addressBlocks.size}):")
            addressBlocks.forEachIndexed { i, b -> Log.d("StriveScan", "  [$i] ${b.text.replace("\n", " ⏎ ")}") }
        }

        val distance = extractDistance(blocks, pickupAddrBlock, destAddrBlock) ?: return null
        val duration = extractDuration(blocks, pickupAddrBlock, destAddrBlock, distance)

        if (!isSane(fare, distance)) return null

        val pickup = extractPickupInfo(blocks, distance)

        return ScanResult(
            platform = platform,
            fare = fare,
            distanceKm = distance,
            durationMin = duration,
            pickupAddress = pickupAddrBlock?.let { mergeAddressContinuation(it, blocks, screenHeight) },
            destinationAddress = destAddrBlock?.let { mergeAddressContinuation(it, blocks, screenHeight) },
            pickupDurationMin = pickup?.first,
            pickupDistanceKm = pickup?.second,
        )
    }

    /**
     * ML Kit splitte parfois une adresse longue en 2 blocs (ex: "1 Allee Des
     * Bordes, Chennevières-sur-" + "Marne, 94430 France"). On merge si un bloc
     * court est juste en-dessous, aligné horizontalement, et ne ressemble pas à
     * une nouvelle adresse ni à une ligne de stats.
     */
    /**
     * Vrai si `tail` est la fin coupée de l'adresse `head` juste au-dessus :
     * collée verticalement (≤ 1 ligne), alignée horizontalement, et SANS mot de
     * voie ni numéro de rue en tête (sinon c'est une nouvelle adresse, pas une
     * continuation). Ex: head="…Chennevières-sur-", tail="Marne 94430".
     */
    private fun isContinuationLine(head: Text.TextBlock, tail: Text.TextBlock): Boolean {
        val hb = head.boundingBox ?: return false
        val tb = tail.boundingBox ?: return false
        if (tb.top <= hb.top) return false
        if (tb.top - hb.bottom > hb.height()) return false
        val xOverlap = minOf(hb.right, tb.right) - maxOf(hb.left, tb.left)
        val minWidth = minOf(hb.width(), tb.width())
        if (xOverlap < minWidth * 0.5) return false
        val t = tail.text.trim()
        if (t.isEmpty() || t.length > 60) return false
        if (Regex("""\d\s*(?:km|min)\b""", RegexOption.IGNORE_CASE).containsMatchIn(t)) return false
        if (Regex("""^\d{1,4}\s+[A-Za-zà-üÀ-Ü]""").containsMatchIn(t)) return false
        // Un mot de voie ⇒ nouvelle rue, pas une continuation.
        val hasStreetKw = addressStreetKeywords.any { kw ->
            Regex("""(?<![a-zà-üß])${Regex.escape(kw)}(?![a-zà-üß])""", RegexOption.IGNORE_CASE).containsMatchIn(t)
        }
        if (hasStreetKw) return false
        return true
    }

    private fun mergeAddressContinuation(
        addrBlock: Text.TextBlock,
        allBlocks: List<Text.TextBlock>,
        screenHeight: Int,
    ): String {
        var result = cleanAddressText(addrBlock.text).trim()
        if (addrBlock.boundingBox == null) return result
        var current = addrBlock
        val used = mutableListOf(current)
        // Une adresse peut être coupée sur plusieurs lignes → on enchaîne les
        // continuations (max 3) tant qu'on en trouve une sous la précédente.
        repeat(3) {
            val cont = allBlocks.firstOrNull { c -> used.none { it === c } && isContinuationLine(current, c) }
                ?: return result
            val contText = cleanAddressText(cont.text).trim()
            // Tiret en fin de ligne OU en début de la suite (mot coupé) → collage
            // direct ; sinon espace de mot (newline, converti en espace pour TomTom).
            result = if (result.endsWith('-') || contText.startsWith('-')) "$result$contText"
                     else "$result\n$contText"
            used.add(cont)
            current = cont
        }
        return result
    }

    /**
     * Trouve le centerY du bloc qui contient le prix extrait — utilisé comme
     * ancre pour délimiter le card-trip (où se trouvent les vraies adresses)
     * et exclure les labels de fond de carte (Heetch, Bolt).
     */
    private fun locateFareBlockY(blocks: List<Text.TextBlock>, fare: Double): Int? {
        val euros = fare.toInt()
        val cents = ((fare - euros) * 100).toInt()
        val patterns = listOf(
            "$euros,${"%02d".format(cents)}",
            "$euros.${"%02d".format(cents)}",
        )
        blocks.firstOrNull { b ->
            patterns.any { p -> b.text.contains(p) }
        }?.boundingBox?.centerY()?.let { return it }
        // Repli : tarif collé sans virgule ("1743€") — on exige le € pour ne pas
        // matcher un code postal ou une heure qui contiendrait la même suite.
        val glued = "$euros${"%02d".format(cents)}"
        return blocks.firstOrNull { it.text.contains(glued) && it.text.contains("€") }
            ?.boundingBox?.centerY()
    }

    // ─── Platform detection ───────────────────────────────────────────────────────

    // Catégories de course propres à UNE seule plateforme — secours quand le nom
    // de marque n'est pas capturé (logo en image, header cropé). Les modes
    // AMBIGUS (Confort/Comfort, Green, XL, Pet, Premium…) existent chez Uber ET
    // Bolt → volontairement exclus, on laisse la détection couleur trancher.
    // Matchés en MOT ENTIER pour éviter les faux positifs (ex: "berline" dans une
    // adresse, "van" dans "Vanves").
    private val uberOnlyModes = listOf("uberx", "uberxl", "uberpool", "berline", "comfort electric", "share")
    private val boltOnlyModes = listOf("bolt xl", "bolt comfort", "bolt premium", "bolt plus")

    // Tournures de texte propres à une plateforme — secours quand la marque n'est
    // pas capturée (ex: Uber dark mode affiche "Share · Exclusivité · Montant net
    // de frais" SANS le mot "Uber" → était classé UNKNOWN). Validé sur captures réelles.
    // FR + EN (les apps VTC peuvent être dans les 2 langues).
    private val uberPhrases = listOf(
        "exclusivité", "exclusivite", "montant net", "net de frais",  // FR
        "exclusive", "net fare", "net earnings",                       // EN
    )
    private val heetchPhrases = listOf("proposer", "€ brut", "propose", "gross")
    private val boltPhrases = listOf("net, ttc", "net,ttc", "incl. vat", "net, incl")

    private fun containsWord(text: String, word: String): Boolean =
        Regex("""(?<![a-zà-üß0-9])${Regex.escape(word)}(?![a-zà-üß0-9])""").containsMatchIn(text)

    private fun detectPlatform(fullText: String): Platform {
        // 1. Nom de marque explicite (signal fort).
        if (fullText.contains("heetch")) return Platform.HEETCH
        if (fullText.contains("uber")) return Platform.UBER
        if (fullText.contains("bolt")) return Platform.BOLT
        // 2. Tournures de texte propres à une plateforme.
        val uberP = uberPhrases.any { fullText.contains(it) }
        val heetchP = heetchPhrases.any { fullText.contains(it) }
        val boltP = boltPhrases.any { fullText.contains(it) }
        if (uberP && !heetchP && !boltP) return Platform.UBER
        if (heetchP && !uberP && !boltP) return Platform.HEETCH
        if (boltP && !uberP && !heetchP) return Platform.BOLT
        // 3. Catégorie de course propre à une plateforme (mot entier).
        val uberHint = uberOnlyModes.any { containsWord(fullText, it) }
        val boltHint = boltOnlyModes.any { containsWord(fullText, it) }
        if (uberHint && !boltHint) return Platform.UBER
        if (boltHint && !uberHint) return Platform.BOLT
        return Platform.UNKNOWN
    }

    /**
     * Différencie Uber/Bolt via la couleur du BOUTON d'action (bas de l'écran) —
     * PAS la carte (qui suit le thème + parcs verts / eau bleue trompeurs).
     *   bouton VERT  → Bolt
     *   bouton BLEU  → Uber  (Heetch a aussi un bouton bleu mais est déjà capté
     *                          par le texte "Heetch"/"Proposer"/"brut").
     * Échantillonne la bande basse (86-99% de la hauteur) = zone du bouton.
     */
    private fun detectPlatformByButtonColor(bitmap: Bitmap): Platform {
        val w = bitmap.width
        val h = bitmap.height
        if (w <= 0 || h <= 0) return Platform.UNKNOWN
        val yStart = (h * 0.86).toInt().coerceIn(0, h - 1)
        val bandH = (h * 0.13).toInt().coerceIn(1, h - yStart)
        val pixels = IntArray(w * bandH)
        bitmap.getPixels(pixels, 0, w, 0, yStart, w, bandH)

        var green = 0
        var blue = 0
        for (px in pixels) {
            val r = (px shr 16) and 0xFF
            val g = (px shr 8) and 0xFF
            val b = px and 0xFF
            if (g > 120 && g > r + 25 && g > b + 10) green++
            else if (b > 110 && b > r + 25 && b > g + 5) blue++
        }
        val total = pixels.size.coerceAtLeast(1)
        if (green > total * 0.12) return Platform.BOLT
        if (blue > total * 0.12) return Platform.UBER
        return Platform.UNKNOWN
    }

    // ─── Fare extraction — scoring sémantique ────────────────────────────────────

    private fun extractFare(
        blocks: List<Text.TextBlock>,
        platform: Platform,
        screenHeight: Int,
    ): Double? {
        data class Candidate(val value: Double, val score: Float)

        val anchors = priceAnchors[platform] ?: priceAnchors[Platform.UNKNOWN]!!
        val candidates = mutableListOf<Candidate>()

        blocks.forEachIndexed { idx, block ->
            val normalizedText = normalizeOcrDigits(block.text)
            if (Regex("""proposer""", RegexOption.IGNORE_CASE).containsMatchIn(normalizedText)) return@forEachIndexed
            val blockLower = block.text.lowercase()
            if (blockLower.contains("★") || blockLower.contains("⭐") || blockLower.contains("star")
                || blockLower.contains("étoile") || blockLower.contains("etoile")
                || blockLower.contains("rating") || blockLower.contains("note")) return@forEachIndexed

            // Retire le segment note ("* 5,00") : un nombre précédé d'une étoile/
            // astérisque n'est jamais un tarif (cas "* 5,00 Montant net de frais"
            // collé sous le prix — aligné TS/Swift).
            val deRated = normalizedText.replace(RATING_SEGMENT_REGEX, " ")

            val match = PRICE_REGEX.find(deRated)
            val value: Double = if (match != null) {
                val intPart = match.groupValues[1].replace("\\s+".toRegex(), "")
                val decPart = match.groupValues[2].replace("\\s+".toRegex(), "")
                "$intPart.$decPart".toDoubleOrNull() ?: return@forEachIndexed
            } else {
                // Tarif "collé" à l'euro, virgule perdue par l'OCR ("17,43 €" →
                // "1743€"). Les apps VTC affichent toujours 2 décimales : au-delà
                // du plafond plausible, les 2 derniers chiffres sont des centimes.
                val glued = PRICE_GLUED_REGEX.find(deRated) ?: return@forEachIndexed
                val raw = glued.groupValues[1].toDoubleOrNull() ?: return@forEachIndexed
                if (raw > fareMax) raw / 100 else raw
            }

            if (value !in fareMin..fareMax) return@forEachIndexed

            var score = 0f
            val box = block.boundingBox

            if (box != null) {
                score += box.height().toFloat() * 1.5f
                val centerY = (box.top + box.bottom) / 2f
                if (centerY < screenHeight * 0.55f) score += 30f
            }

            if (anchors.any { blockLower.contains(it) }) score += 25f

            if (idx > 0 && anchors.any { blocks[idx - 1].text.lowercase().contains(it) }) {
                score += 35f
            }

            if (idx < blocks.size - 1 && anchors.any { blocks[idx + 1].text.lowercase().contains(it) }) {
                score += 20f
            }

            if (value in 1.0..5.0) score -= 40f

            candidates.add(Candidate(value, score))
        }

        return candidates.maxByOrNull { it.score }?.value
    }

    /**
     * ML Kit fragmente parfois un décimal en deux blocs autour du point.
     * Deux cas : ponctuation conservée ("Course de 11." + "8 km") ou point
     * carrément perdu par l'OCR ("Course de 11" + "8 km"). On cherche un
     * bloc voisin à gauche sur la même ligne et on tente de recoller.
     *
     * Le fallback permissif (sans point) ne se déclenche que si rawInt est un
     * seul chiffre ("8 km") — signature quasi certaine d'une fragmentation
     * puisqu'une vraie course ≤ 9 km entière est relativement rare et que
     * les combos pickup sont déjà filtrés par `isPickupCombo`.
     */
    private fun tryStitchFragmentedDistance(
        blocks: List<Text.TextBlock>,
        current: Text.TextBlock,
        rawInt: String,
    ): Double? {
        val box = current.boundingBox ?: return null
        val curCenterY = box.centerY()
        val curLeft = box.left
        val curHeight = box.height()
        val cleanedRaw = rawInt.replace("\\s+".toRegex(), "")

        for (other in blocks) {
            if (other === current) continue
            val ob = other.boundingBox ?: continue
            val rowTol = Math.max(ob.height(), curHeight) * 1.5f
            if (Math.abs(ob.centerY() - curCenterY) > rowTol) continue
            // À gauche du bloc courant (avec marge de 20px)
            if (ob.right > curLeft + 20) continue

            // 1. Strict : le voisin finit par "NN." ou "NN,"
            val strictMatch = Regex("""(\d{1,3})\s*[.,]\s*$""").find(other.text)
            if (strictMatch != null) {
                val stitched = "${strictMatch.groupValues[1]}.$cleanedRaw".toDoubleOrNull()
                if (stitched != null && stitched in distMin..distMax) return stitched
            }

            // 2. Permissif : le voisin finit par "NN" (point perdu par OCR).
            //    Only for single-digit raw ("8 km") to éviter les faux positifs.
            if (cleanedRaw.length == 1) {
                val looseMatch = Regex("""(\d{1,3})\s*$""").find(other.text)
                if (looseMatch != null) {
                    val stitched = "${looseMatch.groupValues[1]}.$cleanedRaw".toDoubleOrNull()
                    if (stitched != null && stitched in distMin..distMax) return stitched
                }
            }
        }
        return null
    }

    /**
     * Recollage intra-bloc : si ML Kit garde les deux chiffres dans le même bloc
     * mais a perdu le point, on recherche un pattern "X Y km" (séparateur uniquement
     * whitespace) dans le texte du bloc courant. "Course de 11 8 km" → 11.8.
     *
     * Contrainte : Y doit correspondre au rawInt déjà extrait par DISTANCE_REGEX —
     * évite de matcher du bruit loin dans le bloc. Les combos pickup contenant "min"
     * sont filtrés ailleurs, pas besoin de s'en soucier ici.
     */
    private fun tryIntraBlockStitch(blockText: String, rawInt: String): Double? {
        val cleanedRaw = rawInt.replace("\\s+".toRegex(), "")
        val regex = Regex("""(\d{1,3})\s+(\d{1,2})\s*km""", RegexOption.IGNORE_CASE)
        for (m in regex.findAll(blockText)) {
            val a = m.groupValues[1]
            val b = m.groupValues[2].replace("\\s+".toRegex(), "")
            if (b != cleanedRaw) continue
            val stitched = "$a.$b".toDoubleOrNull() ?: continue
            if (stitched in distMin..distMax) return stitched
        }
        return null
    }

    /**
     * Sérialise tous les blocs ML Kit (texte + bounding box) en JSON — utilisé
     * pour diagnostic. Consommé côté JS via `debugBlocks` dans onScanResult.
     */
    fun dumpBlocks(visionText: Text): String {
        val arr = JSONArray()
        for (block in visionText.textBlocks) {
            val bb = block.boundingBox
            val obj = JSONObject().apply {
                put("text", block.text)
                if (bb != null) {
                    put("x", bb.left)
                    put("y", bb.top)
                    put("w", bb.width())
                    put("h", bb.height())
                }
            }
            arr.put(obj)
        }
        return arr.toString()
    }

    // ─── Distance extraction ──────────────────────────────────────────────────────

    private fun extractDistance(
        blocks: List<Text.TextBlock>,
        pickupAddr: Text.TextBlock?,
        destAddr: Text.TextBlock?,
    ): Double? {
        // Un écran VTC a souvent 2 km : pickup ("X min • Y km") et course.
        // 2 signaux :
        //  1. Bloc mixte min+km → pickup combo (à exclure pour distance course)
        //  2. Si adresses connues : préférer les km dont Y est dans la zone
        //     pickup-address → destination-address (= zone course)
        data class Cand(val value: Double, val y: Int, val isPickupCombo: Boolean)
        val candidates = mutableListOf<Cand>()

        for (block in blocks) {
            // Normalise les confusions OCR chiffre↔lettre dans les seules zones
            // numériques (ex: "1l.8 km" → "11.8 km"). Safe pour les adresses.
            val normalizedText = normalizeOcrDigits(block.text)
            val match = DISTANCE_REGEX.find(normalizedText) ?: continue
            val raw = match.groupValues[1]
            var value = cleanNum(raw).toDoubleOrNull() ?: continue

            // Défense fragmentation ML Kit : "Course de 11.8 km" peut être découpé
            // de deux façons :
            //   a) Deux blocs côte à côte ("Course de 11." + "8 km") — stitch inter
            //   b) Un seul bloc avec le point perdu ("Course de 11 8 km") — stitch intra
            // Si la valeur extraite est un entier (pas de "." ni ","), on tente les
            // deux stratégies avant de valider la valeur.
            if (!raw.contains('.') && !raw.contains(',')) {
                val intra = tryIntraBlockStitch(normalizedText, raw)
                if (intra != null) {
                    value = intra
                } else {
                    val inter = tryStitchFragmentedDistance(blocks, block, raw)
                    if (inter != null) value = inter
                }
            }

            if (value !in distMin..distMax) continue
            val isPickupCombo = Regex("""min""", RegexOption.IGNORE_CASE).containsMatchIn(block.text)
            val y = block.boundingBox?.centerY() ?: 0
            candidates.add(Cand(value, y, isPickupCombo))
        }

        if (candidates.isNotEmpty()) {
            // 1. Zone course (entre pickup et destination) si connue
            if (pickupAddr != null && destAddr != null) {
                val yMin = (pickupAddr.boundingBox?.top ?: 0) - 10
                val yMax = (destAddr.boundingBox?.bottom ?: Int.MAX_VALUE) + 10
                val inCourseZone = candidates.filter {
                    !it.isPickupCombo && it.y in yMin..yMax
                }
                if (inCourseZone.isNotEmpty()) {
                    return inCourseZone.maxByOrNull { it.value }?.value
                }
            }
            // 2. Fallback : exclure combos pickup, prendre le plus grand
            val nonPickup = candidates.filter { !it.isPickupCombo }
            val pool = if (nonPickup.isNotEmpty()) nonPickup else candidates
            return pool.maxByOrNull { it.value }?.value
        }

        // 3. Fallback legacy : "X,X" près d'un bloc qui contient "km"
        for (block in blocks) {
            if (!distanceAnchors.any { block.text.lowercase().contains(it) }) continue
            val match = Regex("""(\d+[.,]\d)""").find(block.text) ?: continue
            val value = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: continue
            if (value in distMin..distMax) return value
        }
        return null
    }

    // ─── Duration extraction ─────────────────────────────────────────────────────

    private fun extractDuration(
        blocks: List<Text.TextBlock>,
        pickupAddr: Text.TextBlock?,
        destAddr: Text.TextBlock?,
        courseDistanceKm: Double,
    ): Int? {
        data class Cand(val value: Int, val km: Double?, val y: Int, val isPickupCombo: Boolean)
        val candidates = mutableListOf<Cand>()

        for (block in blocks) {
            val lower = block.text.lowercase()
            val hasKm = lower.contains("km")
            val hasMin = lower.contains("min")
            val isPickupCombo = hasKm && hasMin

            if (hasKm && !hasMin) continue
            val normalizedText = normalizeOcrDigits(block.text)
            val match = DURATION_REGEX.find(normalizedText) ?: continue
            val value = match.groupValues[1].toIntOrNull() ?: continue
            if (value !in 1..180) continue
            // Pour un combo "X min • Y km", on capte aussi le km : il permet de
            // distinguer l'approche (petit km) de la course (grand km) quand les
            // DEUX lignes sont au format combo (cas Bolt).
            val km = if (isPickupCombo) DISTANCE_REGEX.find(normalizedText)?.let {
                cleanNum(it.groupValues[1]).toDoubleOrNull()
            } else null
            candidates.add(Cand(value, km, block.boundingBox?.centerY() ?: 0, isPickupCombo))
        }

        if (candidates.isEmpty()) return null

        // 1. Idéal : une durée "pure" (sans km) dans la zone course.
        if (pickupAddr != null && destAddr != null) {
            val yMin = (pickupAddr.boundingBox?.top ?: 0) - 10
            val yMax = (destAddr.boundingBox?.bottom ?: Int.MAX_VALUE) + 10
            val inCourseZone = candidates.filter { !it.isPickupCombo && it.y in yMin..yMax }
            if (inCourseZone.isNotEmpty()) return inCourseZone.first().value
        }
        val nonPickup = candidates.filter { !it.isPickupCombo }
        if (nonPickup.isNotEmpty()) return nonPickup.first().value

        // 2. Combos "min • km" : la course = le combo dont le km CORRESPOND à la
        //    distance de course (pas l'approche, dont le km est petit). Évite
        //    d'afficher le temps d'approche comme temps de course quand la course
        //    n'a pas de durée "pure" affichée (Uber : "Course de X km" sans min).
        val tol = maxOf(2.0, courseDistanceKm * 0.2)
        val courseCombo = candidates
            .filter { it.km != null && Math.abs(it.km!! - courseDistanceKm) <= tol }
            .maxByOrNull { it.km!! }
        if (courseCombo != null) return courseCombo.value
        // 3. Aucune durée fiable (seules des approches/bandeaux) → null : le calcul
        //    estimera la durée de course via la distance (estimateDurationMin).
        return null
    }

    // ─── Pickup combo extraction ("X min • X,X km") ───────────────────────────────

    private fun extractPickupInfo(
        blocks: List<Text.TextBlock>,
        courseDistanceKm: Double,
    ): Pair<Int, Double>? {
        data class PickupMatch(val durationMin: Int, val distanceKm: Double, val y: Int)
        val matches = mutableListOf<PickupMatch>()

        for (block in blocks) {
            // Normalise les confusions OCR dans le texte pickup aussi
            // (ex: "à 6 min (l.2 km)" → "à 6 min (1.2 km)").
            val text = normalizeOcrDigits(block.text)
            var minVal: Int? = null
            var kmVal: Double? = null

            PICKUP_COMBO_MIN_FIRST.find(text)?.let { m ->
                minVal = m.groupValues[1].replace("\\s+".toRegex(), "").toIntOrNull()
                kmVal = cleanNum(m.groupValues[2]).toDoubleOrNull()
            }
            if (minVal == null || kmVal == null) {
                PICKUP_COMBO_KM_FIRST.find(text)?.let { m ->
                    kmVal = cleanNum(m.groupValues[1]).toDoubleOrNull()
                    minVal = m.groupValues[2].replace("\\s+".toRegex(), "").toIntOrNull()
                }
            }

            val mv = minVal ?: continue
            val kv = kmVal ?: continue
            if (mv !in 1..60) continue
            if (kv !in 0.1..30.0) continue
            if (Math.abs(kv - courseDistanceKm) < 0.1) continue // c'est la course
            // L'approche est toujours plus courte que la course → un combo dont le
            // km ≥ distance de course est le bandeau nav (haut de l'écran), pas
            // l'approche. L'exclure évite de gonfler durée/distance totales.
            if (kv >= courseDistanceKm) continue

            val y = block.boundingBox?.centerY() ?: 0
            matches.add(PickupMatch(mv, kv, y))
        }

        if (matches.isEmpty()) return null
        val best = matches.sortedBy { it.y }.first()
        return Pair(best.durationMin, best.distanceKm)
    }

    // ─── Address extraction ───────────────────────────────────────────────────────

    // Libellés UI / boutons / en-têtes — jamais une adresse, même bien placés.
    private val actionWords = setOf(
        "accepter", "refuser", "accept", "decline", "reject", "confirmer", "confirm",
        "ignorer", "passer", "suivant", "next", "démarrer", "demarrer", "terminer",
        "naviguer", "navigate", "voir", "détails", "details", "gains", "gain",
        "revenu", "revenus", "total", "pourboire", "tip", "annuler", "cancel",
        "course", "courses", "trajet", "trajets", "prise", "destination",
        "arrivée", "arrivee", "départ", "depart", "note", "notes", "étoiles", "etoiles",
    )
    private fun hasActionWord(text: String): Boolean = actionWords.any { containsWord(text, it) }

    private val STAT_LINE = Regex("""^\s*(?:à\s*)?\d+[\d.,\s]*\s*(?:km|min)\b.*$""", RegexOption.IGNORE_CASE)

    /** Retire les lignes de stats ("49 min", "24.3 km", "3 min • 1.3 km") qu'OCR
     *  colle parfois à l'adresse dans un même bloc → ne garde que l'adresse.
     *  Ex: "49 min\n2 Rue Lefebvre, Paris" → "2 Rue Lefebvre, Paris". */
    /** Retire un préfixe parasite en tête d'adresse : symboles d'icône (● • * ▪),
     *  ou une lettre isolée issue d'une icône mal lue par l'OCR suivie d'un numéro
     *  ("A 7 Rue…" → "7 Rue…", "t 5 Av…" → "5 Av…"). Répare la dédup Heetch (icône
     *  lue "A" qui cassait le match par préfixe) et nettoie l'adresse géocodée. */
    private fun stripLeadingAddressJunk(s: String): String {
        var t = s.trimStart()
        t = t.replace(Regex("""^[^A-Za-zÀ-ÿ0-9]+"""), "")        // symboles/bullets
        t = t.replace(Regex("""^[A-Za-zÀ-ÿ]\s+(?=[0-9])"""), "") // lettre isolée + n°
        return t.trimStart()
    }

    private fun cleanAddressText(raw: String): String =
        stripLeadingAddressJunk(
            raw.split("\n").map { it.trim() }
                .filter { it.isNotEmpty() && !STAT_LINE.matches(it) }
                .joinToString("\n")
        )

    private fun isAddressBlock(block: Text.TextBlock, screenHeight: Int): Boolean {
        val original = cleanAddressText(block.text).trim()
        val text = original.lowercase()
        if (text.length < 6 || text.length > 90) return false

        // ── Rejets durs ──
        // Stats : "Course de 11.8 km" / "à 6 min (1.2 km)" ne sont jamais des adresses.
        if (Regex("""course\s+de""").containsMatchIn(text)) return false
        if (Regex("""\d[.,\s]*\d*\s*km\b""").containsMatchIn(text)) return false
        if (Regex("""\d\s*min\b""").containsMatchIn(text)) return false
        // Prix isolé / note ("12,50 €", "4,9 ★").
        if (Regex("""^\s*\d{1,3}[.,]\d{1,2}\s*€?\s*$""").containsMatchIn(text)) return false
        // Toute ligne tarifaire ("19,38 € (net, TTC)") → jamais une adresse.
        if (text.contains("€")) return false
        if (text.contains("★") || text.contains("⭐") || Regex("""\brating\b""").containsMatchIn(text)) return false
        // Ligne "note passager" : "Shirley 5.0 ★" / "Jean 4,9 *". Une note (0-5 avec
        // décimale) n'apparaît jamais dans une adresse → évite de prendre le nom du
        // passager pour l'adresse de départ (et de décaler toutes les adresses).
        if (Regex("""\b[0-5][.,]\d\b""").containsMatchIn(text)) return false
        // Libellé tarifaire Uber "Montant net de frais" (souvent collé à la note
        // "★ 4,79" en 2 décimales, qui échappe au reject note ci-dessus) → jamais
        // une adresse. Sans ça, la règle 6 (virgule) le classe pickup et décale tout.
        if (text.contains("net de frais") || text.contains("montant net")) return false
        if (nonAddressWords.contains(text)) return false
        // Marque / mode ("UberX Exclusivité", "BoltPlus Confort").
        if (Regex("""\b(uber\w*|bolt\w*|heetch\w*)\b""").containsMatchIn(text)) return false
        // Libellé UI / en-tête.
        if (hasActionWord(text)) return false

        // ── Signaux positifs ──
        // 1. Mot de voie (mot entier) : évite "via"→"aviation", "rue"→"cruelty".
        val wordBoundaryMatch = addressStreetKeywords.any { kw ->
            val escaped = Regex.escape(kw)
            Regex("""(?<![a-zà-üß])$escaped(?![a-zà-üß])""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        }
        if (wordBoundaryMatch) return true
        // 2. Suffixes DE composés ("Hauptstraße", "Berlinerstraße").
        if (addressStreetSuffixes.any { suf ->
            Regex("""[a-zà-üß]+${Regex.escape(suf)}(?![a-zà-üß])""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        }) return true
        // 3. Numéro + voie (FR/UK) : "10 rue de la Paix".
        if (Regex("""^\d{1,4}\s+[a-zà-ü]{3,}""").containsMatchIn(text)) return true
        // 4. Voie + numéro (DE/ES/IT) : "Hauptstraße 10", "Calle Alcalá, 10".
        if (Regex("""[a-zà-üß]{4,}[\s,]+\d{1,4}\s*$""").containsMatchIn(text)) return true
        // 5. Code postal (4-5 chiffres) + lettres : "94430 Chennevières", "75011 Paris",
        //    "Libération, 94430 Sucy". Couvre les adresses SANS mot de voie connu.
        if (Regex("""\b\d{4,5}\b""").containsMatchIn(text) && Regex("""[a-zà-üß]{3,}""").containsMatchIn(text)) return true
        // 6. Segment avec virgule SUIVIE d'une lettre + assez de lettres :
        //    "Châtelet, Paris". On exige ", lettre" (pas une virgule décimale type
        //    "4,79") sinon une ligne note/tarif passe pour une adresse.
        if (Regex(""",\s*[a-zà-üß]""").containsMatchIn(text) &&
            Regex("""[a-zà-üß]""").findAll(text).count() >= 6) return true
        return false
    }

    /**
     * Blocs d'adresse triés par Y ascendant. Invariant VTC garanti :
     *   [0] = pickup (Y minimum, en haut de l'écran)
     *   [1] = destination (en dessous)
     *
     * Filtre anti-map : sur Bolt/Uber la carte est OCR'isée aussi — les labels de
     * rues du fond ("RueRabelais", "All. de la Caravelle") passent isAddressBlock.
     * On n'accepte un candidat que si un bloc km/min existe à proximité verticale :
     * les vraies adresses du card trip sont toujours accolées aux stats.
     */
    private fun findAddressBlocks(
        blocks: List<Text.TextBlock>,
        screenHeight: Int,
        fareBlockY: Int? = null,
    ): List<Text.TextBlock> {
        var candidates = blocks
            .filter { (it.boundingBox?.centerY() ?: 0) > screenHeight * 0.25 }
            .filter { isAddressBlock(it, screenHeight) }
            .sortedBy { it.boundingBox?.centerY() ?: 0 }
        if (BuildConfig.DEBUG) Log.d("StriveScan", "  candidats isAddressBlock: ${candidates.map { it.text.replace("\n", " ") }}")

        // Filtre ancre-prix : les vraies adresses sont dans le card-trip qui
        // englobe le prix. Fenêtre asymétrique : un peu au-dessus du prix (slack)
        // et jusqu'à ~35% de l'écran en-dessous. Map labels Heetch/Bolt/Uber =
        // tous au-dessus du prix donc exclus.
        if (fareBlockY != null) {
            val slackAbove = (screenHeight * 0.05).toInt()
            val depthBelow = (screenHeight * 0.5).toInt()
            val yMin = fareBlockY - slackAbove
            val yMax = fareBlockY + depthBelow
            candidates = candidates.filter { b ->
                val y = b.boundingBox?.centerY() ?: return@filter false
                y in yMin..yMax
            }
            if (BuildConfig.DEBUG) Log.d("StriveScan", "  après fenêtre prix [$yMin..$yMax]: ${candidates.map { it.text.replace("\n", " ") }}")
        }

        // Filtre anti-map secondaire : si on a plus de 2 candidats après ancre
        // prix, on exige qu'ils soient à proximité d'un bloc km/min.
        if (candidates.size > 2) {
            val metricRegex = Regex("""\d+\s*[.,]?\s*\d*\s*(?:km|min)\b""", RegexOption.IGNORE_CASE)
            val metricYs = blocks.mapNotNull { b ->
                if (metricRegex.containsMatchIn(b.text)) b.boundingBox?.centerY() else null
            }
            if (metricYs.isNotEmpty()) {
                val radius = maxOf((screenHeight * 0.15).toInt(), 300)
                candidates = candidates.filter { b ->
                    // Adresse avec code postal (4-5 chiffres) = signal fort, jamais
                    // évincée même loin d'un bloc km/min (cas Heetch : adresses sans
                    // métrique à proximité).
                    if (Regex("""\b\d{4,5}\b""").containsMatchIn(b.text)) return@filter true
                    val y = b.boundingBox?.centerY() ?: return@filter false
                    metricYs.any { Math.abs(it - y) <= radius }
                }
                if (BuildConfig.DEBUG) Log.d("StriveScan", "  après proximité métrique (r=$radius, metricYs=$metricYs): ${candidates.map { it.text.replace("\n", " ") }}")
            }
        }

        // Retire les fins d'adresse coupées sur 2 lignes (ex: "Marne 94430") :
        // elles ne doivent pas occuper un slot adresse (sinon la destination est
        // évincée). Re-fusionnées à l'affichage par mergeAddressContinuation.
        candidates = candidates.filter { b ->
            candidates.none { head -> head !== b && isContinuationLine(head, b) }
        }
        if (BuildConfig.DEBUG) Log.d("StriveScan", "  après filtre continuation: ${candidates.map { it.text.replace("\n", " ") }}")

        return dedupOverlappingAddresses(candidates)
    }

    /**
     * Heetch (entre autres) affiche l'adresse courte puis la version longue juste
     * en-dessous (ex: "2 All. des Noyers" + "2 All. des Noyers, 94370 Sucy..., France").
     * Si un candidat est préfixe d'un autre, on garde le plus long — l'info code
     * postal + ville est précieuse pour le géocodage TomTom.
     */
    private fun dedupOverlappingAddresses(candidates: List<Text.TextBlock>): List<Text.TextBlock> {
        // Compare sur le texte nettoyé (préfixe parasite retiré) pour que la ligne
        // courte soit bien reconnue comme préfixe de la version longue (cas Heetch).
        val texts = candidates.map { cleanAddressText(it.text).trim() }
        return candidates.filterIndexed { i, _ ->
            val mine = texts[i]
            candidates.indices.none { j ->
                j != i && texts[j].length > mine.length && texts[j].startsWith(mine)
            }
        }
    }

    // ─── Sanity check ────────────────────────────────────────────────────────────

    private fun isSane(fare: Double, distanceKm: Double): Boolean {
        if (fare !in fareMin..fareMax) return false
        if (distanceKm !in distMin..distMax) return false
        val rate = fare / distanceKm
        if (rate !in rateMin..rateMax) return false
        return true
    }
}

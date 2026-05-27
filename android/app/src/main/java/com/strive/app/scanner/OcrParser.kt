package com.strive.scanner

import android.graphics.Bitmap
import com.google.mlkit.vision.text.Text
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

    private var fareMin = 3.0
    private var fareMax = 200.0
    private var distMin = 0.3
    private var distMax = 1000.0
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
        var platform = detectPlatform(fullText)
        if (platform == Platform.UNKNOWN && bitmap != null) {
            platform = detectPlatformByColor(bitmap)
        }

        val fare = extractFare(blocks, platform, screenHeight) ?: return null
        val fareBlockY = locateFareBlockY(blocks, fare)

        // Invariant layout VTC : 1ʳᵉ adresse = pickup, 2ᵉ = destination. On s'en
        // sert pour catégoriser les km/min par zone verticale.
        val addressBlocks = findAddressBlocks(blocks, screenHeight, fareBlockY)
        val pickupAddrBlock = addressBlocks.getOrNull(0)
        val destAddrBlock = addressBlocks.getOrNull(1)

        val distance = extractDistance(blocks, pickupAddrBlock, destAddrBlock) ?: return null
        val duration = extractDuration(blocks, pickupAddrBlock, destAddrBlock)

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
    private fun mergeAddressContinuation(
        addrBlock: Text.TextBlock,
        allBlocks: List<Text.TextBlock>,
        screenHeight: Int,
    ): String {
        val addrBox = addrBlock.boundingBox ?: return addrBlock.text.trim()
        val baseText = addrBlock.text.trim()

        val continuation = allBlocks.firstOrNull { other ->
            if (other === addrBlock) return@firstOrNull false
            val ob = other.boundingBox ?: return@firstOrNull false
            if (ob.top <= addrBox.top) return@firstOrNull false
            // Gap vertical ≤ 1 hauteur de ligne (tight)
            if (ob.top - addrBox.bottom > addrBox.height()) return@firstOrNull false
            // Chevauchement horizontal significatif
            val xOverlap = minOf(addrBox.right, ob.right) - maxOf(addrBox.left, ob.left)
            val minWidth = minOf(addrBox.width(), ob.width())
            if (xOverlap < minWidth * 0.5) return@firstOrNull false
            val t = other.text.trim()
            if (t.isEmpty() || t.length > 60) return@firstOrNull false
            // Exclus les lignes stats
            if (Regex("""\d\s*(?:km|min)\b""", RegexOption.IGNORE_CASE).containsMatchIn(t)) return@firstOrNull false
            // Exclus une nouvelle adresse (digit + nom de rue)
            if (Regex("""^\d{1,4}\s+[A-Za-zà-üÀ-Ü]""").containsMatchIn(t)) return@firstOrNull false
            // Exclus un autre bloc déjà classé adresse stricte
            if (isAddressBlock(other, screenHeight)) return@firstOrNull false
            true
        } ?: return baseText

        val contText = continuation.text.trim()
        // Si l'adresse se termine par un tiret (mot coupé) → concat direct
        // Sinon → newline (format cohérent avec "Libération, 94430\nChennevières-...")
        return if (baseText.endsWith('-')) "$baseText$contText" else "$baseText\n$contText"
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
        return blocks.firstOrNull { b ->
            patterns.any { p -> b.text.contains(p) }
        }?.boundingBox?.centerY()
    }

    // ─── Platform detection ───────────────────────────────────────────────────────

    private fun detectPlatform(fullText: String): Platform {
        for ((platform, keywords) in platformKeywords) {
            if (keywords.any { fullText.contains(it) }) return platform
        }
        return Platform.UNKNOWN
    }

    fun detectPlatformByColor(bitmap: Bitmap): Platform {
        val w = minOf(bitmap.width, 120)
        val h = minOf(bitmap.height, 200)
        val scaled = Bitmap.createScaledBitmap(bitmap, w, h, true)
        val pixels = IntArray(w * h)
        scaled.getPixels(pixels, 0, w, 0, 0, w, h)

        var greenCount = 0
        var pinkCount = 0
        var lightCount = 0

        for (px in pixels) {
            val r = (px shr 16) and 0xFF
            val g = (px shr 8) and 0xFF
            val b = px and 0xFF
            if (g > 140 && g > r + 30 && g > b + 20 && r < 120) greenCount++
            if (r > 180 && g < 100 && b > 80) pinkCount++
            if (r > 200 && g > 200 && b > 200) lightCount++
        }

        val total = pixels.size
        val threshold = total * 0.08
        if (greenCount > threshold) return Platform.BOLT
        if (pinkCount > threshold) return Platform.HEETCH
        if (lightCount > total * 0.35) return Platform.UBER
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
            // Exclus les boutons de suggestion de prix Heetch ("Proposer X €")
            if (Regex("""proposer""", RegexOption.IGNORE_CASE).containsMatchIn(normalizedText)) return@forEachIndexed
            val match = PRICE_REGEX.find(normalizedText) ?: return@forEachIndexed
            val intPart = match.groupValues[1].replace("\\s+".toRegex(), "")
            val decPart = match.groupValues[2].replace("\\s+".toRegex(), "")
            val value = "$intPart.$decPart".toDoubleOrNull() ?: return@forEachIndexed

            if (value !in fareMin..fareMax) return@forEachIndexed

            var score = 0f
            val box = block.boundingBox

            if (box != null) {
                // Plus le texte est grand, plus il est important visuellement
                score += box.height().toFloat() * 1.5f

                // Zone haute de l'écran = le prix de la course est toujours au-dessus du fold
                val centerY = (box.top + box.bottom) / 2f
                if (centerY < screenHeight * 0.55f) score += 30f
            }

            // Bloc lui-même contient un mot-ancre ("Total", "Gain", etc.)
            val blockLower = block.text.lowercase()
            if (anchors.any { blockLower.contains(it) }) score += 25f

            // Bloc précédent contient un mot-ancre
            if (idx > 0 && anchors.any { blocks[idx - 1].text.lowercase().contains(it) }) {
                score += 35f
            }

            // Bloc suivant contient un mot-ancre (cas Uber où le label est sous le montant)
            if (idx < blocks.size - 1 && anchors.any { blocks[idx + 1].text.lowercase().contains(it) }) {
                score += 20f
            }

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
    ): Int? {
        data class Cand(val value: Int, val y: Int)
        val candidates = mutableListOf<Cand>()

        for (block in blocks) {
            if (Regex("""km""", RegexOption.IGNORE_CASE).containsMatchIn(block.text)) continue
            val normalizedText = normalizeOcrDigits(block.text)
            val match = DURATION_REGEX.find(normalizedText) ?: continue
            val value = match.groupValues[1].toIntOrNull() ?: continue
            if (value !in 1..180) continue
            candidates.add(Cand(value, block.boundingBox?.centerY() ?: 0))
        }

        if (candidates.isEmpty()) return null

        if (pickupAddr != null && destAddr != null) {
            val yMin = (pickupAddr.boundingBox?.top ?: 0) - 10
            val yMax = (destAddr.boundingBox?.bottom ?: Int.MAX_VALUE) + 10
            val inCourseZone = candidates.filter { it.y in yMin..yMax }
            if (inCourseZone.isNotEmpty()) return inCourseZone.first().value
        }
        return candidates.first().value
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

            val y = block.boundingBox?.centerY() ?: 0
            matches.add(PickupMatch(mv, kv, y))
        }

        if (matches.isEmpty()) return null
        val best = matches.sortedBy { it.y }.first()
        return Pair(best.durationMin, best.distanceKm)
    }

    // ─── Address extraction ───────────────────────────────────────────────────────

    private fun isAddressBlock(block: Text.TextBlock, screenHeight: Int): Boolean {
        val text = block.text.lowercase().trim()
        if (text.length < 8 || text.length > 80) return false

        // Filtre anti-stats : une ligne "Course de 11.8 km" ou "à 6 min (1.2 km)"
        // n'est jamais une adresse, même si elle contiendrait un chiffre + mot-clé.
        if (Regex("""course\s+de""").containsMatchIn(text)) return false
        if (Regex("""\d[.,\s]*\d*\s*km\b""").containsMatchIn(text)) return false
        if (Regex("""\d\s*min\b""").containsMatchIn(text)) return false

        if (nonAddressWords.contains(text)) return false
        // Rejet par substring : "3 UberX Exclusivité" ou "5 BoltPlus Confort" ne
        // sont jamais des adresses même s'ils matchent le pattern digit+mot.
        if (Regex("""\b(uber\w*|bolt\w*|heetch\w*)\b""").containsMatchIn(text)) return false

        // 1. Mots de voie matchés comme mot entier (lookbehind/lookahead non-lettre)
        //    pour éviter "via" → "aviation", "rue" → "cruelty".
        val wordBoundaryMatch = addressStreetKeywords.any { kw ->
            val escaped = Regex.escape(kw)
            Regex("""(?<![a-zà-üß])$escaped(?![a-zà-üß])""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        }
        if (wordBoundaryMatch) return true

        // 2. Suffixes DE qui forment des mots composés ("Hauptstraße", "Berlinerstraße").
        val suffixMatch = addressStreetSuffixes.any { suf ->
            Regex("""[a-zà-üß]+${Regex.escape(suf)}(?![a-zà-üß])""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        }
        if (suffixMatch) return true

        // 3. Structure digit-first (FR/UK) : "10 rue de la Paix"
        if (Regex("""^\d{1,4}\s+[a-zà-ü]{5,}""").containsMatchIn(text)) return true
        // 4. Structure word-then-digit (DE/ES/IT) : "Hauptstraße 10", "Calle Alcalá, 10"
        if (Regex("""[a-zà-üß]{5,}[\s,]+\d{1,4}\s*$""").containsMatchIn(text)) return true
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
                    val y = b.boundingBox?.centerY() ?: return@filter false
                    metricYs.any { Math.abs(it - y) <= radius }
                }
            }
        }

        return dedupOverlappingAddresses(candidates)
    }

    /**
     * Heetch (entre autres) affiche l'adresse courte puis la version longue juste
     * en-dessous (ex: "2 All. des Noyers" + "2 All. des Noyers, 94370 Sucy..., France").
     * Si un candidat est préfixe d'un autre, on garde le plus long — l'info code
     * postal + ville est précieuse pour le géocodage TomTom.
     */
    private fun dedupOverlappingAddresses(candidates: List<Text.TextBlock>): List<Text.TextBlock> {
        val texts = candidates.map { it.text.trim() }
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

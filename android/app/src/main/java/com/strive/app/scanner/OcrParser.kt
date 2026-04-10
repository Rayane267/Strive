package com.strive.scanner

import com.google.mlkit.vision.text.Text
import org.json.JSONObject

object OcrParser {

    data class ScanResult(
        val platform: Platform,
        val fare: Double,
        val distanceKm: Double,
        val durationMin: Int? = null,          // null si non détecté → estimé côté RN
        val pickupAddress: String? = null,      // adresse prise en charge
        val destinationAddress: String? = null, // adresse destination
    )

    enum class Platform { UBER, BOLT, HEETCH, UNKNOWN }

    // ─── Remote config (valeurs par défaut — patchables via Supabase sans republier) ───

    private var priceAnchors = mutableMapOf(
        Platform.UBER   to listOf("total", "fare", "trip fare", "estimated fare", "gain"),
        Platform.BOLT   to listOf("gain", "earning", "revenu", "estimé", "total"),
        Platform.HEETCH to listOf("course", "tarif", "prix", "total"),
        Platform.UNKNOWN to listOf("total", "gain", "fare", "tarif"),
    )

    private var distanceAnchors = listOf("km", "kilomètre", "distance", "away")

    private var fareMin = 3.0
    private var fareMax = 200.0
    private var distMin = 0.3
    private var distMax = 150.0
    private var rateMin = 0.4
    private var rateMax = 12.0

    /**
     * Applique la remote config reçue depuis Supabase.
     * Format JSON attendu :
     * {
     *   "priceAnchors": { "UBER": [...], "BOLT": [...], "HEETCH": [...] },
     *   "distanceAnchors": [...],
     *   "sanity": { "fareMin": 3.0, "fareMax": 200.0, "distMin": 0.3, "distMax": 150.0, "rateMin": 0.4, "rateMax": 12.0 }
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

    // Mots-clés de voie pour détecter les adresses (FR + EN)
    private val addressStreetKeywords = listOf(
        "rue", "avenue", "av.", "boulevard", "blvd", "place", "pl.",
        "impasse", "allée", "allee", "chemin", "route", "passage",
        "quai", "villa", "cité", "cite", "esplanade", "cours",
        "faubourg", "grande rue", "voie", "sq.", "square",
        "street", "road", "lane", "drive", "st.", "rd.", "ave.", "way",
    )
    private val nonAddressWords = setOf(
        "uber", "bolt", "heetch", "total", "fare", "gain", "tarif",
        "accepted", "accepté", "min", "km", "estimated", "estimé",
    )

    // Regex : capture "12,50" ou "12.50" — pas les années ou codes postaux
    private val PRICE_REGEX = Regex("""(\d{1,3})[.,](\d{2})(?!\d)""")
    private val DISTANCE_REGEX = Regex("""(\d{1,3}[.,]?\d{0,2})\s*km""", RegexOption.IGNORE_CASE)
    private val DURATION_REGEX = Regex("""(\d{1,3})\s*min""", RegexOption.IGNORE_CASE)

    // ─── Sanity bounds (voir les vars mutables dans remote config) ───────────────

    // ─── Entry point ─────────────────────────────────────────────────────────────

    fun parse(visionText: Text, screenWidth: Int, screenHeight: Int): ScanResult? {
        val blocks = visionText.textBlocks
        if (blocks.isEmpty()) return null

        val fullText = blocks.joinToString(" ") { it.text }.lowercase()
        val platform = detectPlatform(fullText)

        val fare = extractFare(blocks, platform, screenHeight) ?: return null
        val distance = extractDistance(blocks) ?: return null
        val duration = extractDuration(blocks)

        if (!isSane(fare, distance)) return null

        val addresses = extractAddresses(blocks, screenHeight)

        return ScanResult(
            platform = platform,
            fare = fare,
            distanceKm = distance,
            durationMin = duration,
            pickupAddress = addresses.first,
            destinationAddress = addresses.second,
        )
    }

    // ─── Platform detection ───────────────────────────────────────────────────────

    private fun detectPlatform(fullText: String): Platform {
        for ((platform, keywords) in platformKeywords) {
            if (keywords.any { fullText.contains(it) }) return platform
        }
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
            val match = PRICE_REGEX.find(block.text) ?: return@forEachIndexed
            val value = "${match.groupValues[1]}.${match.groupValues[2]}".toDoubleOrNull()
                ?: return@forEachIndexed

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

    // ─── Distance extraction ──────────────────────────────────────────────────────

    private fun extractDistance(blocks: List<Text.TextBlock>): Double? {
        for (block in blocks) {
            val match = DISTANCE_REGEX.find(block.text) ?: continue
            val value = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: continue
            if (value in distMin..distMax) return value
        }
        // Fallback : chercher "X,X" près d'un bloc qui contient "km"
        for (block in blocks) {
            if (!distanceAnchors.any { block.text.lowercase().contains(it) }) continue
            val match = Regex("""(\d+[.,]\d)""").find(block.text) ?: continue
            val value = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: continue
            if (value in distMin..distMax) return value
        }
        return null
    }

    // ─── Duration extraction ─────────────────────────────────────────────────────

    private fun extractDuration(blocks: List<Text.TextBlock>): Int? {
        for (block in blocks) {
            val match = DURATION_REGEX.find(block.text) ?: continue
            val value = match.groupValues[1].toIntOrNull() ?: continue
            if (value in 1..180) return value
        }
        return null
    }

    // ─── Address extraction ───────────────────────────────────────────────────────

    private fun isAddressBlock(block: Text.TextBlock, screenHeight: Int): Boolean {
        val text = block.text.lowercase().trim()
        if (text.length < 8 || text.length > 80) return false
        if (nonAddressWords.contains(text)) return false
        if (addressStreetKeywords.any { text.contains(it) }) return true
        if (Regex("""^\d{1,4}\s+[a-zà-ü]{5,}""").containsMatchIn(text)) return true
        return false
    }

    /**
     * Retourne (pickupAddress, destinationAddress) triés par position Y.
     * Le pickup est l'adresse la plus haute sur l'écran.
     */
    private fun extractAddresses(blocks: List<Text.TextBlock>, screenHeight: Int): Pair<String?, String?> {
        val candidates = blocks
            .filter { block ->
                val centerY = block.boundingBox?.centerY() ?: 0
                centerY > screenHeight * 0.25
            }
            .filter { isAddressBlock(it, screenHeight) }
            .sortedBy { it.boundingBox?.centerY() ?: 0 }

        return Pair(
            candidates.getOrNull(0)?.text?.trim(),
            candidates.getOrNull(1)?.text?.trim(),
        )
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

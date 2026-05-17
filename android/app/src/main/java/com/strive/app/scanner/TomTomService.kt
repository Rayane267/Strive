package com.strive.scanner

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Appels TomTom natifs (geocoding + routing). Tourne dans le foreground service
 * donc non throttlé quand Strive est en background pendant un scan Uber/Bolt/Heetch.
 *
 * Utilise HttpURLConnection + Thread (cohérent avec GeminiVisionService).
 */
object TomTomService {

    private const val BASE_SEARCH  = "https://api.tomtom.com/search/2/geocode"
    private const val BASE_ROUTING = "https://api.tomtom.com/routing/1/calculateRoute"
    private const val COUNTRY_SET  = "FR,BE,CH,LU,GB,DE,ES,IT,NL,PT,AT,IE,PL"
    private const val TIMEOUT_MS   = 6_000
    private const val TAG          = "TomTomService"

    /** Clé API TomTom — renseignée depuis JS au démarrage via setTomTomApiKey. */
    var apiKey: String = ""

    val isReady get() = apiKey.isNotEmpty()

    data class Coords(val lat: Double, val lon: Double)
    data class GeocodeHit(val coords: Coords, val score: Double)
    data class RouteResult(val distanceKm: Double, val durationMin: Int)

    // Seuil de confiance sous lequel on retente avec des variantes d'adresse
    // (suffixe pays enlevé, seul code postal, etc.)
    private const val MIN_SCORE = 3.0

    /**
     * Calcule le trajet (distance + durée trafic) entre deux adresses texte.
     * Appelle le callback avec le résultat ou null si TomTom échoue.
     */
    fun calculateRoute(
        pickupAddress: String,
        destinationAddress: String,
        callback: (RouteResult?) -> Unit,
    ) {
        if (!isReady) { callback(null); return }
        if (pickupAddress.isBlank() || destinationAddress.isBlank()) { callback(null); return }

        Thread {
            try {
                val from = geocodeBestVariant(pickupAddress)
                val to = geocodeBestVariant(destinationAddress)
                if (from == null || to == null) {
                    Log.w(TAG, "geocode failed pickup=$from dest=$to")
                    callback(null); return@Thread
                }
                Log.i(TAG, "geocode scores pickup=${"%.1f".format(from.score)} dest=${"%.1f".format(to.score)}")
                val route = getRoute(from.coords, to.coords)
                callback(route)
            } catch (e: Exception) {
                Log.w(TAG, "exception", e)
                callback(null)
            }
        }.start()
    }

    // ─── Geocoding ────────────────────────────────────────────────────────────────

    /**
     * Essaie l'adresse telle quelle puis des variantes si le score est bas.
     * Garde le meilleur score. Early-exit si on trouve un résultat fiable.
     */
    private fun geocodeBestVariant(address: String): GeocodeHit? {
        val variants = buildAddressVariants(address)
        var best: GeocodeHit? = null
        for (variant in variants) {
            val hit = geocode(variant) ?: continue
            if (best == null || hit.score > best.score) best = hit
            if (best.score >= MIN_SCORE + 2) return best
        }
        return best
    }

    /**
     * Variantes pour récupérer quand le géocodage de base échoue :
     * - texte brut
     * - sans suffixe ", France" / ", Belgique" (redondant, pollue parfois)
     * - code postal + ville seulement (sur les adresses trop précises qui matchent rien)
     */
    private fun buildAddressVariants(address: String): List<String> {
        val result = linkedSetOf<String>()
        val trimmed = address.trim()
        result.add(trimmed)
        // Strip trailing ", France/Belgique/Suisse/Luxembourg"
        val stripped = trimmed.replace(
            Regex(""",\s*(France|Belgique|Suisse|Luxembourg|Deutschland|España|Italia|Portugal|Ireland|Nederland)\s*$""", RegexOption.IGNORE_CASE),
            "",
        )
        if (stripped != trimmed) result.add(stripped)
        // Postal code + ville (si présent)
        val postalMatch = Regex("""\b(\d{4,5})\s+([A-Za-zÀ-ÿ][\w\s-]{2,40})""").find(trimmed)
        if (postalMatch != null) {
            result.add("${postalMatch.groupValues[1]} ${postalMatch.groupValues[2].trim()}")
        }
        return result.toList()
    }

    private fun geocode(address: String): GeocodeHit? {
        val encoded = URLEncoder.encode(address, "UTF-8")
        val url = "$BASE_SEARCH/$encoded.json?key=$apiKey&language=fr-FR&countrySet=$COUNTRY_SET&limit=1"
        val json = httpGet(url) ?: return null
        return try {
            val results = JSONObject(json).optJSONArray("results") ?: return null
            if (results.length() == 0) return null
            val first = results.getJSONObject(0)
            val pos = first.getJSONObject("position")
            val score = first.optDouble("score", 0.0)
            GeocodeHit(Coords(pos.getDouble("lat"), pos.getDouble("lon")), score)
        } catch (e: Exception) {
            Log.w(TAG, "geocode parse", e); null
        }
    }

    // ─── Routing ──────────────────────────────────────────────────────────────────

    private fun getRoute(from: Coords, to: Coords): RouteResult? {
        val waypoints = "${from.lat},${from.lon}:${to.lat},${to.lon}"
        val url = "$BASE_ROUTING/$waypoints/json?key=$apiKey&travelMode=car&traffic=true"
        val json = httpGet(url) ?: return null
        return try {
            val summary = JSONObject(json)
                .getJSONArray("routes")
                .getJSONObject(0)
                .getJSONObject("summary")
            val seconds = summary.getInt("travelTimeInSeconds")
            val meters = summary.getInt("lengthInMeters")
            RouteResult(
                distanceKm = Math.round(meters / 100.0) / 10.0,
                durationMin = Math.round(seconds / 60.0).toInt(),
            )
        } catch (e: Exception) {
            Log.w(TAG, "route parse", e); null
        }
    }

    // ─── HTTP helper ──────────────────────────────────────────────────────────────

    private fun httpGet(url: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
            }
            val code = conn.responseCode
            if (code != 200) { Log.w(TAG, "HTTP $code"); return null }
            conn.inputStream.bufferedReader().readText()
        } catch (e: Exception) {
            Log.w(TAG, "http", e); null
        } finally {
            conn?.disconnect()
        }
    }
}

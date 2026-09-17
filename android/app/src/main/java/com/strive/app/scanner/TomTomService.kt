package com.strive.scanner

import android.content.Context
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
    private const val TIMEOUT_MS   = 4_000
    private const val TAG          = "TomTomService"

    /** Clé API TomTom — poussée depuis JS au login via setTomTomApiKey.
     *
     *  PERSISTÉE, comme la langue et le pays : le service de bulle survit à la
     *  mort du process RN (Android le tue pour récupérer de la mémoire, c'est
     *  banal), et une statique seule repartait alors vide. Le scan suivant
     *  tournait sans géocodage ni itinéraire — et, avant le repli explicite,
     *  affichait les chiffres de la plateforme comme s'il les avait mesurés. */
    var apiKey: String = ""

    private const val PREFS = "strive_scanner_tomtom"
    private const val KEY = "apiKey"

    /** Écrit la clé ET la persiste. Appelée par le bridge, depuis le JS. */
    fun setApiKey(ctx: Context, key: String) {
        apiKey = key
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, key).apply()
    }

    /** Rend la clé au service qui redémarre sans JS. Mirror `MarketFormat.hydrate`. */
    fun hydrate(ctx: Context) {
        if (apiKey.isNotEmpty()) return
        apiKey = ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, "") ?: ""
    }

    /**
     * Pays d'activité du chauffeur, pour le géocodage.
     *
     * `countrySet` listait les treize pays couverts et `language` était figé à
     * `fr-FR`. Une adresse de rue existe souvent dans plusieurs pays — il y a des
     * « Victoria Street » partout — et TomTom, à `limit=1`, en choisissait une.
     * Restreindre au pays du chauffeur supprime l'ambiguïté à la source au lieu
     * d'espérer que le classement tombe juste.
     *
     * Vide = on ne sait pas encore : on garde alors la liste complète, qui vaut
     * mieux qu'un pays deviné.
     */
    var marketCountry: String = ""

    /** Le pays du chauffeur s'il est connu, sinon les treize marchés couverts. */
    private val countrySet get() = if (marketCountry.isNotEmpty()) marketCountry else COUNTRY_SET

    /** Langue des résultats : celle du pays, faute de quoi les libellés
     *  revenaient en français pour un chauffeur londonien. */
    private val geocodeLanguage get() = when (marketCountry) {
        "GB" -> "en-GB"
        "ES" -> "es-ES"
        "PT" -> "pt-PT"
        "BE" -> "fr-BE"
        "CH" -> "fr-CH"
        else -> "fr-FR"
    }

    val isReady get() = apiKey.isNotEmpty()

    data class Coords(val lat: Double, val lon: Double)
    data class GeocodeHit(val coords: Coords, val score: Double, val formatted: String? = null)
    data class RouteResult(
        val distanceKm: Double,
        val durationMin: Int,
        // Adresses canoniques TomTom (affichage propre vs texte OCR bruité).
        val pickupFormatted: String? = null,
        val destFormatted: String? = null,
    )

    // Seuil de confiance sous lequel on retente avec des variantes d'adresse
    // (suffixe pays enlevé, seul code postal, etc.)
    private const val MIN_SCORE = 3.0

    /**
     * Issue d'un calcul d'itinéraire. Mirror iOS `TomTomService.RouteOutcome`.
     *
     * `null` ne disait que « pas d'itinéraire », et l'appelant se rabattait alors
     * sur les chiffres lus à l'écran — ceux de la plateforme — sans que le
     * chauffeur puisse le savoir. Les deux motifs ne se soignent pourtant pas de
     * la même façon : un réseau absent se retente, une adresse illisible se
     * recapture. Deux messages, donc deux valeurs.
     */
    sealed class RouteOutcome {
        data class Ok(val route: RouteResult) : RouteOutcome()
        /** Aucune clé configurée : rien n'est mesurable sur cette install. */
        object NoKey : RouteOutcome()
        /** TomTom n'a pas répondu — réseau, timeout, erreur HTTP. */
        object Unreachable : RouteOutcome()
        /** TomTom a répondu, résultat inexploitable : adresse sous le plancher
         *  de fiabilité, ou trajet hors bornes. */
        object Unusable : RouteOutcome()
    }

    /** Issue d'un géocodage. Même raison d'être que [RouteOutcome]. */
    private sealed class GeocodeOutcome {
        data class Hit(val hit: GeocodeHit) : GeocodeOutcome()
        object Unreachable : GeocodeOutcome()
        object Unusable : GeocodeOutcome()
    }

    /**
     * Calcule le trajet (distance + durée trafic) entre deux adresses texte.
     * Appelle le callback avec le résultat ou null si TomTom échoue.
     */
    fun calculateRoute(
        pickupAddress: String,
        destinationAddress: String,
        callback: (RouteOutcome) -> Unit,
    ) {
        if (!isReady) { callback(RouteOutcome.NoKey); return }
        if (pickupAddress.isBlank() || destinationAddress.isBlank()) {
            callback(RouteOutcome.Unusable); return
        }

        Thread {
            try {
                // Geocoding pickup + destination en parallèle — chacun fait jusqu'à
                // 3 variantes d'adresse en série, donc parallèliser les 2 colonnes
                // divise potentiellement par 2 le temps total avant routing.
                var fromOutcome: GeocodeOutcome = GeocodeOutcome.Unusable
                var toOutcome: GeocodeOutcome = GeocodeOutcome.Unusable
                val tFrom = Thread { fromOutcome = geocodeBestVariant(pickupAddress) }
                val tTo = Thread { toOutcome = geocodeBestVariant(destinationAddress) }
                tFrom.start(); tTo.start()
                tFrom.join(); tTo.join()

                val from = (fromOutcome as? GeocodeOutcome.Hit)?.hit
                val to = (toOutcome as? GeocodeOutcome.Hit)?.hit
                if (from == null || to == null) {
                    // Un réseau absent l'emporte sur une adresse douteuse : c'est
                    // le motif le plus probable des deux, et le seul qui vaille la
                    // peine d'être retenté tel quel.
                    val unreachable = fromOutcome is GeocodeOutcome.Unreachable ||
                        toOutcome is GeocodeOutcome.Unreachable
                    Log.w(TAG, "geocode failed unreachable=" + unreachable)
                    callback(if (unreachable) RouteOutcome.Unreachable else RouteOutcome.Unusable)
                    return@Thread
                }
                Log.i(TAG, "geocode scores pickup=${"%.1f".format(from.score)} dest=${"%.1f".format(to.score)}")
                // Enrichit avec les adresses canoniques TomTom → affichage propre.
                when (val routeOutcome = getRoute(from.coords, to.coords)) {
                    is RouteOutcome.Ok -> callback(
                        RouteOutcome.Ok(
                            routeOutcome.route.copy(
                                pickupFormatted = from.formatted,
                                destFormatted = to.formatted,
                            )
                        )
                    )
                    else -> callback(routeOutcome)
                }
            } catch (e: Exception) {
                Log.w(TAG, "exception", e)
                callback(RouteOutcome.Unreachable)
            }
        }.start()
    }

    // ─── Geocoding ────────────────────────────────────────────────────────────────

    /**
     * Essaie l'adresse telle quelle puis des variantes si le score est bas.
     * Garde le meilleur score. Early-exit si on trouve un résultat fiable.
     */
    private fun geocodeBestVariant(address: String): GeocodeOutcome {
        val variants = buildAddressVariants(address)
        var best: GeocodeHit? = null
        var sawUnreachable = false
        for (variant in variants) {
            when (val outcome = geocode(variant)) {
                is GeocodeOutcome.Hit -> {
                    val hit = outcome.hit
                    val current = best
                    if (current == null || hit.score > current.score) best = hit
                    val kept = best
                    if (kept != null && kept.score >= MIN_SCORE + 2) return GeocodeOutcome.Hit(kept)
                }
                GeocodeOutcome.Unreachable -> sawUnreachable = true
                GeocodeOutcome.Unusable -> continue
            }
        }
        // Plancher de fiabilité : un score < MIN_SCORE = match centroïde ville/pays
        // (adresse OCR douteuse). On préfère échouer → pas de "vraie" distance
        // fausse, et surtout pas un trajet centre-à-centre présenté comme mesuré.
        best?.takeIf { it.score >= MIN_SCORE }?.let { return GeocodeOutcome.Hit(it) }
        return if (sawUnreachable) GeocodeOutcome.Unreachable else GeocodeOutcome.Unusable
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

    private fun geocode(address: String): GeocodeOutcome {
        // Cache local — les coords GPS d'une adresse sont stables dans le temps.
        // Hit cache → 0 requête TomTom. Voir GeocodeCache pour la normalisation.
        GeocodeCache.get(address)?.let { return GeocodeOutcome.Hit(it) }

        val encoded = URLEncoder.encode(address, "UTF-8")
        val url = "$BASE_SEARCH/$encoded.json?key=$apiKey&language=$geocodeLanguage&countrySet=$countrySet&limit=1"
        // La distinction porte ici : pas de réponse = réseau, réponse illisible =
        // adresse. Confondre les deux, c'est dire « recapture » à quelqu'un qui est
        // simplement dans un parking souterrain.
        val json = httpGet(url) ?: return GeocodeOutcome.Unreachable
        val hit = try {
            val results = JSONObject(json).optJSONArray("results")
                ?: return GeocodeOutcome.Unusable
            if (results.length() == 0) return GeocodeOutcome.Unusable
            val first = results.getJSONObject(0)
            val pos = first.getJSONObject("position")
            val score = first.optDouble("score", 0.0)
            val formatted = first.optJSONObject("address")
                ?.optString("freeformAddress")?.takeIf { it.isNotBlank() }
            GeocodeHit(Coords(pos.getDouble("lat"), pos.getDouble("lon")), score, formatted)
        } catch (e: Exception) {
            Log.w(TAG, "geocode parse", e); null
        }
        // Persiste uniquement les résultats fiables — un faux match (score
        // bas) cacherait à vie un mauvais POI. Le seuil MIN_SCORE est aussi
        // celui utilisé par geocodeBestVariant pour décider si on continue.
        if (hit != null && hit.score >= MIN_SCORE) GeocodeCache.put(address, hit)
        return if (hit != null) GeocodeOutcome.Hit(hit) else GeocodeOutcome.Unusable
    }

    // ─── Routing ──────────────────────────────────────────────────────────────────

    private fun getRoute(from: Coords, to: Coords): RouteOutcome {
        val waypoints = "${from.lat},${from.lon}:${to.lat},${to.lon}"
        // traffic=true + departAt=now → trafic temps réel (flux live + incidents)
        // à l'instant du calcul ; routeType=fastest → meilleur trajet.
        val url = "$BASE_ROUTING/$waypoints/json?key=$apiKey&travelMode=car&traffic=true&routeType=fastest&departAt=now"
        val json = httpGet(url) ?: return RouteOutcome.Unreachable
        return try {
            val summary = JSONObject(json)
                .getJSONArray("routes")
                .getJSONObject(0)
                .getJSONObject("summary")
            val seconds = summary.getInt("travelTimeInSeconds")
            val meters = summary.getInt("lengthInMeters")
            RouteOutcome.Ok(
                RouteResult(
                    distanceKm = Math.round(meters / 100.0) / 10.0,
                    durationMin = Math.round(seconds / 60.0).toInt(),
                )
            )
        } catch (e: Exception) {
            Log.w(TAG, "route parse", e); RouteOutcome.Unusable
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

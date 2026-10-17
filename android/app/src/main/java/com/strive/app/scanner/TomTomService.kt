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
    /** Recherche de lieux (gares, aéroports, parkings…). `/geocode` ne connaît
     *  que les rues : « Parking, Cité des Sciences et de l'Industrie » y devenait
     *  une avenue de Belfort, score 13. Mirror iOS. */
    private const val BASE_PLACE_SEARCH = "https://api.tomtom.com/search/2/search"
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
        // Points géocodés, gardés pour la carte des zones (Stats).
        val pickupCoords: Coords? = null,
        val destCoords: Coords? = null,
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
         *  de fiabilité, ou trajet hors bornes. [detail] dit laquelle
         *  (« geocode pickup=none », « route_api »…) — il part en `detail` de l'échec. */
        data class Unusable(val detail: String) : RouteOutcome()
    }

    /** Issue d'un géocodage. Même raison d'être que [RouteOutcome]. `Unusable`
     *  porte le meilleur score obtenu : null = aucun résultat, sinon un résultat
     *  trouvé mais sous le plancher (centroïde de ville). */
    private sealed class GeocodeOutcome {
        data class Hit(val hit: GeocodeHit) : GeocodeOutcome()
        object Unreachable : GeocodeOutcome()
        data class Unusable(val bestScore: Double? = null) : GeocodeOutcome()
    }

    /** « pickup=none », « dest=2.1 » : ce que le géocodeur a fait d'une adresse
     *  refusée. null si l'adresse est passée. Mirror iOS. */
    private fun geocodeFailure(side: String, outcome: GeocodeOutcome): String? {
        if (outcome !is GeocodeOutcome.Unusable) return null
        return outcome.bestScore?.let { String.format(java.util.Locale.ROOT, "%s=%.1f", side, it) }
            ?: "$side=none"
    }

    /**
     * Calcule le trajet (distance + durée trafic) entre deux adresses texte.
     *
     * [screenDistanceKm] : la distance de course lue à l'écran. Elle sert à
     * vérifier que la destination géocodée est à une distance du départ
     * compatible, et sinon à la chercher autour du départ (cf. [resolveNear]).
     * null = comportement d'origine. Mirror iOS.
     */
    fun calculateRoute(
        pickupAddress: String,
        destinationAddress: String,
        screenDistanceKm: Double? = null,
        callback: (RouteOutcome) -> Unit,
    ) {
        if (!isReady) { callback(RouteOutcome.NoKey); return }
        if (pickupAddress.isBlank() || destinationAddress.isBlank()) {
            callback(RouteOutcome.Unusable("empty_address")); return
        }

        Thread {
            try {
                // Geocoding pickup + destination en parallèle — chacun fait jusqu'à
                // 3 variantes d'adresse en série, donc parallèliser les 2 colonnes
                // divise potentiellement par 2 le temps total avant routing.
                var fromOutcome: GeocodeOutcome = GeocodeOutcome.Unusable()
                var toOutcome: GeocodeOutcome = GeocodeOutcome.Unusable()
                val tFrom = Thread { fromOutcome = geocodeBestVariant(pickupAddress) }
                val tTo = Thread { toOutcome = geocodeBestVariant(destinationAddress) }
                tFrom.start(); tTo.start()
                tFrom.join(); tTo.join()

                var from = (fromOutcome as? GeocodeOutcome.Hit)?.hit
                var to = (toOutcome as? GeocodeOutcome.Hit)?.hit

                // Recalage géographique par la distance affichée. Le départ est en
                // général une adresse que le géocodeur trouve ; la destination,
                // souvent un LIEU (gare, aéroport, parking) qu'il confond avec une
                // rue homonyme ailleurs. Rien ne change quand le point trouvé est
                // cohérent ; si rien n'est cohérent, on garde le résultat d'origine.
                if (screenDistanceKm != null && screenDistanceKm > 0) {
                    val f = from
                    val t = to
                    if (f != null) {
                        to = resolveNear(destinationAddress, t, f.coords, screenDistanceKm) ?: t
                    } else if (t != null) {
                        from = resolveNear(pickupAddress, null, t.coords, screenDistanceKm)
                    }
                }

                if (from == null || to == null) {
                    // Un réseau absent l'emporte sur une adresse douteuse : c'est
                    // le motif le plus probable des deux, et le seul qui vaille la
                    // peine d'être retenté tel quel.
                    val unreachable = fromOutcome is GeocodeOutcome.Unreachable ||
                        toOutcome is GeocodeOutcome.Unreachable
                    Log.w(TAG, "geocode failed unreachable=" + unreachable)
                    val refused = listOfNotNull(
                        geocodeFailure("pickup", fromOutcome), geocodeFailure("dest", toOutcome),
                    ).joinToString(" ")
                    callback(if (unreachable) RouteOutcome.Unreachable else RouteOutcome.Unusable("geocode $refused"))
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
                                pickupCoords = from.coords,
                                destCoords = to.coords,
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

    // ─── Recalage par la distance affichée ───────────────────────────────────────

    /** Distance à vol d'oiseau, en km. */
    private fun straightKm(a: Coords, b: Coords): Double {
        val r = 6371.0
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLon = Math.toRadians(b.lon - a.lon)
        val h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(a.lat)) * Math.cos(Math.toRadians(b.lat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(h)))
    }

    /** Un point à [km] du départ (vol d'oiseau) est-il compatible avec la
     *  distance de route affichée ? Jamais plus loin que la route (arrondis
     *  compris), et rarement à moins de 40 % d'elle. */
    private fun plausible(km: Double, screen: Double): Boolean =
        km <= screen * 1.1 + 2 && km >= screen / 2.5 - 1

    /** Écart à la distance attendue : une route fait ~1,35 fois le vol d'oiseau. */
    private fun misfit(km: Double, screen: Double): Double = Math.abs(km * 1.35 - screen)

    /**
     * Le point le plus cohérent pour [address], vu depuis [anchor].
     *
     * [current] (le géocodage normal) est gardé s'il est plausible : aucun appel
     * de plus. Sinon on interroge, dans un cercle autour de [anchor], la recherche
     * de lieux ET le géocodage, et on garde le candidat plausible le plus proche
     * de la distance attendue. Aucune des deux méthodes n'a raison partout —
     * « Hall 2, Aéroport Lyon-Saint-Exupéry » n'est juste qu'en géocodage,
     * « Terminal 1, Aéroport Marseille Provence » qu'en recherche de lieux.
     * null si rien n'est plausible. Mirror iOS.
     */
    private fun resolveNear(address: String, current: GeocodeHit?, anchor: Coords, screenKm: Double): GeocodeHit? {
        if (current != null && plausible(straightKm(anchor, current.coords), screenKm)) return current
        val radiusKm = screenKm * 1.1 + 2
        var place: GeocodeHit? = null
        var street: GeocodeHit? = null
        val tPlace = Thread { place = lookup(BASE_PLACE_SEARCH, address, anchor, radiusKm) }
        val tStreet = Thread { street = lookup(BASE_SEARCH, address, anchor, radiusKm) }
        tPlace.start(); tStreet.start()
        tPlace.join(); tStreet.join()
        return listOfNotNull(place, street)
            .map { it to straightKm(anchor, it.coords) }
            .filter { plausible(it.second, screenKm) }
            .minByOrNull { misfit(it.second, screenKm) }
            ?.first
    }

    /** Premier résultat de [base] dans un cercle autour de [near]. Ni cache ni
     *  plancher de score : le score de la recherche de lieux n'est pas sur la
     *  même échelle qu'en `/geocode`, c'est la cohérence de distance qui juge. */
    private fun lookup(base: String, address: String, near: Coords, radiusKm: Double): GeocodeHit? {
        val encoded = URLEncoder.encode(address, "UTF-8")
        val url = "$base/$encoded.json?key=$apiKey&language=$geocodeLanguage&countrySet=$countrySet&limit=1" +
            "&lat=${near.lat}&lon=${near.lon}&radius=${(radiusKm * 1000).toInt()}"
        val json = httpGet(url) ?: return null
        return try {
            val first = JSONObject(json).optJSONArray("results")?.optJSONObject(0) ?: return null
            val pos = first.getJSONObject("position")
            val formatted = first.optJSONObject("address")
                ?.optString("freeformAddress")?.takeIf { it.isNotBlank() }
            GeocodeHit(Coords(pos.getDouble("lat"), pos.getDouble("lon")), first.optDouble("score", 0.0), formatted)
        } catch (e: Exception) {
            Log.w(TAG, "place lookup parse", e); null
        }
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
                is GeocodeOutcome.Unusable -> continue
            }
        }
        // Plancher de fiabilité : un score < MIN_SCORE = match centroïde ville/pays
        // (adresse OCR douteuse). On préfère échouer → pas de "vraie" distance
        // fausse, et surtout pas un trajet centre-à-centre présenté comme mesuré.
        best?.takeIf { it.score >= MIN_SCORE }?.let { return GeocodeOutcome.Hit(it) }
        return if (sawUnreachable) GeocodeOutcome.Unreachable else GeocodeOutcome.Unusable(best?.score)
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
                ?: return GeocodeOutcome.Unusable()
            if (results.length() == 0) return GeocodeOutcome.Unusable()
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
        return if (hit != null) GeocodeOutcome.Hit(hit) else GeocodeOutcome.Unusable()
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
            Log.w(TAG, "route parse", e); RouteOutcome.Unusable("route_api no_route")
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

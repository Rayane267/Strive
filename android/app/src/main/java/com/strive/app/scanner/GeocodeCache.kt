package com.strive.scanner

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.text.Normalizer

/**
 * Cache local des géocodes TomTom. Les coordonnées GPS d'une adresse ne
 * changent pas — on évite donc de redemander à TomTom la position d'une
 * adresse déjà vue. Économise ~2/3 des requêtes TomTom une fois warm.
 *
 * Stockage : SharedPreferences, 1 entrée par adresse normalisée. ~100 bytes
 * par entrée → 10 000 adresses ≈ 1 MB. Aucun cap implémenté : si jamais ça
 * devenait gênant, ajouter un purge LRU sur la taille des prefs.
 *
 * Init obligatoire dans `MainApplication.onCreate()` :
 *   GeocodeCache.init(this)
 */
object GeocodeCache {

    private const val PREFS_NAME = "strive_geocode_cache"
    // v2 : ajout du libellé canonique `formatted`. Bump du préfixe → les entrées
    // v1 (sans formatted) sont ignorées et re-géocodées une fois (avec formatted).
    private const val KEY_PREFIX = "g2:"

    @Volatile private var prefs: SharedPreferences? = null

    fun init(ctx: Context) {
        if (prefs == null) {
            prefs = ctx.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    fun get(address: String): TomTomService.GeocodeHit? {
        val p = prefs ?: return null
        val json = p.getString(KEY_PREFIX + normalize(address), null) ?: return null
        return try {
            val obj = JSONObject(json)
            TomTomService.GeocodeHit(
                coords = TomTomService.Coords(obj.getDouble("lat"), obj.getDouble("lon")),
                score = obj.optDouble("score", 0.0),
                formatted = obj.optString("formatted").takeIf { it.isNotBlank() },
            )
        } catch (e: Exception) {
            null
        }
    }

    fun put(address: String, hit: TomTomService.GeocodeHit) {
        val p = prefs ?: return
        val json = JSONObject().apply {
            put("lat", hit.coords.lat)
            put("lon", hit.coords.lon)
            put("score", hit.score)
            hit.formatted?.let { put("formatted", it) }
        }.toString()
        p.edit().putString(KEY_PREFIX + normalize(address), json).apply()
    }

    /**
     * Normalise l'adresse pour maximiser les cache hits :
     *   - lowercase
     *   - retire les accents (NFD + strip combining marks)
     *   - collapse les espaces multiples
     *   - trim
     *
     * "Av. des Champs-Élysées, Paris" et "AV.  DES CHAMPS-ELYSEES, PARIS"
     * donnent la même clé.
     */
    private fun normalize(s: String): String {
        return Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
            .lowercase()
            .replace("\\s+".toRegex(), " ")
            .trim()
    }
}

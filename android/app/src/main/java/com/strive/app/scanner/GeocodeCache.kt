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
 * par entrée → 10 000 adresses ≈ 1 MB.
 *
 * ⚠️ Les clés contiennent des ADRESSES (données personnelles des passagers).
 * Conformité RGPD (limitation de conservation) :
 *   - TTL de 90 j (re-géocodage une fois après expiration — coût négligeable),
 *   - clear() appelé au logout et à la suppression de compte (le cache vit
 *     uniquement sur l'appareil, hors de portée de la RPC delete_account).
 *
 * Init obligatoire dans `MainApplication.onCreate()` :
 *   GeocodeCache.init(this)
 */
object GeocodeCache {

    private const val PREFS_NAME = "strive_geocode_cache"
    // v2 : ajout du libellé canonique `formatted`. Bump du préfixe → les entrées
    // v1 (sans formatted) sont ignorées et re-géocodées une fois (avec formatted).
    private const val KEY_PREFIX = "g2:"

    // Préfixes purgés par clear() : le courant ET tous les précédents. Un bump de
    // version (g: → g2:) rend les anciennes entrées illisibles mais ne les efface
    // pas — et plus personne ne les lisant, le TTL ne les atteint jamais non plus.
    // Elles contiennent des adresses de passagers et survivaient donc au logout
    // comme à la suppression de compte. ⚠️ Tout futur bump s'ajoute ici.
    private val PURGED_KEY_PREFIXES = listOf("g:", "g2:")

    /** Durée de vie d'une entrée (90 j). Coords stables mais on ne conserve pas
     *  une adresse de passager indéfiniment (RGPD). */
    private const val TTL_MS = 90L * 24 * 3600 * 1000

    @Volatile private var prefs: SharedPreferences? = null

    fun init(ctx: Context) {
        if (prefs == null) {
            prefs = ctx.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    fun get(address: String): TomTomService.GeocodeHit? {
        val p = prefs ?: return null
        val key = KEY_PREFIX + normalize(address)
        val json = p.getString(key, null) ?: return null
        return try {
            val obj = JSONObject(json)
            // TTL : entrée expirée — ou legacy sans `savedAt` — → purge + miss
            // (re-géocodée et ré-horodatée au prochain put).
            val savedAt = obj.optLong("savedAt", 0L)
            if (savedAt <= 0L || System.currentTimeMillis() - savedAt > TTL_MS) {
                p.edit().remove(key).apply()
                return null
            }
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
            put("savedAt", System.currentTimeMillis())
            hit.formatted?.let { put("formatted", it) }
        }.toString()
        p.edit().putString(KEY_PREFIX + normalize(address), json).apply()
    }

    /** Efface TOUTES les entrées de géocodage (adresses = PII). Appelé au logout
     *  et après suppression de compte → l'effacement couvre aussi le cache local,
     *  que la RPC serveur delete_account ne peut pas atteindre. */
    fun clear() {
        val p = prefs ?: return
        val editor = p.edit()
        for (k in p.all.keys) if (PURGED_KEY_PREFIXES.any { k.startsWith(it) }) editor.remove(k)
        editor.apply()
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

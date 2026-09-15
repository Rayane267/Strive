package com.strive.app.scanner

import android.content.Context

/**
 * Devise et unité de distance du chauffeur, pour tout ce que le NATIF affiche :
 * la bulle, la notification de résultat, le récapitulatif de session.
 *
 * Le symbole « € » était écrit en dur à une dizaine d'endroits. Un chauffeur
 * londonien voyait donc son verdict en euros dans la bulle alors que l'app,
 * elle, lui parlait en livres — deux monnaies pour la même course, et celle qui
 * compte au moment de décider était la fausse.
 *
 * ── POURQUOI UNE PRÉFÉRENCE ET PAS UNE VARIABLE STATIQUE ──────────────────
 * La bulle tourne dans un service de premier plan qui survit à l'app, et
 * qu'Android peut relancer sans que JS ait jamais démarré. Une statique
 * repartirait alors à sa valeur par défaut : le chauffeur britannique
 * retrouverait des euros après un redémarrage système, sans rien avoir fait.
 * La préférence, elle, traverse. Mirror du `marketCountry` que l'iOS garde dans
 * son App Group.
 */
object MarketFormat {
    private const val PREFS = "strive_market"
    private const val KEY_COUNTRY = "marketCountry"

    /** Cache mémoire — évite de relire les préférences à chaque frame de la bulle. */
    private var cached: String? = null

    fun setCountry(ctx: Context, code: String) {
        ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_COUNTRY, code).apply()
        cached = code
        // Les deux autres consommateurs du pays vivent leur propre vie : le
        // parser s'en sert pour les miles, le géocodeur pour restreindre sa
        // recherche. On les tient à jour d'ici, pour n'avoir qu'un point d'entrée.
        OcrParser.marketCountry = code
        TomTomService.marketCountry = code
    }

    fun country(ctx: Context): String {
        cached?.let { return it }
        val c = ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_COUNTRY, "FR") ?: "FR"
        cached = c
        return c
    }

    /** « € », « CHF » ou « £ ». */
    fun symbol(ctx: Context): String = when (country(ctx)) {
        "GB" -> "£"
        "CH" -> "CHF"
        else -> "€"
    }

    /** « km » partout, « mi » au Royaume-Uni. */
    fun distanceUnit(ctx: Context): String = if (country(ctx) == "GB") "mi" else "km"

    /**
     * Distance ramenée à l'unité du marché.
     *
     * Le scanner rend toujours des kilomètres — c'est ce que stocke
     * `rides.distance_km`, et les bornes de plausibilité raisonnent dessus. La
     * conversion n'a lieu qu'ici, au dernier pixel.
     */
    fun distance(ctx: Context, km: Double): Double =
        if (country(ctx) == "GB") km / 1.609344 else km

    /**
     * La livre se pose AVANT le nombre, l'euro et le franc après.
     *
     * S'y tromper suffit à faire lire le prix comme une traduction automatique,
     * et c'est le premier chiffre que le chauffeur regarde.
     */
    fun money(ctx: Context, value: Double, decimals: Int = 0): String {
        val s = String.format(java.util.Locale.US, "%.${decimals}f", value)
        val sym = symbol(ctx)
        // Espace avant « CHF » seulement : c'est un mot, et « 37CHF » se lit
        // comme une coquille. Les glyphes restent collés — la bulle compte ses
        // points de largeur.
        return when {
            sym == "£" -> "$sym$s"
            sym.length > 1 -> "$s $sym"
            else -> "$s$sym"
        }
    }

    /** « 57€/h », « £37/h ». */
    fun perHour(ctx: Context, value: Double): String = money(ctx, value, 0) + "/h"

    /**
     * Un taux « par kilomètre » ramené à l'unité du marché.
     *
     * Le tarif divisé par la distance donne toujours des « par kilomètre » —
     * c'est en kilomètres que le parser rend la course, sur les six marchés.
     * Coller « /mi » derrière sans convertir affichait donc 0,80 £/mile là où le
     * chauffeur gagne 1,29 £/mile : un tiers de son revenu effacé par une
     * étiquette.
     *
     * Un taux par mile est PLUS GRAND que le même taux par kilomètre — on
     * parcourt plus de chemin pour le gagner. D'où la multiplication, là où une
     * distance se divise. Affichage seulement : les seuils restent au kilomètre.
     */
    fun rate(ctx: Context, perKm: Double): Double =
        if (country(ctx) == "GB") perKm * 1.609344 else perKm

    /** « 3.15€/km », « £3.24/mi ». Prend un taux PAR KILOMÈTRE. */
    fun perDistance(ctx: Context, perKm: Double): String =
        money(ctx, rate(ctx, perKm), 2) + "/" + distanceUnit(ctx)

    /** « 5.4km », « 3.4mi ». */
    fun distanceText(ctx: Context, km: Double): String =
        String.format(java.util.Locale.US, "%.1f", distance(ctx, km)) + distanceUnit(ctx)

    /**
     * Tarif de la course. Rond tant qu'il est rond.
     *
     * Mirror de `striveFareText` côté iOS, et pour la même raison : dès que
     * « Retirer le carburant du prix » est actif, le net tombe sur des centimes,
     * et un `%.0f` les effaçait — la déduction était calculée, poussée, reçue,
     * puis gommée au dernier pixel.
     */
    fun fare(ctx: Context, value: Double): String {
        val rounded = Math.round(value * 100) / 100.0
        return money(ctx, rounded, if (rounded == Math.floor(rounded)) 0 else 2)
    }
}

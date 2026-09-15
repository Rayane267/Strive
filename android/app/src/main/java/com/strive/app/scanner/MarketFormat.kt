package com.strive.scanner

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
    private const val KEY_CURRENCY = "marketCurrency"

    /** Caches mémoire — évitent de relire les préférences à chaque frame de la bulle. */
    private var cachedCountry: String? = null
    private var cachedCurrency: String? = null

    /**
     * Le marché, en deux valeurs qui ne servent PAS à la même chose.
     *
     * `country` est du calcul : le parser s'en sert pour les miles et les
     * adresses britanniques, le géocodeur pour restreindre sa recherche.
     * `currency` est de l'affichage, et rien d'autre.
     *
     * Écrits ensemble, en un appel : deux setters, c'est deux moments où l'un
     * part sans l'autre. Mirror de `ScanBridge.setMarket` côté iOS.
     */
    fun setMarket(ctx: Context, country: String, currency: String) {
        ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_COUNTRY, country)
            .putString(KEY_CURRENCY, currency)
            .apply()
        cachedCountry = country
        cachedCurrency = currency
        // Les deux autres consommateurs du pays vivent leur propre vie : le
        // parser s'en sert pour les miles, le géocodeur pour restreindre sa
        // recherche. On les tient à jour d'ici, pour n'avoir qu'un point d'entrée.
        OcrParser.marketCountry = country
        TomTomService.marketCountry = country
    }

    /** Le pays ÉCRIT, ou `null` si le chauffeur n'en a encore jamais poussé un. */
    private fun storedCountry(ctx: Context): String? =
        ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_COUNTRY, null)
            ?.takeIf { it.isNotEmpty() }

    fun country(ctx: Context): String {
        cachedCountry?.let { return it }
        val c = storedCountry(ctx) ?: "FR"
        cachedCountry = c
        return c
    }

    /**
     * Rend au parser et au géocodeur le pays qu'ils ont perdu.
     *
     * `OcrParser.marketCountry` et `TomTomService.marketCountry` sont des
     * STATIQUES, donc liées au processus. La bulle, elle, tourne dans un service
     * de premier plan qu'Android relance sans que JS ait jamais démarré — c'est
     * même la raison d'être de ces préférences. Les statiques repartaient alors
     * à leurs valeurs par défaut : le parser relisait des kilomètres là où le
     * chauffeur voit des miles, et TomTom réinterrogeait les treize marchés avec
     * des libellés français. Un chauffeur londonien se retrouvait avec une
     * « Victoria Street » parisienne après un simple redémarrage système, sans
     * rien avoir fait.
     *
     * La préférence, elle, a traversé. On la relit au démarrage du service, ce
     * que l'iOS obtient gratuitement en lisant son App Group à chaque appel.
     *
     * Sans pays écrit, on ne pose RIEN : les valeurs par défaut des deux
     * statiques disent « je ne sais pas » — treize pays côté géocodeur — et un
     * « FR » inventé vaudrait moins que cet aveu.
     */
    fun hydrate(ctx: Context) {
        val c = storedCountry(ctx) ?: return
        cachedCountry = c
        OcrParser.marketCountry = c
        TomTomService.marketCountry = c
    }

    /**
     * « EUR », « CHF » ou « GBP » — ce que le chauffeur a choisi.
     *
     * L'affichage se lisait sur le PAYS, ce qui obligeait à énumérer les pays de
     * chaque monnaie — quatre pour le seul euro — pour retrouver un caractère
     * que la devise donne directement. La déduction tombait juste aujourd'hui et
     * n'attendait qu'un septième marché pour se tromper, en silence, sur le
     * premier chiffre que le chauffeur regarde.
     */
    fun currency(ctx: Context): String {
        cachedCurrency?.let { return it }
        val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        // LE REPLI SUR LE PAYS EST UNE MIGRATION, PAS UN RESTE. `marketCurrency`
        // n'existe que depuis `setMarket` : les installations déjà en service
        // n'ont que le pays, et la bulle tourne sans que JS ait forcément
        // redémarré après la mise à jour. Retomber sur l'euro aurait rendu des
        // « € » et des kilomètres à un chauffeur britannique dont le pays était
        // écrit juste à côté. Le pays porte la devise sans ambiguïté — c'est la
        // déduction inverse qui n'est pas sûre.
        val c = prefs.getString(KEY_CURRENCY, null)?.takeIf { it.isNotEmpty() }
            ?: when (prefs.getString(KEY_COUNTRY, null)) {
                "GB" -> "GBP"
                "CH" -> "CHF"
                else -> "EUR"
            }
        cachedCurrency = c
        return c
    }

    /** « € », « CHF » ou « £ ». */
    fun symbol(ctx: Context): String = when (currency(ctx)) {
        "GBP" -> "£"
        "CHF" -> "CHF"
        else -> "€"
    }

    /** « km » partout, « mi » au Royaume-Uni. */
    fun distanceUnit(ctx: Context): String = if (currency(ctx) == "GBP") "mi" else "km"

    /**
     * Distance ramenée à l'unité du marché.
     *
     * Le scanner rend toujours des kilomètres — c'est ce que stocke
     * `rides.distance_km`, et les bornes de plausibilité raisonnent dessus. La
     * conversion n'a lieu qu'ici, au dernier pixel.
     */
    fun distance(ctx: Context, km: Double): Double =
        if (currency(ctx) == "GBP") km / 1.609344 else km

    /**
     * La livre se pose AVANT le nombre, l'euro et le franc après.
     *
     * S'y tromper suffit à faire lire le prix comme une traduction automatique,
     * et c'est le premier chiffre que le chauffeur regarde.
     */
    /**
     * La virgule décimale suit la LANGUE, le symbole suit le MARCHÉ.
     *
     * `Locale.US` écrit toujours un point. Un chauffeur français lisait donc
     * « 19.61€ » dans la bulle et « 19,61 € » dans l'app, pour la même course.
     * Les deux réglages se choisissent séparément et n'ont aucune raison de se
     * suivre : un Londonien peut lire l'app en français.
     */
    fun decimalSeparator(ctx: Context): String {
        val lang = ctx.applicationContext
            .getSharedPreferences(FloatingBubbleService.LANG_PREFS, Context.MODE_PRIVATE)
            .getString(FloatingBubbleService.LANG_KEY, null)
        return if (lang != null && lang.startsWith("en")) "." else ","
    }

    fun money(ctx: Context, value: Double, decimals: Int = 0): String {
        val s = String.format(java.util.Locale.US, "%.${decimals}f", value)
            .replace(".", decimalSeparator(ctx))
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
        if (currency(ctx) == "GBP") perKm * 1.609344 else perKm

    /** « 3.15€/km », « £3.24/mi ». Prend un taux PAR KILOMÈTRE. */
    fun perDistance(ctx: Context, perKm: Double): String =
        money(ctx, rate(ctx, perKm), 2) + "/" + distanceUnit(ctx)

    /** « 5.4km », « 3.4mi ». */
    fun distanceText(ctx: Context, km: Double): String =
        String.format(java.util.Locale.US, "%.1f", distance(ctx, km))
            .replace(".", decimalSeparator(ctx)) + distanceUnit(ctx)

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

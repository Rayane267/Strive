package com.strive.field

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.View
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Le champ lumineux de `ScreenField`, dessiné par Android lui-même.
 *
 * Mêmes couleurs, même géométrie qu'iOS : la nappe `FIELD_TOP` → `FIELD_BOTTOM`
 * et la traînée verte du coin haut droit. Ce qui change, c'est l'outil. Sur
 * Android, deux `LinearGradient` superposés sont chacun arrondis à 8 bits AVANT
 * d'être mélangés : une pente sombre d'une trentaine de niveaux sur toute la
 * hauteur sort en bandes, et le tramage de Skia les remplace par un quadrillage.
 * Ici, chaque pixel est calculé en flottant — nappe et traînée mélangées — puis
 * arrondi UNE fois, avec un grain triangulaire de ±1 niveau, le même sur les
 * trois canaux : ni palier, ni motif, ni tache colorée.
 *
 * Dessiné à la taille exacte de la vue, donc de l'écran du téléphone, et refait
 * si elle change (pliable, écran partagé). Le calcul tourne hors du fil
 * principal ; en attendant, le `FIELD_TOP` du conteneur de l'écran est visible.
 *
 * `fade` : le fondu au-dessus de la capsule d'onglets. Il porte la couleur EXACTE
 * du champ à l'endroit où il se pose — le bas de l'écran —, avec une opacité qui
 * monte : là où rien ne défile, il est invisible ; sur une carte, il l'éteint
 * dans le fond.
 */
class StriveFieldView(context: Context, private val fade: Boolean) : View(context) {

    /** Fondu : hauteur de la rampe au-dessus du haut de la capsule, en px. */
    var fadeLengthPx = 0
        set(value) {
            if (field == value) return
            field = value
            schedule()
        }

    private var bitmap: Bitmap? = null
    private var pendingKey: String? = null

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        schedule()
    }

    override fun onDraw(canvas: Canvas) {
        bitmap?.let { canvas.drawBitmap(it, 0f, 0f, null) }
    }

    private fun schedule() {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return
        // Clavier ouvert : l'écran rétrécit (adjustResize), le champ ne doit pas
        // se tasser — sur iOS, le clavier le recouvre sans le toucher. Le champ
        // plus haut déjà dessiné reste, coupé en bas.
        val current = bitmap
        if (!fade && current != null && current.width == w && current.height >= h) return
        val rootH = if (fade) max(rootView.height, h) else h
        val fadeLen = if (fade) fadeLengthPx else -1
        val key = "$w:$h:$rootH:$fadeLen"
        if (key == pendingKey) return
        pendingKey = key
        FieldRenderer.render(key, w, h, rootH, fadeLen) { bmp ->
            if (pendingKey == key) {
                bitmap = bmp
                invalidate()
            }
        }
    }
}

internal object FieldRenderer {

    // Miroir de src/theme/field.ts (FIELD_TOP #070C09, FIELD_BOTTOM #12291A).
    private const val TOP_R = 7f
    private const val TOP_G = 12f
    private const val TOP_B = 9f
    private const val BOT_R = 18f
    private const val BOT_G = 41f
    private const val BOT_B = 26f

    // Miroir de la traînée de src/components/ScreenField.tsx :
    // rgba(0,230,118) 0.10 → 0.025 (à 40 %) → 0, de (0.92, 0) à (0.08, 0.78).
    // En pixels et prolongée au-delà des bornes, comme la dessine
    // react-native-linear-gradient sur iOS (BVLinearGradientLayer).
    private const val STREAK_G = 230f
    private const val STREAK_B = 118f
    private const val STREAK_X0 = 0.92f
    private const val STREAK_X1 = 0.08f
    private const val STREAK_Y1 = 0.78f


    private const val INV_24 = 1f / (1 shl 24)

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** Trois tailles au plus : le champ (≈ 10 Mo à 1080×2424), un fondu, et une
     *  marge pour une rotation ou un écran plié. */
    private val cache = object : LinkedHashMap<String, Bitmap>(4, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?) = size > 3
    }

    fun render(key: String, w: Int, h: Int, rootH: Int, fadeLen: Int, onReady: (Bitmap) -> Unit) {
        synchronized(cache) { cache[key] }?.let { onReady(it); return }
        executor.execute {
            val bmp = synchronized(cache) { cache[key] }
                ?: draw(w, h, rootH, fadeLen).also { synchronized(cache) { cache[key] = it } }
            main.post { onReady(bmp) }
        }
    }

    private fun streakAlpha(t: Float): Float = when {
        t <= 0f -> 0.10f
        t < 0.4f -> 0.10f + (0.025f - 0.10f) * (t / 0.4f)
        t < 1f -> 0.025f * (1f - (t - 0.4f) / 0.6f)
        else -> 0f
    }

    /** Montée douce de 0 à 100 % sur la rampe, puis OPAQUE sous la capsule et
     *  jusqu'au bas de l'écran. L'ancienne courbe plafonnait à 85 puis 97 % :
     *  sur ce fond presque noir, un texte blanc à 10 % restait lisible sous la
     *  capsule et transparaissait dans sa partie haute (Profil, 2026-10-21). */
    private fun fadeAlpha(y: Float, fadeLen: Int): Float {
        if (y >= fadeLen) return 1f
        val s = y / fadeLen
        return s * s * (3f - 2f * s)
    }

    private fun quantize(c: Float): Int {
        val i = (c + 0.5f).toInt()
        return if (i < 0) 0 else if (i > 255) 255 else i
    }

    /**
     * `fadeLen < 0` : le champ, sur toute la vue. Sinon le fondu : une bande
     * posée au bas d'un écran haut de `rootH`.
     */
    private fun draw(w: Int, h: Int, rootH: Int, fadeLen: Int): Bitmap {
        val fade = fadeLen >= 0
        val fieldH = if (fade) rootH else h
        val top = if (fade) rootH - h else 0
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val row = IntArray(w)

        // Axe de la traînée, en pixels du champ.
        val sx = STREAK_X0 * w
        val dx = (STREAK_X1 - STREAK_X0) * w
        val dy = STREAK_Y1 * fieldH
        val len2 = dx * dx + dy * dy
        val tPerX = dx / len2

        var seed = 0x2545F491
        for (y in 0 until h) {
            val py = top + y + 0.5f
            val v = py / fieldH
            val baseR = TOP_R + (BOT_R - TOP_R) * v
            val baseG = TOP_G + (BOT_G - TOP_G) * v
            val baseB = TOP_B + (BOT_B - TOP_B) * v
            // t = ((x - sx)·dx + py·dy) / len2, linéaire en x sur la ligne.
            val tRow = (py * dy - sx * dx) / len2
            val alpha = if (fade) fadeAlpha(y + 0.5f, fadeLen) * 255f else -1f

            for (x in 0 until w) {
                val a = streakAlpha(tRow + (x + 0.5f) * tPerX)
                val r = baseR * (1f - a)
                val g = baseG + (STREAK_G - baseG) * a
                val b = baseB + (STREAK_B - baseB) * a

                // Grain triangulaire : somme de deux tirages uniformes, ±1 niveau.
                seed = seed xor (seed shl 13); seed = seed xor (seed ushr 17); seed = seed xor (seed shl 5)
                val n1 = (seed ushr 8) * INV_24
                seed = seed xor (seed shl 13); seed = seed xor (seed ushr 17); seed = seed xor (seed shl 5)
                val n = n1 + (seed ushr 8) * INV_24 - 1f

                // Le champ reste opaque : le grain ne touche que l'opacité du
                // fondu, et jamais sa partie pleine, qui doit rester à 255.
                val ai = if (!fade || alpha >= 255f) 255 else quantize(alpha + n)
                row[x] = (ai shl 24) or
                    (quantize(r + n) shl 16) or
                    (quantize(g + n) shl 8) or
                    quantize(b + n)
            }
            bmp.setPixels(row, 0, w, 0, y, w, 1)
        }
        return bmp
    }
}

package com.strive.field

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import java.util.concurrent.Executors
import kotlin.math.sqrt

/**
 * Une pile de dégradés (linéaires ou ronds) dessinée d'un seul tenant — l'outil du champ
 * (`StriveFieldView`) ouvert à des couches données par le JS.
 *
 * Sert au fond de l'écran de connexion (`AndroidAuthField.tsx`) : trois couches
 * superposées — la lueur, le balayage, le voile — que trois `LinearGradient`
 * arrondissaient chacun à 8 bits avant de les mélanger. Sur un fond aussi
 * sombre, ça sortait en traînées et en bandes. Ici chaque pixel mélange toutes
 * les couches en flottant, puis n'est arrondi qu'une fois, avec le même grain
 * triangulaire de ±1 niveau, identique sur les trois canaux.
 *
 * Géométrie de react-native-linear-gradient, comme sur iOS : `start`/`end` en
 * fractions de la vue, convertis en pixels, couleurs prolongées au-delà des
 * bornes, interpolation non prémultipliée.
 */
class StriveGradientStackView(context: Context) : View(context) {

    private var layers: List<GradientLayer> = emptyList()
    private var backdrop = Color.BLACK
    private var bitmap: Bitmap? = null
    private var pendingKey: String? = null

    fun setLayers(value: List<GradientLayer>) {
        layers = value
        bitmap = null
        schedule()
    }

    fun setBackdrop(value: Int) {
        backdrop = value
        bitmap = null
        schedule()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        schedule()
    }

    override fun onDraw(canvas: Canvas) {
        bitmap?.let { canvas.drawBitmap(it, 0f, 0f, null) }
    }

    private fun schedule() {
        val w = width
        val h = height
        if (w <= 0 || h <= 0 || layers.isEmpty()) return
        // Même règle que le champ : l'écran qui rétrécit sous le clavier ne
        // tasse pas le fond, il le coupe en bas.
        val current = bitmap
        if (current != null && current.width == w && current.height >= h) return
        val key = "$w:$h:$backdrop:" + layers.joinToString("|") { it.key }
        if (key == pendingKey) return
        pendingKey = key
        val snapshot = layers
        GradientStackRenderer.render(key, w, h, backdrop, snapshot) { bmp ->
            if (pendingKey == key) {
                bitmap = bmp
                invalidate()
            }
        }
    }
}

/** Une couche : couleurs ARGB, positions (0…1), axe en fractions de la vue.
 *  `radial` : (x0, y0) est le centre, (rx, ry) les rayons en fractions de la
 *  largeur et de la hauteur ; la position est la distance normalisée au centre. */
class GradientLayer(
    val colors: IntArray,
    val locations: FloatArray,
    val x0: Float,
    val y0: Float,
    val x1: Float,
    val y1: Float,
    val radial: Boolean = false,
    val rx: Float = 0f,
    val ry: Float = 0f,
) {
    val key: String =
        colors.joinToString(",") + "/" + locations.joinToString(",") +
            "/$x0,$y0,$x1,$y1" + if (radial) "/r$rx,$ry" else ""

    private val r = FloatArray(colors.size) { Color.red(colors[it]).toFloat() }
    private val g = FloatArray(colors.size) { Color.green(colors[it]).toFloat() }
    private val b = FloatArray(colors.size) { Color.blue(colors[it]).toFloat() }
    private val a = FloatArray(colors.size) { Color.alpha(colors[it]) / 255f }

    /** Couleur non prémultipliée à la position `t` de l'axe, dans out[0..3]. */
    fun sample(t: Float, out: FloatArray, o: Int) {
        val last = locations.size - 1
        if (t <= locations[0]) { put(0, 0, 0f, out, o); return }
        if (t >= locations[last]) { put(last, last, 0f, out, o); return }
        var i = 0
        while (i < last - 1 && t >= locations[i + 1]) i++
        val span = locations[i + 1] - locations[i]
        val f = if (span > 0f) (t - locations[i]) / span else 0f
        put(i, i + 1, f, out, o)
    }

    private fun put(i: Int, j: Int, f: Float, out: FloatArray, o: Int) {
        out[o] = r[i] + (r[j] - r[i]) * f
        out[o + 1] = g[i] + (g[j] - g[i]) * f
        out[o + 2] = b[i] + (b[j] - b[i]) * f
        out[o + 3] = a[i] + (a[j] - a[i]) * f
    }
}

internal object GradientStackRenderer {

    private const val INV_24 = 1f / (1 shl 24)

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** Un seul écran s'en sert : une taille en mémoire suffit. */
    private val cache = object : LinkedHashMap<String, Bitmap>(2, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?) = size > 1
    }

    fun render(
        key: String,
        w: Int,
        h: Int,
        backdrop: Int,
        layers: List<GradientLayer>,
        onReady: (Bitmap) -> Unit,
    ) {
        synchronized(cache) { cache[key] }?.let { onReady(it); return }
        executor.execute {
            val bmp = synchronized(cache) { cache[key] }
                ?: draw(w, h, backdrop, layers).also { synchronized(cache) { cache[key] = it } }
            main.post { onReady(bmp) }
        }
    }

    private fun quantize(c: Float): Int {
        val i = (c + 0.5f).toInt()
        return if (i < 0) 0 else if (i > 255) 255 else i
    }

    private fun draw(w: Int, h: Int, backdrop: Int, layers: List<GradientLayer>): Bitmap {
        val n = layers.size
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val row = IntArray(w)

        // Axe de chaque couche, en pixels.
        val sx = FloatArray(n) { layers[it].x0 * w }
        val sy = FloatArray(n) { layers[it].y0 * h }
        val dx = FloatArray(n) { (layers[it].x1 - layers[it].x0) * w }
        val dy = FloatArray(n) { (layers[it].y1 - layers[it].y0) * h }
        val len2 = FloatArray(n) { (dx[it] * dx[it] + dy[it] * dy[it]).coerceAtLeast(1e-6f) }
        val radial = BooleanArray(n) { layers[it].radial }
        val invRx = FloatArray(n) { if (radial[it]) 1f / (layers[it].rx * w).coerceAtLeast(1e-3f) else 0f }
        val invRy = FloatArray(n) { if (radial[it]) 1f / (layers[it].ry * h).coerceAtLeast(1e-3f) else 0f }

        // Une couche à axe horizontal ne dépend que de x : sa couleur par colonne
        // se calcule une fois. Axe vertical : une fois par ligne.
        val columns = arrayOfNulls<FloatArray>(n)
        for (k in 0 until n) {
            if (!radial[k] && dy[k] == 0f) {
                val lut = FloatArray(w * 4)
                for (x in 0 until w) {
                    val t = ((x + 0.5f - sx[k]) * dx[k]) / len2[k]
                    layers[k].sample(t, lut, x * 4)
                }
                columns[k] = lut
            }
        }
        val rowColor = FloatArray(n * 4)
        val px = FloatArray(4)

        val bR = Color.red(backdrop).toFloat()
        val bG = Color.green(backdrop).toFloat()
        val bB = Color.blue(backdrop).toFloat()

        var seed = 0x2545F491
        for (y in 0 until h) {
            val py = y + 0.5f
            for (k in 0 until n) {
                if (!radial[k] && dx[k] == 0f && dy[k] != 0f) {
                    layers[k].sample(((py - sy[k]) * dy[k]) / len2[k], rowColor, k * 4)
                }
            }
            for (x in 0 until w) {
                var r = bR
                var g = bG
                var b = bB
                for (k in 0 until n) {
                    val col = columns[k]
                    val src: FloatArray
                    val o: Int
                    if (radial[k]) {
                        val ex = (x + 0.5f - sx[k]) * invRx[k]
                        val ey = (py - sy[k]) * invRy[k]
                        layers[k].sample(sqrt(ex * ex + ey * ey), px, 0)
                        src = px; o = 0
                    } else if (col != null) {
                        src = col; o = x * 4
                    } else if (dx[k] == 0f) {
                        src = rowColor; o = k * 4
                    } else {
                        val t = ((x + 0.5f - sx[k]) * dx[k] + (py - sy[k]) * dy[k]) / len2[k]
                        layers[k].sample(t, px, 0)
                        src = px; o = 0
                    }
                    val a = src[o + 3]
                    r += (src[o] - r) * a
                    g += (src[o + 1] - g) * a
                    b += (src[o + 2] - b) * a
                }

                // Grain triangulaire : somme de deux tirages uniformes, ±1 niveau.
                seed = seed xor (seed shl 13); seed = seed xor (seed ushr 17); seed = seed xor (seed shl 5)
                val n1 = (seed ushr 8) * INV_24
                seed = seed xor (seed shl 13); seed = seed xor (seed ushr 17); seed = seed xor (seed shl 5)
                val nz = n1 + (seed ushr 8) * INV_24 - 1f

                row[x] = (255 shl 24) or
                    (quantize(r + nz) shl 16) or
                    (quantize(g + nz) shl 8) or
                    quantize(b + nz)
            }
            bmp.setPixels(row, 0, w, 0, y, w, 1)
        }
        return bmp
    }
}

package com.strive.scanner

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

object GeminiVisionService {

    private const val DIRECT_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

    /** Clé API Gemini directe (dev uniquement — utiliser l'edge function en prod) */
    var apiKey: String = ""

    /** URL de l'edge function Supabase (remplace l'appel direct en prod) */
    var edgeFunctionUrl: String = ""

    /** Clé anon Supabase (header `apikey` requis par PostgREST/edge runtime) */
    var supabaseAnonKey: String = ""

    /** JWT user pour l'edge function durcie (rate-limit + audit par user_id) */
    var supabaseUserJwt: String = ""

    private val useEdgeFunction get() = edgeFunctionUrl.isNotEmpty() && supabaseAnonKey.isNotEmpty()

    /** true si Gemini est configuré (edge function ou clé directe) */
    val isReady get() = useEdgeFunction || apiKey.isNotEmpty()

    /** Hard deadline pour tout l'appel Gemini (incl. encode + write + read). */
    private const val OVERALL_TIMEOUT_MS = 15_000L
    /** Cap sur la taille de la réponse pour éviter une OOM en cas de payload malveillant ou buggé. */
    private const val MAX_RESPONSE_CHARS = 256_000

    fun analyze(bitmap: Bitmap, callback: (OcrParser.ScanResult?) -> Unit) {
        if (!isReady) { callback(null); return }

        // Wrapper Thread + watchdog : `outputStream.write()` n'a pas de timeout
        // côté HttpURLConnection — un réseau qui se fige peut bloquer le thread
        // indéfiniment. On l'interrompt à 15s pour libérer le scanner.
        val done = AtomicBoolean(false)
        val workerRef = arrayOfNulls<Thread>(1)
        val watchdog = Handler(Looper.getMainLooper())
        val timeoutRunnable = Runnable {
            if (done.compareAndSet(false, true)) {
                workerRef[0]?.interrupt()
                callback(null)
            }
        }
        watchdog.postDelayed(timeoutRunnable, OVERALL_TIMEOUT_MS)

        val worker = Thread {
            val result: OcrParser.ScanResult? = try {
                val base64 = bitmapToBase64(bitmap)
                val raw = callGemini(base64)
                parseResponse(raw)
            } catch (_: InterruptedException) {
                null
            } catch (_: Exception) {
                null
            }
            if (done.compareAndSet(false, true)) {
                watchdog.removeCallbacks(timeoutRunnable)
                callback(result)
            }
        }
        workerRef[0] = worker
        worker.start()
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    /** Encode public — utilisé pour pousser l'image au JS (fallback Gemini côté JS). */
    fun encodeForBridge(bitmap: Bitmap): String = bitmapToBase64(bitmap)

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val maxW = 512
        val scaled = if (bitmap.width > maxW) {
            val r = maxW.toFloat() / bitmap.width
            Bitmap.createScaledBitmap(bitmap, maxW, (bitmap.height * r).toInt(), true)
        } else bitmap
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 50, out)
        if (scaled !== bitmap) scaled.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun callGemini(base64Image: String): String {
        val conn = if (useEdgeFunction) {
            (URL(edgeFunctionUrl).openConnection() as HttpURLConnection).also {
                // JWT user si dispo (edge function durcie l'exige), sinon anon key.
                val bearer = if (supabaseUserJwt.isNotEmpty()) supabaseUserJwt else supabaseAnonKey
                it.setRequestProperty("Authorization", "Bearer $bearer")
                it.setRequestProperty("apikey", supabaseAnonKey)
            }
        } else {
            URL("$DIRECT_URL?key=$apiKey").openConnection() as HttpURLConnection
        }

        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.connectTimeout = 5_000
        conn.readTimeout = 8_000

        val prompt = """
            Analyse ce screenshot d'application VTC (Uber, Bolt, Heetch ou similaire).
            Extrais les informations de l'offre de course.
            Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni explication :
            {
              "platform": "UBER" ou "BOLT" ou "HEETCH" ou "UNKNOWN",
              "fare": <montant total en euros, chiffre affiché en gros>,
              "distance_km": <distance TOTALE de la course, souvent libellée "Course de X km">,
              "duration_min": <durée totale de la course en minutes ; null si non visible>,
              "pickup_duration_min": <temps d'approche vers le client ; null si non visible>,
              "pickup_distance_km": <distance d'approche vers le client ; null si non visible>,
              "pickup_address": <adresse de DÉPART exacte lue à l'écran ; null si absente>,
              "destination_address": <adresse de DESTINATION exacte lue à l'écran ; null si absente>
            }
            IMPORTANT :
            - distance_km et duration_min concernent la COURSE (trajet client → destination).
            - pickup_* concerne l'APPROCHE (position actuelle → client), typiquement affichée "X min • Y km" ou "à X min (Y km)" sous l'adresse de prise en charge.
            - Ne PAS confondre les deux. La distance de course est presque toujours plus grande que le pickup.
            - pickup_address = la PREMIÈRE adresse affichée en haut ; destination_address = celle EN DESSOUS. Ne confonds jamais une ligne stat ("Course de 11.8 km") avec une adresse.
            - Retourne les valeurs exactes lues à l'écran, ne devine pas.
            Si ce n'est pas un écran d'offre de course VTC, réponds : {"error": "not_a_ride"}
        """.trimIndent()

        val body = JSONObject().apply {
            put("contents", JSONArray().apply {
                put(JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("inline_data", JSONObject().apply {
                                put("mime_type", "image/jpeg")
                                put("data", base64Image)
                            })
                        })
                        put(JSONObject().apply { put("text", prompt) })
                    })
                })
            })
        }

        conn.outputStream.write(body.toString().toByteArray())

        val code = conn.responseCode
        val stream = if (code == 200) conn.inputStream else conn.errorStream
        return stream.bufferedReader().use { reader ->
            val sb = StringBuilder()
            val buf = CharArray(4096)
            var total = 0
            while (total < MAX_RESPONSE_CHARS) {
                val r = reader.read(buf)
                if (r < 0) break
                sb.append(buf, 0, r)
                total += r
            }
            sb.toString()
        }
    }

    private fun parseResponse(json: String): OcrParser.ScanResult? {
        return try {
            val root = JSONObject(json)
            val text = root
                .getJSONArray("candidates")
                .getJSONObject(0)
                .getJSONObject("content")
                .getJSONArray("parts")
                .getJSONObject(0)
                .getString("text")
                .trim()
                .removePrefix("```json").removePrefix("```")
                .removeSuffix("```")
                .trim()

            val data = JSONObject(text)
            if (data.has("error")) return null

            val platform = when (data.optString("platform")) {
                "UBER"   -> OcrParser.Platform.UBER
                "BOLT"   -> OcrParser.Platform.BOLT
                "HEETCH" -> OcrParser.Platform.HEETCH
                else     -> OcrParser.Platform.UNKNOWN
            }

            val fare = data.getDouble("fare")
            val distanceKm = data.getDouble("distance_km")
            val durationMin = if (data.isNull("duration_min")) null
                              else data.optInt("duration_min").takeIf { it > 0 }
            // Approche : mêmes bornes que OcrParser.extractPickupInfo (1–60 min,
            // 0,1–30 km, toujours plus courte que la course). Tout ou rien — une
            // valeur seule fausserait le total appliqué quand includePickup est ON.
            val rawPickupMin = if (data.isNull("pickup_duration_min")) null
                               else data.optInt("pickup_duration_min").takeIf { it in 1..60 }
            val rawPickupKm = if (data.isNull("pickup_distance_km")) null
                              else data.optDouble("pickup_distance_km").takeIf { it in 0.1..30.0 }
            val pickupOk = rawPickupMin != null && rawPickupKm != null && rawPickupKm < distanceKm
            val pickupDurationMin = if (pickupOk) rawPickupMin else null
            val pickupDistanceKm = if (pickupOk) rawPickupKm else null
            // Adresses → alimentent TomTom pour la VRAIE distance (cœur du produit).
            val pickupAddress = data.optString("pickup_address")
                .takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
            val destinationAddress = data.optString("destination_address")
                .takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }

            if (fare < 8 || fare > 200) return null
            if (distanceKm < 0.3 || distanceKm > 500) return null
            // Ratio plausible : rejette les combinaisons aberrantes (distance
            // hallucinée minuscule → €/km démentiel). Mirror JS / iOS.
            val ratio = fare / distanceKm
            if (ratio < 0.2 || ratio > 15.0) return null

            OcrParser.ScanResult(
                platform = platform,
                fare = fare,
                distanceKm = distanceKm,
                durationMin = durationMin,
                pickupDurationMin = pickupDurationMin,
                pickupDistanceKm = pickupDistanceKm,
                pickupAddress = pickupAddress,
                destinationAddress = destinationAddress,
            )
        } catch (e: Exception) {
            null
        }
    }
}

package com.strive.scanner

import android.graphics.Bitmap
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

object GeminiVisionService {

    private const val DIRECT_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

    /** Clé API Gemini directe (dev uniquement — utiliser l'edge function en prod) */
    var apiKey: String = ""

    /** URL de l'edge function Supabase (remplace l'appel direct en prod) */
    var edgeFunctionUrl: String = ""

    /** Clé anon Supabase pour authentifier l'appel à l'edge function */
    var supabaseAnonKey: String = ""

    private val useEdgeFunction get() = edgeFunctionUrl.isNotEmpty() && supabaseAnonKey.isNotEmpty()

    /** true si Gemini est configuré (edge function ou clé directe) */
    val isReady get() = useEdgeFunction || apiKey.isNotEmpty()

    fun analyze(bitmap: Bitmap, callback: (OcrParser.ScanResult?) -> Unit) {
        if (!isReady) { callback(null); return }

        Thread {
            try {
                val base64 = bitmapToBase64(bitmap)
                val raw = callGemini(base64)
                callback(parseResponse(raw))
            } catch (e: Exception) {
                callback(null)
            }
        }.start()
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

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
                it.setRequestProperty("Authorization", "Bearer $supabaseAnonKey")
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
              "fare": <montant en euros, ex: 12.50>,
              "distance_km": <distance en km, ex: 8.3>,
              "duration_min": <durée en minutes ou null si non visible>
            }
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
        return stream.bufferedReader().readText()
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

            if (fare < 3 || fare > 200) return null
            if (distanceKm < 0.3 || distanceKm > 150) return null

            OcrParser.ScanResult(platform, fare, distanceKm, durationMin)
        } catch (e: Exception) {
            null
        }
    }
}

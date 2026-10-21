package com.strive.scanner

import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Écrit la course en base DÈS LE SCAN, sans attendre le JS. Mirror de
 * `RideUploader` (iOS, ScanProcessor.swift) : même requête, même corps.
 *
 * La bulle tourne dans un service de premier plan ; le JS, lui, peut être
 * démonté (app balayée, Dashboard jamais ouvert). La course n'arrivait alors en
 * base qu'à la réouverture de l'app : ni historique ni stats entre-temps.
 *
 * Ce que cet envoi N'EST PAS : la garantie de non-perte. Elle tient au journal
 * `strive_pending_scans`, dont une entrée ne sort que sur `ackScan`, rejoué à
 * chaque retour au premier plan ; le JS retombe alors sur la course déjà écrite
 * et la traite comme un succès. Un échec ici n'a aucune conséquence.
 *
 * Pas de session de fond comme sur iOS : le service de premier plan garde le
 * process en vie, et le réseau vient de servir à TomTom. Quelques tentatives
 * espacées couvrent une coupure passagère ; au-delà, le journal prend le relais.
 */
object RideUploader {
    private val RETRY_DELAYS_MS = longArrayOf(0L, 5_000L, 30_000L)

    fun upload(
        result: OcrParser.ScanResult,
        rideId: String,
        scanTs: Double,
        totalDistanceKm: Double,
        totalDurationMin: Int,
        hourlyRate: Double,
        kmRate: Double,
        fuelCostPerKm: Double,
    ) {
        val anonKey = GeminiVisionService.supabaseAnonKey
        val jwt = GeminiVisionService.supabaseUserJwt
        val restRoot = restRoot(GeminiVisionService.edgeFunctionUrl) ?: return
        if (anonKey.isEmpty() || jwt.isEmpty()) return
        val uid = userId(jwt) ?: return

        val body = JSONObject()
            // L'id frappé au scan : cet envoi et le rejeu du journal réinsèrent la
            // même ligne, écartée sur la clé primaire.
            .put("id", rideId)
            .put("user_id", uid)
            // Même normalisation que `createRide` : la colonne n'accepte pas UNKNOWN.
            .put("platform", if (result.platform == OcrParser.Platform.UNKNOWN) "UBER" else result.platform.name)
            .put("status", "PENDING")
            // Tarif BRUT (le prix net de carburant n'est qu'un affichage).
            .put("fare_estimated", result.fare)
            .put("distance_km", totalDistanceKm)
            .put("duration_min", totalDurationMin)
            .put("hourly_rate", hourlyRate)
            .put("km_rate", kmRate)
            .put("scan_ts", scanTs)
            // Heure du SCAN, pas de l'insertion : la course atterrit au jour où
            // elle a été scannée, quel que soit le chemin qui l'écrit.
            .put("created_at", isoUtc(scanTs))
        // Carburant figé au scan ; 0 = consommation non renseignée, colonnes à NULL.
        if (fuelCostPerKm > 0) {
            val fuelCost = Math.round(fuelCostPerKm * totalDistanceKm * 100) / 100.0
            body.put("fuel_cost", fuelCost)
            body.put("net_profit", Math.round((result.fare - fuelCost) * 100) / 100.0)
        }
        result.pickupAddress?.trim()?.takeIf { it.isNotEmpty() }?.let { body.put("pickup_address", it) }
        result.destinationAddress?.trim()?.takeIf { it.isNotEmpty() }?.let { body.put("destination_address", it) }
        if (result.pickupLat != null && result.pickupLon != null) {
            body.put("pickup_lat", result.pickupLat).put("pickup_lon", result.pickupLon)
        }
        if (result.destLat != null && result.destLon != null) {
            body.put("dest_lat", result.destLat).put("dest_lon", result.destLon)
        }

        // `on_conflict=id` + `resolution=ignore-duplicates` : un upsert qui ne
        // fait rien si la course existe déjà (rejeu, retentative).
        val url = "$restRoot/rest/v1/rides?on_conflict=id"
        val payload = body.toString().toByteArray(Charsets.UTF_8)
        Thread { send(url, anonKey, jwt, payload) }.start()
    }

    private fun send(url: String, anonKey: String, jwt: String, payload: ByteArray) {
        for (delay in RETRY_DELAYS_MS) {
            if (delay > 0) Thread.sleep(delay)
            val code = try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("apikey", anonKey)
                    setRequestProperty("Authorization", "Bearer $jwt")
                    setRequestProperty("Content-Type", "application/json")
                    // Rien à relire : l'app rechargera la liste depuis la base.
                    setRequestProperty("Prefer", "return=minimal,resolution=ignore-duplicates")
                }
                try {
                    conn.outputStream.use { it.write(payload) }
                    conn.responseCode
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                -1
            }
            // 2xx : écrite, ou déjà là. 4xx : jeton périmé ou refus du serveur
            // (quota…), réessayer n'y changerait rien. Le journal rattrape.
            if (code in 200..499) return
        }
    }

    /** Racine du projet Supabase, déduite de l'URL de l'edge function
     *  (`https://<ref>.supabase.co/functions/v1/gemini-proxy`). Mirror iOS
     *  (`setGeminiConfig` → `supabaseRestUrl`). */
    private fun restRoot(edgeUrl: String): String? = runCatching {
        val u = URL(edgeUrl)
        if (u.host.isNullOrEmpty()) null
        else "${u.protocol}://${u.host}" + (if (u.port != -1) ":${u.port}" else "")
    }.getOrNull()

    /** `sub` du JWT Supabase = id de l'utilisateur. Mirror iOS. */
    private fun userId(jwt: String): String? = runCatching {
        val part = jwt.split(".").getOrNull(1) ?: return null
        val json = String(Base64.decode(part, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP), Charsets.UTF_8)
        JSONObject(json).optString("sub").ifEmpty { null }
    }.getOrNull()

    private fun isoUtc(epochSec: Double): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date((epochSec * 1000).toLong()))
}

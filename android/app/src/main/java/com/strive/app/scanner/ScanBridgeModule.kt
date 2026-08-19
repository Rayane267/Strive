package com.strive.scanner

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject

class ScanBridgeModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    override fun getName() = "ScanBridge"

    /**
     * Version réelle du package (versionName/versionCode du build installé) —
     * exposée au JS pour l'email support et le release Sentry. Évite les
     * versions hardcodées qui dérivent à chaque release.
     */
    override fun getConstants(): Map<String, Any> {
        return try {
            val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION") info.versionCode.toLong()
            }
            mapOf(
                "appVersion" to (info.versionName ?: ""),
                "buildNumber" to code.toString(),
            )
        } catch (e: Exception) {
            mapOf("appVersion" to "", "buildNumber" to "")
        }
    }

    private var mediaProjectionPromise: Promise? = null

    // ─── JS → Native ──────────────────────────────────────────────────────────────

    @ReactMethod
    fun startScanner(promise: Promise) {
        val ctx = reactContext.applicationContext

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            promise.reject("PERMISSION_DENIED", "SYSTEM_ALERT_WINDOW non accordée")
            return
        }

        if (!isAccessibilityServiceEnabled(ctx)) {
            promise.reject("PERMISSION_DENIED", "Service d'accessibilité non activé")
            return
        }

        // Android < 11 : vérifie que le token MediaProjection est disponible
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R &&
            StriveAccessibilityService.mediaProjection == null) {
            promise.reject("PERMISSION_DENIED", "Capture d'écran non autorisée")
            return
        }

        val intent = Intent(ctx, FloatingBubbleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun stopScanner(promise: Promise) {
        val ctx = reactContext.applicationContext
        ctx.stopService(Intent(ctx, FloatingBubbleService::class.java))
        promise.resolve(null)
    }

    @ReactMethod
    fun openOverlaySettings() {
        val ctx = reactContext.applicationContext
        val overlayOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
        if (overlayOk && StriveAccessibilityService.instance == null) {
            ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            return
        }
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${ctx.packageName}"))
                .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        )
    }

    @ReactMethod
    fun isScannerRunning(promise: Promise) {
        promise.resolve(FloatingBubbleService.instance != null)
    }

    // ─── Permissions ──────────────────────────────────────────────────────────────

    /** Retourne l'état complet des permissions nécessaires selon la version Android */
    @ReactMethod
    fun checkPermissions(promise: Promise) {
        val ctx = reactContext.applicationContext
        val overlayOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
        val accessibilityOk = isAccessibilityServiceEnabled(ctx)
        // Android < 11 a besoin d'un token MediaProjection pour capturer l'écran
        val needsMediaProjection = Build.VERSION.SDK_INT < Build.VERSION_CODES.R
        val mediaProjectionGranted = StriveAccessibilityService.mediaProjection != null

        Arguments.createMap().apply {
            putBoolean("overlay", overlayOk)
            putBoolean("accessibility", accessibilityOk)
            putBoolean("needsMediaProjection", needsMediaProjection)
            putBoolean("mediaProjectionGranted", mediaProjectionGranted)
        }.also { promise.resolve(it) }
    }

    @ReactMethod
    fun openOverlayPermissionSettings() {
        val ctx = reactContext.applicationContext
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${ctx.packageName}"))
                .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        )
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val ctx = reactContext.applicationContext
        ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    /**
     * Lance le dialog système de capture d'écran (MediaProjection).
     * Nécessaire uniquement sur Android < 11 (API < 30).
     * Sur Android 11+, résout immédiatement (AccessibilityService suffit).
     */
    @ReactMethod
    fun requestMediaProjectionPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            promise.resolve(null); return
        }
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "Activité non disponible"); return
        }
        mediaProjectionPromise = promise
        val mgr = reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
            as MediaProjectionManager
        activity.startActivityForResult(
            mgr.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION
        )
    }

    // ─── ActivityEventListener : reçoit la réponse du dialog MediaProjection ─────

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_MEDIA_PROJECTION) return
        val promise = mediaProjectionPromise ?: return
        mediaProjectionPromise = null

        if (resultCode == Activity.RESULT_OK && data != null) {
            try {
                val mgr = reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                    as MediaProjectionManager
                StriveAccessibilityService.mediaProjection = mgr.getMediaProjection(resultCode, data)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERROR", e.message ?: "Erreur inconnue")
            }
        } else {
            promise.reject("CANCELLED", "Capture d'écran refusée par l'utilisateur")
        }
    }

    override fun onNewIntent(intent: Intent) {}

    // ─── Verdict ─────────────────────────────────────────────────────────────────

    @ReactMethod
    fun showVerdict(level: Int) {
        FloatingBubbleService.instance?.updateVerdict(level)
    }

    /** Configure l'edge function Supabase comme proxy Gemini (recommandé en prod) */
    @ReactMethod
    fun setGeminiConfig(edgeUrl: String, supabaseAnonKey: String) {
        GeminiVisionService.edgeFunctionUrl = edgeUrl
        GeminiVisionService.supabaseAnonKey = supabaseAnonKey
    }

    /** JWT user — requis par l'edge function durcie (rate-limit + audit). */
    @ReactMethod
    fun setSupabaseUserJwt(jwt: String) {
        GeminiVisionService.supabaseUserJwt = jwt
    }

    /** Applique la configuration de parsing VTC depuis Supabase (remote config) */
    @ReactMethod
    fun setParserConfig(configJson: String) {
        OcrParser.updateConfig(configJson)
    }

    @ReactMethod
    fun updateDuration(minutes: Int) {
        FloatingBubbleService.instance?.updateDuration(minutes)
    }

    @ReactMethod
    fun updateMetrics(hourlyRate: Double, kmRate: Double, durationMin: Int, distanceKm: Double) {
        FloatingBubbleService.instance?.updateMetrics(hourlyRate, kmRate, durationMin, distanceKm)
    }

    /** Finalise l'affichage bulle avec les valeurs TomTom (appelé après réponse TomTom ou fallback). */
    @ReactMethod
    fun finalizeScan(hourlyRate: Double, kmRate: Double, durationMin: Int, distanceKm: Double, verdictLevel: Int) {
        FloatingBubbleService.instance?.finalizeScan(hourlyRate, kmRate, durationMin, distanceKm, verdictLevel)
    }

    /** Préférences utilisateur — pilotent le calcul initial affiché par la bulle */
    @ReactMethod
    fun setPreferences(includePickup: Boolean) {
        FloatingBubbleService.includePickup = includePickup
    }

    /** Seuils verdict utilisateur synchronisés au natif (utilisés pendant TomTom). */
    @ReactMethod
    fun setThresholds(minHourlyRate: Double, minKmRate: Double) {
        FloatingBubbleService.minHourlyRate = minHourlyRate
        FloatingBubbleService.minKmRate = minKmRate
    }

    /** Affichage du prix net de carburant dans la bulle. `fuelCostPerKm` arrive
     *  pré-calculé du JS (conso × prix du jour) : le natif n'a ni le type de
     *  carburant ni le tarif à la pompe. Affichage seul — verdict, €/h, €/km et
     *  tarif enregistré restent bruts (cf. computeMetrics). Mirror iOS. */
    @ReactMethod
    fun setFuelDeduction(enabled: Boolean, fuelCostPerKm: Double) {
        FloatingBubbleService.deductFuel = enabled
        FloatingBubbleService.fuelCostPerKm = fuelCostPerKm
    }

    /** Langue de l'app (fr/en) pour les strings natives : la bulle et les
     *  notifications doivent suivre le choix fait DANS Strive et pas la locale du
     *  téléphone. Mirror iOS (clé `appLanguage` de l'App Group). */
    @ReactMethod
    fun setAppLanguage(lang: String) {
        FloatingBubbleService.setAppLanguage(reactContext, lang)
    }

    /** Clé TomTom — permet au foreground service de géocoder sans dépendre du JS. */
    @ReactMethod
    fun setTomTomApiKey(key: String) {
        TomTomService.apiKey = key
    }

    /** Purge le cache de géocodage local (adresses = PII). Appelé par le JS au
     *  logout et après suppression de compte — l'effacement RGPD couvre aussi le
     *  cache sur l'appareil, hors de portée de la RPC serveur delete_account. */
    @ReactMethod
    fun clearGeocodeCache() {
        GeocodeCache.clear()
    }

    /** KPI de session du jour poussés par le JS (gains, €/h, km, minutes en
     *  ligne) → affichés dans la notification persistante du foreground service.
     *  Équivalent Android du tableau de bord Live Activity iOS (updateSessionKPI). */
    @ReactMethod
    fun updateSessionKPI(payload: ReadableMap) {
        FloatingBubbleService.updateSessionKpi(
            todayEarnings = if (payload.hasKey("todayEarnings")) payload.getDouble("todayEarnings") else 0.0,
            todayHourlyRate = if (payload.hasKey("todayHourlyRate")) payload.getDouble("todayHourlyRate") else 0.0,
            todayKm = if (payload.hasKey("todayKm")) payload.getDouble("todayKm") else 0.0,
            onlineMinutes = if (payload.hasKey("onlineMinutes")) payload.getInt("onlineMinutes") else 0,
        )
    }

    /** Vidange du buffer de décisions Accepter/Refuser vers le JS — appelée à
     *  l'abonnement onRideDecision (couvre le cas où la décision a été tapée alors
     *  que le process RN était mort). Idempotent : si déjà émise en direct,
     *  applyRideDecision côté JS retague la même course sans effet de bord. */
    @ReactMethod
    fun drainRideDecisions() {
        val prefs = reactContext.applicationContext
            .getSharedPreferences(DECISIONS_PREFS, Context.MODE_PRIVATE)
        val arr = try { JSONArray(prefs.getString(DECISIONS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            emit("onRideDecision", Arguments.createMap().apply {
                putDouble("scanTs", o.getDouble("scanTs"))
                putString("status", o.getString("status"))
            })
        }
        prefs.edit().remove(DECISIONS_KEY).apply()
    }

    /** Vidange du buffer de scans vers le JS — appelée à l'abonnement
     *  onScanResult. Couvre le scan réalisé par la bulle pendant que le process
     *  RN était mort : sans ça la course était perdue, sans trace. Mirror iOS
     *  (ScanBridgeModule.checkPendingScanResult / pendingScanResults). */
    @ReactMethod
    fun drainPendingScans() {
        val prefs = reactContext.applicationContext
            .getSharedPreferences(SCANS_PREFS, Context.MODE_PRIVATE)
        val arr = try { JSONArray(prefs.getString(SCANS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
        // AUCUNE purge ici : on n'efface qu'entrée par entrée, sur `ackScan`, une
        // fois la course confirmée en base. Purger avant émission perdait tout scan
        // que le JS recevait sans parvenir à l'écrire (réseau coupé, crash).
        // Le rejeu est sans risque : l'index unique (user_id, scan_ts) écarte les
        // doublons côté base.
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            emit("onScanResult", Arguments.createMap().apply {
                putString("qid", o.optString("qid"))
                putString("platform", o.optString("platform", "UNKNOWN"))
                putDouble("fare", o.optDouble("fare", 0.0))
                putDouble("distanceKm", o.optDouble("distanceKm", 0.0))
                if (o.isNull("durationMin")) putNull("durationMin") else putInt("durationMin", o.optInt("durationMin"))
                if (o.isNull("pickupAddress")) putNull("pickupAddress") else putString("pickupAddress", o.optString("pickupAddress"))
                if (o.isNull("destinationAddress")) putNull("destinationAddress") else putString("destinationAddress", o.optString("destinationAddress"))
                if (o.isNull("pickupDurationMin")) putNull("pickupDurationMin") else putInt("pickupDurationMin", o.optInt("pickupDurationMin"))
                if (o.isNull("pickupDistanceKm")) putNull("pickupDistanceKm") else putDouble("pickupDistanceKm", o.optDouble("pickupDistanceKm"))
                // Absents du buffer par conception (PII + poids) — cf. bufferScanResult.
                putNull("imageBase64")
                putNull("debugBlocks")
                putInt("screenHeight", o.optInt("screenHeight", 0))
                if (o.isNull("scanTs")) putNull("scanTs") else putDouble("scanTs", o.optDouble("scanTs"))
            })
        }
    }

    /** Accusé de réception d'un scan : la course est en base (ou définitivement
     *  refusée). Seul mécanisme qui retire une entrée du journal — il n'y a plus
     *  de suppression au bout de N tentatives, donc plus de course détruite en
     *  silence. Tant que le JS n'acquitte pas, l'entrée est rejouée. */
    @ReactMethod
    fun ackScan(qid: String) {
        if (qid.isEmpty()) return
        removeBufferedScan(reactContext.applicationContext, qid)
    }

    /** Vidange du buffer d'échecs vers le JS — appelée à l'abonnement
     *  onScanFailure. Couvre les scans cassés pendant que le process RN était
     *  mort, qui ne laissaient sinon aucune trace. */
    @ReactMethod
    fun drainScanFailures() {
        val prefs = reactContext.applicationContext
            .getSharedPreferences(FAILS_PREFS, Context.MODE_PRIVATE)
        val arr = try { JSONArray(prefs.getString(FAILS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
        prefs.edit().remove(FAILS_KEY).apply()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            emit("onScanFailure", Arguments.createMap().apply {
                putString("reason", o.optString("reason", "other"))
                putString("surface", o.optString("surface", "bubble"))
                if (o.isNull("platform")) putNull("platform") else putString("platform", o.optString("platform"))
                if (o.isNull("detail")) putNull("detail") else putString("detail", o.optString("detail"))
                putDouble("occurredAt", o.optDouble("occurredAt", 0.0))
            })
        }
    }

    /** Quota journalier atteint — si true, la bulle affiche "Quota atteint"
     *  et n'exécute ni OCR ni TomTom au tap. À syncer depuis le Dashboard. */
    @ReactMethod
    fun setQuotaReached(reached: Boolean, isFree: Boolean) {
        FloatingBubbleService.quotaReached = reached
        FloatingBubbleService.isFreeTier = isFree
    }

    /** Session active (chauffeur « en ligne »). Si false, la bulle bloque le
     *  scan et notifie l'utilisateur de démarrer sa session. Mirror iOS
     *  (AnalyzeRideIntent.isSessionOnline). */
    @ReactMethod
    fun setSessionOnline(online: Boolean) {
        FloatingBubbleService.sessionOnline = online
    }

    /** Compteur de scans du jour (autoritatif, poussé par le JS) + limite, pour
     *  que la bulle applique le quota elle-même même si le JS est suspendu.
     *  limite <= 0 = illimité. */
    @ReactMethod
    fun setScanQuota(countToday: Int, limit: Int, resetHour: Int) {
        FloatingBubbleService.scanQuotaLimit = limit
        FloatingBubbleService.quotaResetHour = resetHour
        // Réconciliation NON destructive : le compte DB peut sous-estimer les
        // scans réels (scan effectué hors process JS pas encore inséré). Même
        // jour → max(natif, DB) pour ne pas rendre du quota à tort ; nouveau
        // jour → on fait confiance au compte DB (reset).
        val today = FloatingBubbleService.todayKey()
        if (FloatingBubbleService.scanCountDay != today) {
            FloatingBubbleService.scanCountDay = today
            FloatingBubbleService.scanCountToday = countToday
        } else {
            FloatingBubbleService.scanCountToday =
                maxOf(FloatingBubbleService.scanCountToday, countToday)
        }
    }

// ─── Native → JS (events) ────────────────────────────────────────────────────

    companion object {
        private const val REQUEST_MEDIA_PROJECTION = 1001
        private var moduleInstance: ScanBridgeModule? = null

        /** Buffer des décisions Accepter/Refuser (survit à un process RN mort). */
        const val DECISIONS_PREFS = "strive_ride_decisions"
        const val DECISIONS_KEY = "pending"

        /** Relaie une décision course (Accepter/Refuser) tapée sur la notification
         *  de résultat. Bufferise (SharedPreferences) pour survivre à un process
         *  RN mort, ET émet en direct quand l'app tourne encore (cas fréquent :
         *  foreground service vivant). Le JS draine le buffer à l'abonnement.
         *  Équivalent de l'AppDelegate iOS (appendRideDecision + Darwin notif). */
        fun emitRideDecision(ctx: Context, scanTs: Double, status: String) {
            val prefs = ctx.getSharedPreferences(DECISIONS_PREFS, Context.MODE_PRIVATE)
            val arr = try { JSONArray(prefs.getString(DECISIONS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
            arr.put(JSONObject().put("scanTs", scanTs).put("status", status))
            prefs.edit().putString(DECISIONS_KEY, arr.toString()).apply()
            emit("onRideDecision", Arguments.createMap().apply {
                putDouble("scanTs", scanTs)
                putString("status", status)
            })
        }

        /** Journal durable des scans. Contient TOUT scan produit, remis au JS ou
         *  non, et n'est purgé qu'entrée par entrée via `ackScan` — une fois la
         *  course confirmée en base. C'est la seule file de l'app : la file
         *  hors-ligne AsyncStorage (`@strive_offline_queue`) a été supprimée avec
         *  elle. Survit à un process RN mort, à un crash pendant l'émission et à
         *  une panne Supabase. */
        const val SCANS_PREFS = "strive_pending_scans"
        const val SCANS_KEY = "pending"
        /** Plafond de sécurité : au-delà, l'app n'a pas tourné depuis très
         *  longtemps. On garde les plus récents. Large, parce qu'une entrée n'est
         *  retirée que sur accusé de réception — pas au bout de N tentatives. */
        private const val SCANS_MAX = 200

        fun emitScanResult(
            ctx: Context,
            result: OcrParser.ScanResult,
            imageBase64: String? = null,
            debugBlocks: String? = null,
            screenHeight: Int = 0,
            scanTs: Double = 0.0,
        ) {
            val map = Arguments.createMap().apply {
                putString("platform", result.platform.name)
                putDouble("fare", result.fare)
                putDouble("distanceKm", result.distanceKm)
                if (result.durationMin != null) putInt("durationMin", result.durationMin)
                else putNull("durationMin")
                if (result.pickupAddress != null) putString("pickupAddress", result.pickupAddress)
                else putNull("pickupAddress")
                if (result.destinationAddress != null) putString("destinationAddress", result.destinationAddress)
                else putNull("destinationAddress")
                if (result.pickupDurationMin != null) putInt("pickupDurationMin", result.pickupDurationMin)
                else putNull("pickupDurationMin")
                if (result.pickupDistanceKm != null) putDouble("pickupDistanceKm", result.pickupDistanceKm)
                else putNull("pickupDistanceKm")
                // Image (JPEG compressée, base64) pour fallback Gemini côté JS
                if (imageBase64 != null) putString("imageBase64", imageBase64)
                else putNull("imageBase64")
                // Dump des blocs ML Kit (JSON) — émis en release pour alimenter
                // scan_debug côté JS quand une adresse manque.
                if (debugBlocks != null) putString("debugBlocks", debugBlocks)
                else putNull("debugBlocks")
                // Hauteur image OCR (px) — pour rejouer un cas en fixture.
                putInt("screenHeight", screenHeight)
                // Horodatage du scan (secondes epoch) — corrélation course ↔ décision
                // Accepter/Refuser (DashboardScreen mappe scanTs → ride id). Mirror iOS.
                if (scanTs > 0) putDouble("scanTs", scanTs) else putNull("scanTs")
            }
            // On journalise TOUJOURS avant d'émettre, puis on n'efface que sur
            // accusé de réception (`ackScan`) une fois la course en base.
            //
            // L'ancien code ne bufferisait que si l'émission échouait, au motif que
            // « rejouer un scan n'est pas idempotent ». Ce n'est plus vrai depuis
            // l'index unique (user_id, scan_ts) — 20260817_rides_scan_ts_unique.sql :
            // un rejeu est refusé par la base (23505) et traité comme un succès
            // sans doublon. Émettre sans journaliser perdait la course dès que le
            // JS recevait l'événement puis échouait à l'écrire (réseau, crash).
            val qid = bufferScanResult(ctx, result, screenHeight, scanTs)
            map.putString("qid", qid)
            emit("onScanResult", map)
        }

        /** Journalise un scan et rend son identifiant de file (`qid`), la clé que
         *  le JS renverra dans `ackScan` une fois la course confirmée en base.
         *
         *  `qid` plutôt que `scanTs` : `scanTs` peut valoir 0 (chemins anciens) et
         *  ne permettrait alors pas d'identifier l'entrée à retirer.
         *
         *  `imageBase64` et `debugBlocks` sont volontairement omis : le screenshot
         *  est de la PII et pèse des Mo, hors de propos dans SharedPreferences. À
         *  la relève le résultat est déjà final (OCR + TomTom faits), le fallback
         *  Gemini côté JS est inutile. */
        private fun bufferScanResult(
            ctx: Context,
            result: OcrParser.ScanResult,
            screenHeight: Int,
            scanTs: Double,
        ): String {
            val qid = java.util.UUID.randomUUID().toString()
            val prefs = ctx.applicationContext
                .getSharedPreferences(SCANS_PREFS, Context.MODE_PRIVATE)
            val arr = try { JSONArray(prefs.getString(SCANS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
            arr.put(JSONObject().apply {
                put("qid", qid)
                put("platform", result.platform.name)
                put("fare", result.fare)
                put("distanceKm", result.distanceKm)
                put("durationMin", result.durationMin ?: JSONObject.NULL)
                put("pickupAddress", result.pickupAddress ?: JSONObject.NULL)
                put("destinationAddress", result.destinationAddress ?: JSONObject.NULL)
                put("pickupDurationMin", result.pickupDurationMin ?: JSONObject.NULL)
                put("pickupDistanceKm", result.pickupDistanceKm ?: JSONObject.NULL)
                put("screenHeight", screenHeight)
                put("scanTs", if (scanTs > 0) scanTs else JSONObject.NULL)
            })
            val trimmed = if (arr.length() > SCANS_MAX) {
                JSONArray().also { out ->
                    for (i in arr.length() - SCANS_MAX until arr.length()) out.put(arr.get(i))
                }
            } else arr
            prefs.edit().putString(SCANS_KEY, trimmed.toString()).apply()
            return qid
        }

        /** Retire une entrée du journal — appelé par le JS via `ackScan` une fois
         *  la course écrite en base (ou refusée définitivement). Tant qu'aucun
         *  accusé n'arrive, l'entrée est rejouée à chaque relève : c'est ce qui
         *  garantit qu'un scan ne peut plus se perdre. */
        private fun removeBufferedScan(ctx: Context, qid: String) {
            val prefs = ctx.applicationContext
                .getSharedPreferences(SCANS_PREFS, Context.MODE_PRIVATE)
            val arr = try { JSONArray(prefs.getString(SCANS_KEY, "[]")) } catch (e: Exception) { return }
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optString("qid") != qid) out.put(o)
            }
            prefs.edit().putString(SCANS_KEY, out.toString()).apply()
        }

        // ─── Trace des échecs ────────────────────────────────────────────────
        // `onScanFailed` ne fait qu'informer l'UI ; il ne laisse aucune trace
        // exploitable. `onScanFailure` porte le MOTIF, et survit à un process RN
        // mort — sinon un scan qui casse quand l'app est fermée est invisible.
        const val FAILS_PREFS = "strive_pending_failures"
        const val FAILS_KEY = "pending"
        private const val FAILS_MAX = 50

        fun emitScanFailure(
            ctx: Context,
            reason: String,
            detail: String? = null,
            platform: String? = null,
            surface: String = "bubble",
        ) {
            val occurredAt = System.currentTimeMillis() / 1000.0
            val map = Arguments.createMap().apply {
                putString("reason", reason)
                putString("surface", surface)
                if (platform != null) putString("platform", platform) else putNull("platform")
                if (detail != null) putString("detail", detail) else putNull("detail")
                putDouble("occurredAt", occurredAt)
            }
            // Même règle que les résultats : on ne bufferise QUE si le JS n'a pas
            // pu recevoir l'événement, sinon la vidange le rejouerait en double.
            if (!emit("onScanFailure", map)) {
                val prefs = ctx.applicationContext
                    .getSharedPreferences(FAILS_PREFS, Context.MODE_PRIVATE)
                val arr = try { JSONArray(prefs.getString(FAILS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
                arr.put(JSONObject().apply {
                    put("reason", reason)
                    put("surface", surface)
                    put("platform", platform ?: JSONObject.NULL)
                    put("detail", detail ?: JSONObject.NULL)
                    put("occurredAt", occurredAt)
                })
                val trimmed = if (arr.length() > FAILS_MAX) {
                    JSONArray().also { out ->
                        for (i in arr.length() - FAILS_MAX until arr.length()) out.put(arr.get(i))
                    }
                } else arr
                prefs.edit().putString(FAILS_KEY, trimmed.toString()).apply()
            }
        }

        fun emitScanFailed() = emit("onScanFailed", null)
        fun emitPermissionDenied() = emit("onPermissionDenied", null)

        /** @return true si l'événement a bien été remis au JS. False = pas de
         *  contexte RN vivant (app tuée, bulle toujours active) → à l'appelant de
         *  bufferiser s'il ne veut pas perdre l'information. */
        private fun emit(event: String, params: WritableMap?): Boolean = runCatching {
            val js = moduleInstance?.reactContext
                // Vrai check en pont comme en bridgeless (RN 0.84) : côté
                // bridgeless c'est reactHost.isInstanceInitialized.
                ?.takeIf { it.hasActiveReactInstance() }
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?: return@runCatching false
            js.emit(event, params)
            true
        }.getOrDefault(false)
    }

    init {
        moduleInstance = this
        reactContext.addActivityEventListener(this)
    }

    private fun isAccessibilityServiceEnabled(ctx: android.content.Context): Boolean {
        val enabled = Settings.Secure.getString(
            ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val target = "${ctx.packageName}/com.strive.scanner.StriveAccessibilityService"
        return enabled.split(':').any { it.equals(target, ignoreCase = true) }
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}

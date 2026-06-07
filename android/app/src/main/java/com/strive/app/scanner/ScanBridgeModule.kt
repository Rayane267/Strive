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

class ScanBridgeModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    override fun getName() = "ScanBridge"

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

    /** Clé TomTom — permet au foreground service de géocoder sans dépendre du JS. */
    @ReactMethod
    fun setTomTomApiKey(key: String) {
        TomTomService.apiKey = key
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

        fun emitScanResult(
            result: OcrParser.ScanResult,
            imageBase64: String? = null,
            debugBlocks: String? = null,
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
                // Dump des blocs ML Kit pour diagnostic (JSON) — consommé en DEV
                if (debugBlocks != null) putString("debugBlocks", debugBlocks)
                else putNull("debugBlocks")
            }
            emit("onScanResult", map)
        }

        fun emitScanFailed() = emit("onScanFailed", null)
        fun emitPermissionDenied() = emit("onPermissionDenied", null)

        private fun emit(event: String, params: WritableMap?) {
            moduleInstance?.reactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(event, params)
        }
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

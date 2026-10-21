package com.strive.scanner

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.util.DisplayMetrics
import android.view.*
import android.view.WindowManager.LayoutParams
import android.view.animation.DecelerateInterpolator
import android.widget.*
import androidx.core.app.NotificationCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.strive.BuildConfig
import kotlin.math.hypot
import kotlin.math.max

class FloatingBubbleService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var bubbleContainer: FrameLayout
    private lateinit var bubbleParams: LayoutParams

    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var scanInProgress = false
    /** Numéro du scan en cours. Un rappel (capture, OCR, TomTom) qui arrive après
     *  la garde, ou après un scan plus récent, porte un ancien numéro : ignoré. */
    @Volatile private var scanToken = 0
    /** Lancement du dernier scan, pour l'anti double-tap. */
    private var lastScanAttemptAt = 0L
    private var countdownTimer: CountDownTimer? = null
    private var fareBadgeView: TextView? = null
    private var verdictBarView: View? = null
    private var verdictTriangleView: TextView? = null
    private var routeCarCircle: View? = null
    private var routeLine: View? = null
    private var routeCenterDot: View? = null
    private var routeGpsCircle: View? = null
    private var routeGpsGlyphView: TextView? = null
    private var durationView: TextView? = null
    private var distanceView: TextView? = null
    private var hourlyRateView: TextView? = null
    private var kmRateView: TextView? = null
    private var distancePulse: ObjectAnimator? = null
    /** Course affichée par la carte de résultat, en attente de Prise / Refusée.
     *  La carte repartie, la décision se prend sur la notification. */
    private var shownRideId: String? = null
    /** Une confirmation Prise / Refusée est en cours : un second toucher est ignoré. */
    private var decisionAnimating = false
    /** Place de la bulle avant que la carte ne se centre ; elle la retrouve au
     *  retour au repos. Effacée si le chauffeur la déplace entre-temps. */
    private var restingX: Int? = null

    /** Contexte résolu dans la langue de l'app — invalidé quand elle change. */
    private var localizedCtx: android.content.Context? = null

    companion object {
        private const val CHANNEL_ID = "strive_scanner_channel"
        private const val NOTIF_ID = 42
        /** Channel + id pour les alertes ponctuelles (ex: session requise) —
         *  importance DEFAULT pour être visible, distinct du channel silencieux
         *  du foreground service. */
        private const val ALERT_CHANNEL_ID = "strive_scanner_alerts"
        private const val SESSION_NOTIF_ID = 43

        /** Dernière course affichée : son prix et ses km s'ajoutent aux gains du
         *  jour dès « Prise », app fermée comprise. Mirror iOS (`lastTaggableRide`). */
        private const val TAGGABLE_PREFS = "strive_last_taggable_ride"

        /** Couleurs de verdict du Dynamic Island (`verdictColor`, StriveLiveActivity.swift). */
        private val VERDICT_GREEN = Color.rgb(0, 199, 82)
        private val VERDICT_ORANGE = Color.rgb(255, 153, 0)
        private val VERDICT_RED = Color.rgb(240, 69, 69)

        /** MaterialCommunityIcons, pendants des SF Symbols de l'île. */
        private const val MDI_CAR = 0xF010B             // car.fill
        private const val MDI_PERSON_WAVE = 0xF064A     // figure.wave
        private const val MDI_CHECK = 0xF0E1E           // checkmark
        private const val MDI_EXCLAMATION = 0xF1238     // exclamationmark
        private const val MDI_CLOSE = 0xF1398           // xmark
        private const val MDI_ARROW_UP_RIGHT = 0xF09C6  // arrow.up.right

        /** Une décision Prise / Refusée prise sur la carte de la bulle. Mirror iOS
         *  (`appendRideDecision` + `revertLiveActivityToIdle`) : elle part dans la
         *  file du JS, une course prise s'ajoute aussitôt aux gains du jour, la
         *  bulle revient au repos. */
        fun applyRideDecision(
            ctx: android.content.Context,
            rideId: String,
            status: String,
            // Faux quand la carte joue son animation de confirmation : c'est elle
            // qui rend la main au logo, une fois terminée.
            returnToIdle: Boolean = true,
        ) {
            if (rideId.isEmpty()) return
            val app = ctx.applicationContext
            ScanBridgeModule.emitRideDecision(app, rideId, status)
            val p = app.getSharedPreferences(TAGGABLE_PREFS, MODE_PRIVATE)
            // Une seule fois par course.
            if (status == "ACCEPTED" && p.getString("rideId", null) == rideId) {
                todayEarnings += p.getString("fare", null)?.toDoubleOrNull() ?: 0.0
                todayKm += p.getString("km", null)?.toDoubleOrNull() ?: 0.0
                // €/h recalculé sur le temps en ligne, comme iOS sur `sessionStartEpoch`.
                if (sessionStartMs > 0) {
                    val hours = (System.currentTimeMillis() - sessionStartMs) / 3_600_000.0
                    if (hours > 0.0003) todayHourlyRate = todayEarnings / hours
                }
                p.edit().clear().apply()
            }
            instance?.let { svc ->
                svc.mainHandler.post {
                    if (returnToIdle && svc.shownRideId == rideId) svc.showIdleState()
                    svc.refreshForegroundNotification()
                }
            }
        }
        /** Durée d'affichage de la carte de résultat avant le retour au logo. */
        private const val COUNTDOWN_MS = 10_000L
        /** Durée d'affichage d'une erreur, quelle qu'elle soit (scan, session,
         *  quota) avant le retour au logo. */
        private const val ERROR_DISPLAY_MS = 3_000L
        /** Anti double-tap : deux scans lancés à moins de 3 s d'écart. Mirror iOS
         *  (`ScanProcessor.shouldThrottleRapidScan`). */
        private const val SCAN_COOLDOWN_MS = 3_000L
        /** Garde : un scan sans issue au bout de 15 s est abandonné. iOS est à
         *  20–25 s ; plus court ici, la bulle est sous les yeux du chauffeur. */
        private const val SCAN_TIMEOUT_MS = 15_000L
        var instance: FloatingBubbleService? = null

        /** Langue choisie DANS Strive (fr/en). Persistée : le service survit à la
         *  mort du process RN, il ne peut pas la redemander au JS. Absente =
         *  locale système. Mirror iOS (clé `appLanguage` de l'App Group). */
        const val LANG_PREFS = "strive_scanner_lang"
        const val LANG_KEY = "appLanguage"

        fun setAppLanguage(ctx: android.content.Context, lang: String) {
            ctx.applicationContext
                .getSharedPreferences(LANG_PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putString(LANG_KEY, lang).apply()
            instance?.localizedCtx = null
        }
        /** Préférence utilisateur — si true, les métriques initiales incluent le trajet d'approche */
        var includePickup: Boolean = true
        /** Seuils utilisateur pour le verdict natif (synchronisés depuis JS). */
        var minHourlyRate: Double = 25.0
        var minKmRate: Double = 1.2

        /** Préférence « retirer le carburant du prix » — AFFICHAGE SEUL. Le tarif
         *  brut reste celui qui part en base et qui sert aux €/h, €/km et verdict. */
        var deductFuel: Boolean = false
        /** Coût carburant au km, pré-calculé côté JS (conso × prix du jour) : le
         *  natif n'a ni le type de carburant ni le tarif à la pompe. 0 = conso non
         *  renseignée, donc rien à déduire. */
        var fuelCostPerKm: Double = 0.0
        /** Quota journalier dépassé (synchronisé depuis JS via setQuotaReached).
         *  Si true, triggerScan affiche un état "limite atteinte" sans lancer
         *  l'OCR ni TomTom → 0 coût Gemini/TomTom pour les users hors quota. */
        var quotaReached: Boolean = false

        /** Compte free (synchronisé depuis JS via setQuotaReached). Réserve le
         *  teaser verrouillé "passe Plus" aux free ; un abonné Plus hors quota
         *  voit "reviens demain". */
        var isFreeTier: Boolean = true

        /** Session active (chauffeur « en ligne »). Synchronisé depuis JS via
         *  setSessionOnline. Si false, triggerScan bloque le scan + notifie.
         *  Défaut false = fail-safe (pas de scan tant que la session n'est pas
         *  confirmée). Mirror iOS (AnalyzeRideIntent.isSessionOnline). */
        var sessionOnline: Boolean = false

        /** Compteur de scans du jour + limite (poussés par le JS via setScanQuota).
         *  Permet d'appliquer le quota côté natif même quand le JS est suspendu.
         *  Le natif incrémente entre deux syncs ; le JS réécrit la valeur réelle. */
        var scanCountToday: Int = 0
        var scanQuotaLimit: Int = 0
        /** Jour (yyyymmdd) du compteur, pour ignorer une valeur datée d'hier
         *  si le process survit au-delà de l'heure de reset sans resync JS. */
        var scanCountDay: Int = 0
        /** Heure de reset du quota (0 ou 4h), poussée par le JS via setScanQuota. */
        var quotaResetHour: Int = 0

        /** Jour de quota tenant compte de quotaResetHour : un scan avant l'heure
         *  de reset appartient encore à la journée de la veille. Aligné sur
         *  getDayStart() côté JS. */
        fun todayKey(): Int {
            val c = java.util.Calendar.getInstance()
            c.add(java.util.Calendar.HOUR_OF_DAY, -quotaResetHour)
            return c.get(java.util.Calendar.YEAR) * 10000 +
                (c.get(java.util.Calendar.MONTH) + 1) * 100 +
                c.get(java.util.Calendar.DAY_OF_MONTH)
        }

        /** Compte du jour, 0 si la valeur stockée date d'un autre jour. */
        fun scanCountForToday(): Int =
            if (scanCountDay == todayKey()) scanCountToday else 0

        /** Limite du palier GRATUIT, poussée par le JS (setDeviceQuotaLimit).
         *  Distincte de `scanQuotaLimit` (palier courant + crédits) : le plafond
         *  d'appareil se mesure toujours à l'aune du gratuit. */
        var deviceFreeLimit: Int = 0

        /** Fichier du compteur d'APPAREIL. En SharedPreferences et non en
         *  mémoire comme `scanCountToday` : il doit survivre à la mort du
         *  process et surtout au changement de compte — c'est précisément le
         *  geste qu'il est censé rendre inopérant. */
        private const val DEVICE_QUOTA_PREFS = "strive_device_quota"
        private const val DEVICE_COUNT_KEY = "deviceScanCountToday"
        private const val DEVICE_DAY_KEY = "deviceScanCountDay"

        fun deviceScanCountForToday(ctx: android.content.Context): Int {
            val p = ctx.applicationContext
                .getSharedPreferences(DEVICE_QUOTA_PREFS, android.content.Context.MODE_PRIVATE)
            if (p.getInt(DEVICE_DAY_KEY, 0) != todayKey()) return 0
            return p.getInt(DEVICE_COUNT_KEY, 0)
        }

        /** Réamorce le compteur d'appareil depuis le serveur
         *  (`device_scan_usage`). Les SharedPreferences partent à la
         *  désinstallation, le `device_id` du Keychain non : sans ce réamorçage,
         *  une réinstallation redonnait un compteur vierge et le scan passait
         *  avant que le serveur ne le refuse — OCR et Gemini dépensés pour rien.
         *
         *  `maxOf` et non affectation : la valeur serveur peut être en retard
         *  sur des scans faits app fermée. L'écraser rendrait des scans déjà
         *  consommés. Parité iOS (`setDeviceScanCount`). */
        fun seedDeviceScanCount(ctx: android.content.Context, deviceUsed: Int) {
            val p = ctx.applicationContext
                .getSharedPreferences(DEVICE_QUOTA_PREFS, android.content.Context.MODE_PRIVATE)
            val today = todayKey()
            val local = if (p.getInt(DEVICE_DAY_KEY, 0) == today) p.getInt(DEVICE_COUNT_KEY, 0) else 0
            p.edit()
                .putInt(DEVICE_DAY_KEY, today)
                .putInt(DEVICE_COUNT_KEY, maxOf(local, deviceUsed))
                .apply()
        }

        fun incrementDeviceScanCount(ctx: android.content.Context) {
            val p = ctx.applicationContext
                .getSharedPreferences(DEVICE_QUOTA_PREFS, android.content.Context.MODE_PRIVATE)
            val today = todayKey()
            val base = if (p.getInt(DEVICE_DAY_KEY, 0) == today) p.getInt(DEVICE_COUNT_KEY, 0) else 0
            p.edit().putInt(DEVICE_DAY_KEY, today).putInt(DEVICE_COUNT_KEY, base + 1).apply()
        }

        /**
         * Efface le compteur de scans de l'appareil. RÉSERVÉ AU RESET DE DIAGNOSTIC.
         *
         * `seedDeviceScanCount` garde le maximum entre le local et le serveur —
         * des scans faits process mort ont monté le compteur sans que la base le
         * sache. Le compteur ne redescend donc jamais dans la journée, sauf ici.
         */
        fun clearDeviceScanCount(ctx: android.content.Context) {
            ctx.applicationContext
                .getSharedPreferences(DEVICE_QUOTA_PREFS, android.content.Context.MODE_PRIVATE)
                .edit().remove(DEVICE_COUNT_KEY).remove(DEVICE_DAY_KEY).apply()
        }

        /** Plafond d'appareil : ce téléphone a épuisé les scans gratuits du jour
         *  avec un AUTRE compte. Miroir de `AnalyzeRideIntent.isDeviceQuotaReached`
         *  et de la règle serveur — les trois doivent rester identiques.
         *
         *  `deviceUsed > scanCountForToday()` : sans ce test, un chauffeur seul
         *  au bout de ses scans verrait « un autre compte » alors qu'il n'y en a
         *  qu'un. Son propre plafond le refuse déjà, avec le bon motif. */
        fun isDeviceQuotaReached(ctx: android.content.Context): Boolean {
            if (!isFreeTier) return false
            if (deviceFreeLimit <= 0) return false
            val deviceUsed = deviceScanCountForToday(ctx)
            return deviceUsed >= deviceFreeLimit && deviceUsed > scanCountForToday()
        }

        /** KPI de session du jour poussés par le JS (updateSessionKPI) — affichés
         *  dans la notification persistante du foreground service. Équivalent
         *  Android du tableau de bord Live Activity iOS. */
        var todayEarnings: Double = 0.0
        var todayHourlyRate: Double = 0.0
        var todayKm: Double = 0.0
        var onlineMinutes: Int = 0
        var hasSessionKpi: Boolean = false
        /** Début du temps en ligne du jour, déduit du cumul poussé par le JS :
         *  ancre du chronomètre de la notification et du €/h recalculé après
         *  « Prise ». Mirror iOS (`sessionStartEpoch`). */
        var sessionStartMs: Long = 0L

        fun updateSessionKpi(todayEarnings: Double, todayHourlyRate: Double, todayKm: Double, onlineMinutes: Int) {
            this.todayEarnings = todayEarnings
            this.todayHourlyRate = todayHourlyRate
            this.todayKm = todayKm
            this.onlineMinutes = onlineMinutes
            sessionStartMs = System.currentTimeMillis() - onlineMinutes * 60_000L
            hasSessionKpi = true
            instance?.refreshForegroundNotification()
        }

        // ─── Relance automatique ─────────────────────────────────────────────

        /** Ce que le JS pousse à la bulle, gardé sur le téléphone. Relancée sans
         *  lui — Android qui la recrée, redémarrage, mise à jour — elle doit
         *  retrouver le même verdict, le même quota et le même état en ligne.
         *  Le jeton de session n'y est PAS : il expire en une heure, et un jeton
         *  périmé bloquerait les scans ; sans lui, la course passe par le journal. */
        private const val STATE_PREFS = "strive_bubble_state"

        /** Au-delà de 2 h sans activité, le JS ferme la session
         *  (`SESSION_INACTIVITY_MS`) : la bulle ne revient pas pour une session
         *  oubliée la veille. */
        private const val AUTO_RUN_MAX_IDLE_MS = 2 * 3_600_000L

        private fun statePrefs(ctx: android.content.Context) =
            ctx.applicationContext.getSharedPreferences(STATE_PREFS, android.content.Context.MODE_PRIVATE)

        fun saveState(ctx: android.content.Context) {
            statePrefs(ctx).edit()
                .putBoolean("sessionOnline", sessionOnline)
                .putBoolean("includePickup", includePickup)
                .putString("minHourlyRate", minHourlyRate.toString())
                .putString("minKmRate", minKmRate.toString())
                .putBoolean("deductFuel", deductFuel)
                .putString("fuelCostPerKm", fuelCostPerKm.toString())
                .putBoolean("quotaReached", quotaReached)
                .putBoolean("isFreeTier", isFreeTier)
                .putInt("scanCountToday", scanCountToday)
                .putInt("scanQuotaLimit", scanQuotaLimit)
                .putInt("scanCountDay", scanCountDay)
                .putInt("quotaResetHour", quotaResetHour)
                .putInt("deviceFreeLimit", deviceFreeLimit)
                .apply()
        }

        private fun restoreState(ctx: android.content.Context) {
            val p = statePrefs(ctx)
            if (!p.contains("sessionOnline")) return
            sessionOnline = p.getBoolean("sessionOnline", sessionOnline)
            includePickup = p.getBoolean("includePickup", includePickup)
            minHourlyRate = p.getString("minHourlyRate", null)?.toDoubleOrNull() ?: minHourlyRate
            minKmRate = p.getString("minKmRate", null)?.toDoubleOrNull() ?: minKmRate
            deductFuel = p.getBoolean("deductFuel", deductFuel)
            fuelCostPerKm = p.getString("fuelCostPerKm", null)?.toDoubleOrNull() ?: fuelCostPerKm
            quotaReached = p.getBoolean("quotaReached", quotaReached)
            isFreeTier = p.getBoolean("isFreeTier", isFreeTier)
            scanCountToday = p.getInt("scanCountToday", scanCountToday)
            scanQuotaLimit = p.getInt("scanQuotaLimit", scanQuotaLimit)
            scanCountDay = p.getInt("scanCountDay", scanCountDay)
            quotaResetHour = p.getInt("quotaResetHour", quotaResetHour)
            deviceFreeLimit = p.getInt("deviceFreeLimit", deviceFreeLimit)
        }

        /** Activité de session : passage en ligne, chaque scan abouti. */
        fun markActive(ctx: android.content.Context) {
            statePrefs(ctx).edit().putLong("lastActiveMs", System.currentTimeMillis()).apply()
        }

        /** Le chauffeur a coupé la bulle lui-même (bouton scanner) : elle ne
         *  revient pas d'elle-même tant qu'il ne la rallume pas. */
        fun setUserStopped(ctx: android.content.Context, stopped: Boolean) {
            statePrefs(ctx).edit().putBoolean("userStopped", stopped).apply()
        }

        /** La bulle doit-elle tourner sans qu'on le lui demande ? En ligne, pas
         *  coupée à la main, et une session qui a servi il y a moins de 2 h. */
        fun shouldAutoRun(ctx: android.content.Context): Boolean {
            val p = statePrefs(ctx)
            return p.getBoolean("sessionOnline", false) &&
                !p.getBoolean("userStopped", false) &&
                System.currentTimeMillis() - p.getLong("lastActiveMs", 0L) < AUTO_RUN_MAX_IDLE_MS
        }

        /** Relance la bulle si elle doit tourner et que ses autorisations sont
         *  là. Appelée à l'ouverture de l'app, au démarrage du téléphone et après
         *  une mise à jour. Rend vrai si la bulle tourne. */
        fun ensureRunning(ctx: android.content.Context): Boolean {
            if (instance != null) return true
            if (!shouldAutoRun(ctx)) return false
            val app = ctx.applicationContext
            val overlayOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                android.provider.Settings.canDrawOverlays(app)
            // Android < 11 : la capture exige un accord redonné à chaque démarrage,
            // qu'une relance sans le chauffeur ne peut pas obtenir.
            if (!overlayOk || !ScanBridgeModule.isAccessibilityServiceEnabled(app) ||
                Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
            val intent = Intent(app, FloatingBubbleService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent)
                else app.startService(intent)
            }.onFailure { return false }
            return true
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Seuils, quota et état en ligne : ceux que le JS avait poussés, au cas
        // où la bulle repart sans lui.
        restoreState(this)
        // Le service peut redémarrer sans que JS ait tourné : le parser et le
        // géocodeur repartiraient alors sur leurs valeurs par défaut. On leur
        // rend le pays écrit en préférences avant le premier scan.
        MarketFormat.hydrate(this)
        // Idem pour la clé TomTom : sans elle, le scan suivant se rabat sur les
        // chiffres lus à l'écran — ceux de la plateforme, pas une mesure.
        TomTomService.hydrate(this)
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        // La bulle d'abord : relancé par le système en arrière-plan, le service
        // n'a le droit de passer au premier plan qu'avec une fenêtre visible.
        setupBubble()
        val foreground = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIF_ID,
                    buildNotification(),
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    else
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(NOTIF_ID, buildNotification())
            }
        }.isSuccess
        if (!foreground) stopSelf()
    }

    /** STICKY : tuée par Android (mémoire, batterie), la bulle est recréée. Une
     *  relance par le système arrive sans intent ; elle n'aboutit que si la
     *  session tourne encore. */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null && !shouldAutoRun(this)) stopSelf()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        // Purge tous les Runnables postDelayed (showIdleState après 2.5s, watchdog OCR, etc.)
        // pour éviter qu'un callback ne tape sur des Views nullifiées après la destruction.
        mainHandler.removeCallbacksAndMessages(null)
        clearTransientState()
        if (::bubbleContainer.isInitialized) runCatching { windowManager.removeView(bubbleContainer) }
    }

    /**
     * Annule tous les timers / animators en cours et nullifie les refs vers les
     * sous-vues. À appeler avant chaque `removeAllViews()` pour éviter qu'un
     * `ObjectAnimator` ou un `CountDownTimer` ne survive au changement d'état
     * et n'écrive sur des Views détachées (ViewRootImpl exception, leaks).
     */
    private fun clearTransientState() {
        countdownTimer?.cancel()
        countdownTimer = null
        decisionAnimating = false
        distancePulse?.cancel()
        distancePulse = null
        distanceView?.alpha = 1f
        fareBadgeView = null
        verdictBarView = null
        verdictTriangleView = null
        routeCarCircle = null
        routeLine = null
        routeCenterDot = null
        routeGpsCircle = null
        routeGpsGlyphView = null
        durationView = null
        distanceView = null
        hourlyRateView = null
        kmRateView = null
    }

    override fun onBind(intent: Intent?) = null

    // ─── Screen metrics (compatible toutes versions Android) ────────────────────

    private fun getScreenWidth(): Int = resources.displayMetrics.widthPixels
    private fun getScreenHeight(): Int = resources.displayMetrics.heightPixels

    // ─── Bubble setup ────────────────────────────────────────────────────────────

    private fun setupBubble() {
        bubbleContainer = FrameLayout(this)

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") LayoutParams.TYPE_PHONE

        // Gravity START + TOP pour permettre le drag libre X et Y
        val screenWidth = getScreenWidth()
        val pillEstimatedWidth = dpToPx(160)

        bubbleParams = LayoutParams(
            LayoutParams.WRAP_CONTENT,
            LayoutParams.WRAP_CONTENT,
            overlayType,
            LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screenWidth - pillEstimatedWidth) / 2
            y = dpToPx(48)   // sous la status bar, compatible avec toutes les tailles d'encoche
        }

        windowManager.addView(bubbleContainer, bubbleParams)
        showIdleState()
        setupDragAndTap()
    }

    private fun setupDragAndTap() {
        var initX = 0; var initY = 0
        var touchX = 0f; var touchY = 0f
        var moved = false

        bubbleContainer.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initX = bubbleParams.x
                    initY = bubbleParams.y
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (moved || dx * dx + dy * dy > 25) {
                        bubbleParams.x = (initX + dx).coerceAtLeast(0)
                            .coerceAtMost(getScreenWidth() - bubbleContainer.width)
                        bubbleParams.y = (initY + dy).coerceAtLeast(0)
                        windowManager.updateViewLayout(bubbleContainer, bubbleParams)
                        moved = true
                        restingX = null
                    }; true
                }
                MotionEvent.ACTION_UP -> { if (!moved) triggerScan(); true }
                else -> false
            }
        }
    }

    // ─── Scan flow ───────────────────────────────────────────────────────────────

    fun triggerScan() {
        if (scanInProgress) {
            // Trace : un tap avalé pendant un scan en cours n'est pas anodin — c'est
            // le symptôme que rapportent les testeurs (« j'appuie, rien ne se passe »).
            ScanBridgeModule.emitScanFailure(this, "throttled")
            return
        }
        // Session non démarrée → on bloque le scan AVANT toute capture, et on
        // notifie l'utilisateur de passer en ligne. Mirror iOS
        // (AnalyzeRideIntent : refuse + notification si !sessionOnline).
        if (!sessionOnline) {
            ScanBridgeModule.emitScanFailure(this, "session_off")
            notifySessionRequired()
            showSessionRequiredState()
            mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
            return
        }
        // Jeton présent mais périmé : le scan aurait tourné puis échoué à l'appel
        // de l'edge function. On refuse AVANT la capture et l'OCR.
        //
        // Même famille au journal (`session_off`) : le vocabulaire de
        // `log_scan_failure` est fermé et n'a pas de motif propre à ce cas.
        // Parité iOS (AnalyzeRideIntent.isSessionExpired).
        if (GeminiVisionService.isJwtExpired()) {
            ScanBridgeModule.emitScanFailure(this, "session_off")
            notifySessionRequired()
            showSessionRequiredState()
            mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
            return
        }
        // Quota dépassé → on bloque AVANT toute capture/OCR/TomTom. Pas d'event
        // émis au JS, donc rien ne part en queue offline non plus.
        // Compteur natif (poussé par le JS + incrémenté localement) OU flag JS :
        // on n'attend pas que le JS (suspendu pendant un scan) mette le flag à jour.
        // Le compteur vaut pour TOUS les tiers : plan_limits donne free = 3 ET
        // plus = 15. L'ancien `isFreeTier &&` exemptait les abonnés Plus, qui
        // franchissaient donc leur limite app fermée — le serveur refusait ensuite
        // l'insertion et la course était perdue. `isFreeTier` ne sert plus qu'à
        // choisir l'écran affiché (teaser Plus vs « revenez demain »).
        //
        // `scanQuotaLimit` est la limite EFFECTIVE poussée par le JS : celle du
        // plan PLUS les crédits achetés. Ce calcul ne connaît pas les crédits,
        // et sans eux il bloquait un chauffeur qui venait d'en acheter.
        // AVANT tout : un scan interdit ne doit coûter ni OCR, ni TomTom, ni
        // Gemini. Testé en premier pour que le motif soit le bon — le plafond
        // d'appareil et celui du compte donnent deux messages différents.
        if (isDeviceQuotaReached(this)) {
            ScanBridgeModule.emitScanFailure(this, "quota_reached")
            showQuotaReachedState()
            mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
            return
        }
        val quotaByCount = scanQuotaLimit > 0 && scanCountForToday() >= scanQuotaLimit
        if (quotaReached || quotaByCount) {
            ScanBridgeModule.emitScanFailure(this, "quota_reached")
            showQuotaReachedState()
            mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
            return
        }
        // Anti double-tap : un appui moins de 3 s après le lancement du scan
        // précédent est ignoré. Le verrou seul laissait passer l'appui qui suit de
        // près un résultat. Après les refus, comme sur iOS : un scan refusé ne
        // consomme pas le délai.
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastScanAttemptAt < SCAN_COOLDOWN_MS) {
            ScanBridgeModule.emitScanFailure(this, "throttled")
            return
        }
        lastScanAttemptAt = now
        // Le verrou tient jusqu'à l'ISSUE du scan — résultat, échec ou garde —
        // et plus seulement jusqu'au départ de TomTom : un second appui pendant
        // l'itinéraire créait une seconde course pour la même offre, et
        // consommait un second scan. Mirror iOS (`scanInProgressSince`).
        scanInProgress = true
        val token = ++scanToken
        mainHandler.postDelayed({ onScanTimeout(token) }, SCAN_TIMEOUT_MS)
        showLoadingState()

        mainHandler.postDelayed({
            if (!isCurrentScan(token)) return@postDelayed
            val svc = StriveAccessibilityService.instance
            if (svc == null) {
                onScanError(); finishScan(token)
                ScanBridgeModule.emitScanFailure(this, "invalid_image", "no_accessibility_service")
                ScanBridgeModule.emitScanFailed(); return@postDelayed
            }
            svc.captureScreen { bitmap ->
                if (!isCurrentScan(token)) { bitmap?.recycle(); return@captureScreen }
                if (bitmap == null) {
                    mainHandler.post { onScanError() }
                    finishScan(token)
                    ScanBridgeModule.emitScanFailure(this, "invalid_image", "null_bitmap")
                    ScanBridgeModule.emitScanFailed(); return@captureScreen
                }
                runOcr(bitmap, getScreenWidth(), getScreenHeight(), token)
            }
        }, 50)
    }

    private fun isCurrentScan(token: Int) = scanInProgress && token == scanToken

    /** Issue du scan [token] : lève le verrou, sauf s'il appartient déjà à un
     *  scan plus récent. */
    private fun finishScan(token: Int) {
        if (token == scanToken) scanInProgress = false
    }

    /** Garde : capture, OCR ou TomTom n'ont pas rendu la main à temps. Le verrou
     *  se lève, le chauffeur lit qu'il doit relancer, et un résultat qui
     *  arriverait encore est ignoré (`isCurrentScan`). Mirror iOS (motif
     *  `timeout`, « Analyse interrompue — relancez le scan »). */
    private fun onScanTimeout(token: Int) {
        if (!isCurrentScan(token)) return
        scanInProgress = false
        showErrorState(textRes = com.strive.R.string.scanner_error_timeout)
        mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
        ScanBridgeModule.emitScanFailure(this, "timeout")
        ScanBridgeModule.emitScanFailed()
    }

    private fun runOcr(fullBitmap: Bitmap, w: Int, h: Int, token: Int) {
        // Downscale à 1440px — on privilégie la qualité (fidélité des glyphes fins
        // comme "1" vs "l") plutôt que la vitesse. Sous 1440px on garde la res native.
        val maxW = 1440
        val ocrBitmap = if (fullBitmap.width > maxW) {
            val r = maxW.toFloat() / fullBitmap.width
            Bitmap.createScaledBitmap(fullBitmap, maxW, (fullBitmap.height * r).toInt(), true)
        } else null  // null = on utilise fullBitmap directement

        val bitmapForOcr = ocrBitmap ?: fullBitmap
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(InputImage.fromBitmap(bitmapForOcr, 0))
            .addOnSuccessListener { visionText ->
                ocrBitmap?.recycle()
                if (!isCurrentScan(token)) { fullBitmap.recycle(); return@addOnSuccessListener }
                // Pré-filtre sous la même bande que le parser : la Live Activity
                // de Strive en haut faisait passer un journal d'appels pour une
                // offre, et son OCR partait dans scan_debug (#66). Mirror iOS.
                val visible = OcrParser.belowTopCut(visionText, h)
                val visibleText = visible.joinToString("\n") { it.text }
                val lines = visible.flatMap { b -> b.lines.map { it.text } }
                val debugBlocks = OcrParser.dumpBlocks(visionText)
                val result = OcrParser.parse(visionText, w, h, fullBitmap)
                if (result != null) {
                    val base64 = GeminiVisionService.encodeForBridge(fullBitmap)
                    fullBitmap.recycle()
                    // NB : on N'AFFICHE PAS showResultState ici. La bulle reste
                    // en showLoadingState jusqu'à ce que resolveTomTomAndEmit
                    // ait soit (a) TomTom OK → valeurs vérifiées,
                    //         (b) TomTom skip/KO → fallback OCR.
                    // Évite le flash de valeurs OCR provisoires qui pouvaient
                    // donner un verdict différent du verdict final.
                    // Blocs émis en release (et non plus DEBUG-only) : alimentent
                    // scan_debug côté JS quand une adresse manque.
                    // Le verrou se lève dans `resolveTomTomAndEmit`, à l'issue.
                    resolveTomTomAndEmit(result, base64, debugBlocks, token, h)
                } else if (OcrParser.looksLikeRideOffer(visibleText) && OcrParser.isUnsupportedLanguage(lines)) {
                    // LA LANGUE N'EXPLIQUE QU'UN ÉCHEC, ELLE N'EN PROVOQUE AUCUN.
                    // Mirror iOS (ScanProcessor.process) : l'offre étrangère était
                    // refusée AVANT le parse, alors que le parser lit montants, km
                    // et min — que le roumain garde — et que les adresses restent
                    // françaises. Seul un échec sur un écran aux lettres étrangères
                    // reçoit la consigne. `detail` : langue du téléphone, lettres
                    // vues, étape du parser. Les blocs partent avec.
                    fullBitmap.recycle()
                    onUnsupportedLanguage()
                    val phone = android.content.res.Resources.getSystem().configuration.locales[0].toLanguageTag()
                    val step = OcrParser.lastFailure?.let { " · $it" } ?: ""
                    ScanBridgeModule.emitScanFailure(
                        this, "unsupported_language",
                        "$phone ${OcrParser.foreignLetters(lines)}$step",
                        blocks = debugBlocks, screenHeight = h,
                    )
                    ScanBridgeModule.emitScanFailed()
                    finishScan(token)
                } else if (OcrParser.looksLikeRideOffer(visibleText)) {
                    // Les blocs partent avec : c'est un écran d'offre que le parser
                    // local n'a pas su lire, donc exactement la fixture qui manque.
                    // Le détail dit à quelle étape il a renoncé.
                    failUnreadable(fullBitmap, token, debugBlocks, h, detail = OcrParser.lastFailure)
                } else {
                    // Pré-filtre anti-pub : du texte a été lu mais pas d'offre (un
                    // montant ET une distance ou une durée) → « pas une offre ».
                    // Mirror iOS (ScanProcessor.lastScanMayBeRide). Rien lu du
                    // tout, c'est un OCR vide, pas un écran sans offre.
                    fullBitmap.recycle()
                    onNotARide()
                    if (visionText.textBlocks.isEmpty()) {
                        ScanBridgeModule.emitScanFailure(this, "ocr_empty")
                    } else {
                        ScanBridgeModule.emitScanFailure(this, "not_a_ride", OcrParser.lastFailure)
                    }
                    ScanBridgeModule.emitScanFailed()
                    finishScan(token)
                }
            }
            .addOnFailureListener { e ->
                ocrBitmap?.recycle()
                if (!isCurrentScan(token)) { fullBitmap.recycle(); return@addOnFailureListener }
                failUnreadable(
                    fullBitmap, token, reason = "ocr_empty",
                    detail = "mlkit_error ${e.javaClass.simpleName}",
                )
            }
    }

    /** Écran d'offre que le parsing par règles n'a pas su lire, ou OCR en échec.
     *
     *  Il n'y a PLUS de repli Gemini : le scan échoue ici. `GeminiVisionService`
     *  reste dans le binaire pour le jeton de session et l'encodage d'image, mais
     *  `analyze` n'est plus appelé nulle part.
     *
     *  Motif `offer_unreadable` (ex-`gemini_ko`, que le RPC traduit encore pour
     *  les anciens builds) : les règles ont calé sur un écran qui ressemblait à
     *  une offre, `detail` dit à quelle étape. `ocr_empty` quand c'est l'OCR
     *  lui-même qui a échoué. `debugBlocks` / `screenHeight` partent avec : c'est
     *  exactement la fixture qui manque au parser. Nuls quand l'OCR a échoué. */
    private fun failUnreadable(
        bitmap: Bitmap,
        token: Int,
        debugBlocks: String? = null,
        screenHeight: Int = 0,
        reason: String = "offer_unreadable",
        detail: String? = null,
    ) {
        bitmap.recycle()
        onScanError()
        ScanBridgeModule.emitScanFailure(
            this, reason, detail,
            blocks = debugBlocks, screenHeight = screenHeight,
        )
        ScanBridgeModule.emitScanFailed()
        finishScan(token)
    }

    private fun onScanError() {
        mainHandler.post { showErrorState() }
        mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
    }

    /** Écran scanné sans signal d'offre VTC (pub, etc.). */
    private fun onNotARide() {
        mainHandler.post { showNotARideState() }
        mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
    }

    /** Offre dans une langue que l'app ne lit pas : une consigne à lire, même
     *  durée que les autres erreurs. */
    private fun onUnsupportedLanguage() {
        mainHandler.post { showNotARideState(com.strive.R.string.scanner_unsupported_language) }
        mainHandler.postDelayed({ showIdleState() }, ERROR_DISPLAY_MS)
    }

    /**
     * Ouvre l'app Strive sur l'écran Historique via deep link `strive://history`.
     * Utilisé quand l'utilisateur tape sur la bulle résultat pour voir la course
     * qui vient d'être enregistrée.
     */
    private fun openAppHistory() {
        try {
            val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("strive://history")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            startActivity(intent)
        } catch (e: Exception) {
            // Fallback : lance juste l'app via launcher intent
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            launch?.let { startActivity(it) }
        }
    }

    /**
     * Pulse alpha sur le chiffre distance pendant que TomTom tourne. Signal
     * visuel discret que la valeur est en cours de vérification.
     */
    private fun startDistancePulse() {
        val target = distanceView ?: return
        stopDistancePulse()
        distancePulse = ObjectAnimator.ofFloat(target, "alpha", 1f, 0.45f).apply {
            duration = 700
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            start()
        }
    }

    private fun stopDistancePulse() {
        distancePulse?.cancel()
        distancePulse = null
        distanceView?.alpha = 1f
    }

/**
     * Enchaîne TomTom (natif) après OCR et affiche la bulle + émet au JS avec
     * les valeurs finales (TomTom si OK, OCR sinon). La bulle reste en
     * showLoadingState jusqu'ici → l'utilisateur ne voit jamais de valeurs
     * provisoires qui pourraient changer après TomTom.
     */
    private fun resolveTomTomAndEmit(
        ocr: OcrParser.ScanResult,
        base64: String,
        debugBlocks: String?,
        token: Int,
        screenHeight: Int = 0,
        geminiUsed: Boolean = false,
    ) {
        // Horodatage du scan (secondes epoch) : il DATE la course — jour
        // d'affectation et registre de quota. Il ne l'identifie plus.
        val scanTs = System.currentTimeMillis() / 1000.0
        // Son identité, frappée ICI, avant tout affichage et toute écriture. Elle
        // part avec la notification (boutons Prise/Refusée), avec l'événement JS,
        // dans le journal des scans, et jusqu'à `rides.id`. Une seule valeur pour
        // tout le trajet : un tap sur la notification désigne donc la course, sans
        // que rien n'ait à la retrouver. Mirror iOS.
        val rideId = java.util.UUID.randomUUID().toString()
        val pickup = ocr.pickupAddress?.replace("\\s*\\n\\s*".toRegex(), " ")
            ?.replace("^(\\d+)([A-Za-zÀ-ÿ])".toRegex(), "$1 $2")
            ?.trim() ?: ""
        val dest = ocr.destinationAddress?.replace("\\s*\\n\\s*".toRegex(), " ")
            ?.replace("^(\\d+)([A-Za-zÀ-ÿ])".toRegex(), "$1 $2")
            ?.trim() ?: ""

        if (BuildConfig.DEBUG) android.util.Log.d("StriveScan", "TomTom? pickup='$pickup' dest='$dest' ready=${TomTomService.isReady}")

        if (pickup.isEmpty() || dest.isEmpty() || !TomTomService.isReady) {
            // RIEN N'A ÉTÉ MESURÉ → RIEN N'EST MONTRÉ, RIEN N'EST ENREGISTRÉ.
            //
            // Ce chemin affichait les valeurs OCR — la distance et la durée LUES
            // SUR L'ÉCRAN, celles de la plateforme — avec le même verdict coloré
            // qu'une vraie mesure. Deux chauffeurs côte à côte sur la même course
            // ont vu 100 €/h et 38 €/h ; le second avait raison. Strive existe pour
            // contester le chiffre de la plateforme : le réafficher en silence
            // sous ses propres couleurs était le seul bug qu'elle n'avait pas le
            // droit d'avoir.
            if (BuildConfig.DEBUG) android.util.Log.d("StriveScan", "TomTom SKIP (adresse vide ou clé absente) → échec")
            val network = !TomTomService.isReady
            mainHandler.post { showErrorState(network) }
            // Le motif part en base, comme sur iOS : sans lui, un échec
            // d'itinéraire Android ne se compterait nulle part. Une adresse
            // manquante est un échec de LECTURE, pas d'itinéraire.
            val missing = listOfNotNull(
                if (pickup.isEmpty()) "no_pickup" else null,
                if (dest.isEmpty()) "no_dest" else null,
            ).joinToString(" ")
            ScanBridgeModule.emitScanFailure(
                this,
                if (network) "route_no_key" else "no_addresses",
                if (network) null else "$missing platform=${ocr.platform.name}",
                platform = ocr.platform.name,
                blocks = debugBlocks, screenHeight = screenHeight,
                parsed = ocr,
            )
            ScanBridgeModule.emitScanFailed()
            finishScan(token)
            return
        }

        TomTomService.calculateRoute(pickup, dest, screenDistanceKm = ocr.distanceKm) { outcome ->
            // Arrivé après la garde : le chauffeur a déjà lu « relancez ».
            if (!isCurrentScan(token)) return@calculateRoute
            if (BuildConfig.DEBUG) android.util.Log.d("StriveScan", "TomTom outcome=$outcome (OCR dist=${ocr.distanceKm} dur=${ocr.durationMin})")
            val route = (outcome as? TomTomService.RouteOutcome.Ok)?.route
            val ratio = if (route != null && route.distanceKm > 0) ocr.fare / route.distanceKm else 0.0
            val measured = route != null
                // Plafonds larges : une course longue (Paris → Marseille) est
                // une course comme une autre ; plancher à 100 m, comme le
                // parser — une course aussi courte existe. Mirror iOS.
                && route.distanceKm in 0.1..2000.0
                && route.durationMin <= 1440
                // Plancher seul : pas de plafond €/km, une course Van/XL
                // courte le dépasse. Mirror iOS.
                && ratio >= 0.2

            if (!measured || route == null) {
                // Même règle que le SKIP ci-dessus : sans mesure, pas de verdict.
                // Un réseau absent se retente sur place ; une adresse illisible
                // demande une autre capture. Deux motifs, deux messages.
                val network = outcome is TomTomService.RouteOutcome.Unreachable ||
                    outcome is TomTomService.RouteOutcome.NoKey
                mainHandler.post { showErrorState(network) }
                // Le motif exact part en base : c'est lui qui dira, dans une
                // semaine, s'il faut un retry réseau ou un meilleur géocodage.
                val reason = when (outcome) {
                    is TomTomService.RouteOutcome.Unreachable -> "route_unreachable"
                    is TomTomService.RouteOutcome.NoKey -> "route_no_key"
                    else -> "route_unusable"
                }
                // Laquelle des causes : adresse refusée par le géocodeur (et son
                // score), trajet hors bornes, rapport prix/km aberrant. Mirror iOS.
                val detail = when {
                    outcome is TomTomService.RouteOutcome.Unusable -> outcome.detail
                    outcome is TomTomService.RouteOutcome.Unreachable -> outcome.detail
                    route == null -> null
                    route.distanceKm !in 0.1..2000.0 || route.durationMin > 1440 ->
                        String.format(java.util.Locale.ROOT, "bounds km=%.1f min=%d", route.distanceKm, route.durationMin)
                    else ->
                        String.format(java.util.Locale.ROOT, "ratio fare=%.2f km=%.1f", ocr.fare, route.distanceKm)
                }
                ScanBridgeModule.emitScanFailure(
                    this, reason, detail,
                    platform = ocr.platform.name,
                    // Une adresse refusée par le géocodeur se rejoue ; un réseau
                    // coupé ne dit rien sur la lecture de l'écran.
                    blocks = if (network) null else debugBlocks,
                    screenHeight = screenHeight,
                    parsed = ocr,
                )
                ScanBridgeModule.emitScanFailed()
                finishScan(token)
                return@calculateRoute
            }

            val finalResult = ocr.copy(
                distanceKm = route.distanceKm,
                durationMin = route.durationMin,
                // Adresses canoniques TomTom (propres) plutôt que le texte OCR
                // bruité (ex: "All AV. … Çueue") — fallback OCR si absentes.
                pickupAddress = route.pickupFormatted ?: ocr.pickupAddress,
                destinationAddress = route.destFormatted ?: ocr.destinationAddress,
                pickupLat = route.pickupCoords?.lat?.let(OcrParser::roundedPoint),
                pickupLon = route.pickupCoords?.lon?.let(OcrParser::roundedPoint),
                destLat = route.destCoords?.lat?.let(OcrParser::roundedPoint),
                destLon = route.destCoords?.lon?.let(OcrParser::roundedPoint),
            )
            // Le scan ne compte qu'ICI, au verdict mesuré : un échec, une adresse
            // introuvable ou la garde ne consomment rien. Mirror iOS, et règle du
            // serveur, qui ne compte que les courses enregistrées. Le JS réécrit
            // la valeur réelle (compte DB) au prochain sync. Nouveau jour → 0.
            val today = todayKey()
            scanCountToday = (if (scanCountDay == today) scanCountToday else 0) + 1
            scanCountDay = today
            markActive(this)
            saveState(this)
            // Le compteur d'appareil suit le même scan, dans la même foulée : un
            // écart entre les deux ferait croire à un second compte et déclencherait
            // le refus « autre compte » sur un chauffeur seul.
            incrementDeviceScanCount(this)
            val metrics = computeMetrics(finalResult)
            applicationContext.getSharedPreferences(TAGGABLE_PREFS, MODE_PRIVATE).edit()
                .putString("rideId", rideId)
                .putString("fare", metrics.displayFare.toString())
                .putString("km", metrics.totalDistanceKm.toString())
                .apply()
            // La carte seule, pas de notification en plus : comme iOS, qui n'en
            // envoie une que si la Dynamic Island n'a rien pu afficher.
            mainHandler.post { showResultState(finalResult, rideId); applyVerdict(finalResult) }
            ScanBridgeModule.emitScanResult(this, finalResult, base64, debugBlocks, screenHeight, scanTs, rideId, geminiUsed)
            // En base dès le scan, après le journal, sans attendre le JS. Mirror iOS.
            RideUploader.upload(
                finalResult, rideId, scanTs,
                metrics.totalDistanceKm, metrics.totalDurationMin, metrics.hourlyRate, metrics.kmRate, fuelCostPerKm,
            )
            finishScan(token)
        }
    }

    /**
     * Calcule et applique le verdict couleur (rouge/orange/vert) sur la bulle
     * à partir d'un ScanResult final. Centralise le calcul utilisé par les
     * branches "skip TomTom" et "TomTom OK/KO".
     */
    /** Métriques finales d'une course (totaux selon includePickup) + verdict. */
    data class RideMetrics(
        val hourlyRate: Double,
        val kmRate: Double,
        val totalDurationMin: Int,
        val totalDistanceKm: Double,
        val level: Int,
        /** Tarif À AFFICHER : net du carburant estimé si la préférence est active,
         *  sinon égal à `result.fare`. Volontairement séparé — le brut reste la
         *  base des €/h, €/km, du verdict et de l'enregistrement. Mirror iOS
         *  (ScanProcessor.FinalResult.displayFare). */
        val displayFare: Double,
    )

    /** Vrai si le trajet d'approche est ajouté aux totaux : préférence active ET
     *  les deux valeurs présentes (une seule fausserait le total). */
    private fun usesApproach(result: OcrParser.ScanResult) = includePickup
        && result.pickupDurationMin != null
        && result.pickupDistanceKm != null

    /** Calcule les métriques + verdict (mirror iOS computeFinal) sans effet de bord. */
    private fun computeMetrics(result: OcrParser.ScanResult): RideMetrics {
        val useApproach = usesApproach(result)

        val courseDuration = result.durationMin?.toDouble() ?: estimateDurationMin(result.distanceKm)
        val totalDuration = if (useApproach)
            courseDuration + (result.pickupDurationMin?.toDouble() ?: 0.0)
        else courseDuration

        val totalDistance = if (useApproach)
            result.distanceKm + (result.pickupDistanceKm ?: 0.0)
        else result.distanceKm

        val hourlyRate = if (totalDuration > 0) result.fare / (totalDuration / 60.0) else 0.0
        val kmRate = if (totalDistance > 0) result.fare / totalDistance else 0.0
        val hrOk = hourlyRate >= minHourlyRate
        val kmOk = kmRate >= minKmRate
        val level = if (hrOk && kmOk) 2 else if (hrOk || kmOk) 1 else 0

        // Affichage seul : le verdict ci-dessus est calculé sur le tarif brut, les
        // seuils de l'utilisateur gardent donc le sens qu'ils ont toujours eu.
        val displayFare = if (deductFuel && fuelCostPerKm > 0)
            (result.fare - fuelCostPerKm * totalDistance).coerceAtLeast(0.0)
        else result.fare

        return RideMetrics(
            // Arrondi et non tronqué : 23,7 min s'affiche 24, comme sur iOS.
            hourlyRate, kmRate, Math.round(totalDuration).toInt(), totalDistance, level, displayFare
        )
    }

    private fun applyVerdict(result: OcrParser.ScanResult) {
        updateVerdict(computeMetrics(result).level)
    }

    // ─── Verdict ─────────────────────────────────────────────────────────────────

    /** @param level 0=rouge (nul), 1=orange (moyen), 2=vert (bien) */
    fun updateVerdict(level: Int) {
        mainHandler.post {
            val color = verdictColor(level)

            // Pilule du prix
            fareBadgeView?.background = farePillBackground(color)
            // Flèche du €/km
            verdictTriangleView?.setTextColor(color)
            // Trajet : voiture, trait, passager, verdict
            routeCarCircle?.background = circleBackground(color)
            routeLine?.background = routeLineBackground(color)
            routeCenterDot?.background = circleBackground(color)
            routeGpsCircle?.background = circleBackground(color)
            // Verdict au bout du trajet — comme le Dynamic Island (✓ / ! / ✕).
            routeGpsGlyphView?.text = mdi(verdictGlyphFor(level))
            // Countdown bar
            verdictBarView?.background = GradientDrawable().apply {
                setColor(color); cornerRadius = dpToPx(2).toFloat()
            }
        }
    }

    fun updateDuration(minutes: Int) {
        mainHandler.post {
            durationView?.text = "${minutes}min"
        }
    }

    /**
     * Met à jour toutes les métriques après calcul final JS (pickup + TomTom).
     * Appelé depuis ScanBridge.updateMetrics.
     */
    fun updateMetrics(hourlyRate: Double, kmRate: Double, durationMin: Int, distanceKm: Double) {
        mainHandler.post {
            hourlyRateView?.text = MarketFormat.money(this, hourlyRate, 0)
            kmRateView?.text = MarketFormat.perDistance(this, kmRate)
            durationView?.text = "${durationMin}min"
            distanceView?.text = MarketFormat.distanceText(this, distanceKm)
        }
    }

    /**
     * Met à jour la bulle avec les valeurs finales TomTom + verdict en un appel.
     */
    fun finalizeScan(
        hourlyRate: Double,
        kmRate: Double,
        durationMin: Int,
        distanceKm: Double,
        verdictLevel: Int,
    ) {
        mainHandler.post {
            hourlyRateView?.text = MarketFormat.money(this, hourlyRate, 0)
            kmRateView?.text = MarketFormat.perDistance(this, kmRate)
            durationView?.text = "${durationMin}min"
            distanceView?.text = MarketFormat.distanceText(this, distanceKm)
            updateVerdict(verdictLevel)
        }
    }

    // ─── UI States ────────────────────────────────────────────────────────────────

    private fun dpToPx(dp: Int) = (dp * resources.displayMetrics.density).toInt()

    /** Strings natives dans la langue choisie DANS Strive, pas celle du système :
     *  l'utilisateur peut mettre l'app en français sur un téléphone en anglais.
     *  Sans ça la bulle et les notifications suivaient la locale du téléphone,
     *  alors qu'iOS respecte déjà le réglage in-app. */
    private fun str(resId: Int): String {
        val ctx = localizedCtx ?: run {
            val lang = getSharedPreferences(LANG_PREFS, android.content.Context.MODE_PRIVATE)
                .getString(LANG_KEY, null)
            val resolved = if (lang.isNullOrBlank()) this else {
                val cfg = android.content.res.Configuration(resources.configuration)
                cfg.setLocale(java.util.Locale.forLanguageTag(lang))
                createConfigurationContext(cfg)
            }
            localizedCtx = resolved
            resolved
        }
        return ctx.getString(resId)
    }

    /**
     * Fallback durée quand l'OCR n'a pas pu lire le `min` de la course.
     * Heuristique vitesse moyenne par tranche de distance — calibration FR/EU
     * basée sur les vitesses moyennes observées (urbain dense / mixte / autoroute).
     * À garder en sync avec ScanProcessor.swift et DashboardScreen.tsx.
     */
    private fun estimateDurationMin(distanceKm: Double): Double = when {
        distanceKm < 5.0  -> distanceKm / 25.0 * 60.0   // urbain dense
        distanceKm < 20.0 -> distanceKm / 45.0 * 60.0   // mixte ville/péri
        else              -> distanceKm / 60.0 * 60.0   // péri-urbain / autoroute
    }

    private fun showIdleState() {
        clearTransientState()
        bubbleContainer.removeAllViews()
        shownRideId = null
        restingX?.let { bubbleParams.x = it; restingX = null }

        // Le logo seul, comme l'icône de l'app : ni pilule ni texte.
        val logoSize = dpToPx(48)
        val logo = ImageView(this).apply {
            setImageResource(com.strive.R.drawable.strive_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            // Ombre portée sur la forme du logo (carré arrondi), pas sur son cadre.
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, view.width * 0.23f)
                }
            }
            elevation = dpToPx(10).toFloat()
        }
        // Marge : l'ombre déborde du logo et la fenêtre la couperait.
        bubbleContainer.addView(logo, FrameLayout.LayoutParams(logoSize, logoSize).apply {
            setMargins(dpToPx(6), dpToPx(6), dpToPx(6), dpToPx(6))
        })
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showLoadingState() {
        clearTransientState()
        bubbleContainer.removeAllViews()
        // Le scan suivant remplace la carte, comme sur iOS ; la course d'avant
        // reste taguable depuis sa propre notification.
        shownRideId = null

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#E8000000"))
                cornerRadius = dpToPx(999).toFloat()
            }
            elevation = dpToPx(8).toFloat()
        }

        pill.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
        }, LinearLayout.LayoutParams(dpToPx(18), dpToPx(18)).apply {
            marginEnd = dpToPx(8)
        })

        pill.addView(TextView(this).apply {
            text = "Analyse…"; textSize = 13f
            setTextColor(Color.parseColor("#CCCCCC"))
            typeface = Typeface.DEFAULT_BOLD
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showResultState(result: OcrParser.ScanResult, rideId: String) {
        clearTransientState()
        bubbleContainer.removeAllViews()
        shownRideId = rideId

        val screenWidth = getScreenWidth()
        // À peu près la largeur de l'île étendue : l'écran moins ses marges.
        val cardW = (screenWidth * 0.92f).toInt().coerceAtMost(dpToPx(380))

        // Métriques provisoires affichées *tant que TomTom n'a pas répondu*.
        // Source unique : computeMetrics — il porte déjà la préférence
        // include_pickup_location, l'heuristique de durée et la déduction
        // carburant. Les recalculer ici avait fini par diverger.
        val m = computeMetrics(result)
        val color = verdictColor(m.level)
        val medium = Typeface.create("sans-serif-medium", Typeface.NORMAL)

        // ── Card ── Le Dynamic Island étendu, région par région
        // (`StriveLiveActivity.swift`) : même fond noir, mêmes tailles, mêmes
        // couleurs. Ce que le chauffeur lit dans l'île sur iPhone, il le lit
        // dans la bulle sur Android — et le tutoriel peut montrer l'un pour l'autre.
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(14))
            background = GradientDrawable().apply {
                setColor(Color.BLACK)
                cornerRadius = dpToPx(32).toFloat()
            }
            elevation = dpToPx(10).toFloat()
            // Tap sur la bulle → ouvre l'app sur l'écran Historique
            isClickable = true
            setOnClickListener { openAppHistory() }
        }

        // ═══════════════════════════════════════════════════════════════
        // ROW 1 : Plateforme ............ ↗ €X.XX/km  (leading / trailing)
        //         puis, centrés dessous : €XX/h [€XX]  (center)
        //   Dans l'île, les régions latérales flanquent la caméra et le
        //   centre passe en dessous : c'est cet étagement qu'on reproduit.
        // ═══════════════════════════════════════════════════════════════
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row1.addView(TextView(this).apply {
            text = result.platform.name.let { it[0] + it.substring(1).lowercase() }
            textSize = 14f; setTextColor(Color.argb(191, 255, 255, 255))
            typeface = medium
            includeFontPadding = false
        })

        val center = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val hourlyRateTv = TextView(this).apply {
            text = MarketFormat.money(this@FloatingBubbleService, m.hourlyRate, 0)
            textSize = 19f; setTextColor(Color.WHITE)
            typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
            includeFontPadding = false
        }
        hourlyRateView = hourlyRateTv
        center.addView(hourlyRateTv)
        center.addView(TextView(this).apply {
            text = "/h"
            textSize = 12f; setTextColor(Color.argb(140, 255, 255, 255))
            typeface = medium
            includeFontPadding = false
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginStart = dpToPx(2); marginEnd = dpToPx(10) })
        val fareBadge = TextView(this).apply {
            // Net de carburant si la préférence est active (affichage seul).
            // Centimes gardés quand le montant n'est pas rond. Mirror iOS (`striveFareText`).
            text = MarketFormat.fare(this@FloatingBubbleService, m.displayFare)
            textSize = 14f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dpToPx(12), dpToPx(5), dpToPx(12), dpToPx(5))
            background = farePillBackground(color)
            includeFontPadding = false
        }
        fareBadgeView = fareBadge
        center.addView(fareBadge)
        row1.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))

        val kmArrow = TextView(this).apply {
            text = mdi(MDI_ARROW_UP_RIGHT)
            typeface = iconFont; textSize = 13f; setTextColor(color)
            includeFontPadding = false
        }
        verdictTriangleView = kmArrow
        row1.addView(kmArrow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(4) })
        val kmRateTv = TextView(this).apply {
            text = MarketFormat.perDistance(this@FloatingBubbleService, m.kmRate)
            textSize = 14f; setTextColor(Color.WHITE)
            typeface = medium
            includeFontPadding = false
        }
        kmRateView = kmRateTv
        row1.addView(kmRateTv)

        card.addView(row1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(4) })
        card.addView(center, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(12) })

        // ═══════════════════════════════════════════════════════════════
        // ROW 2 : (voiture) ━━(passager)━━ 29min/12.9km (✓) — `RouteRow`.
        //   Cercles, trait et passager recolorés par updateVerdict.
        // ═══════════════════════════════════════════════════════════════
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val circleSize = dpToPx(24)

        val (carCircle, _) = iconCircle(MDI_CAR, circleSize, 11f, color)
        routeCarCircle = carCircle
        row2.addView(carCircle, LinearLayout.LayoutParams(circleSize, circleSize))

        val lineWrapper = FrameLayout(this)
        val lineView = View(this).apply { background = routeLineBackground(color) }
        routeLine = lineView
        lineWrapper.addView(lineView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, dpToPx(4)
        ).apply { gravity = Gravity.CENTER_VERTICAL })
        val riderSize = dpToPx(20)
        val (riderCircle, _) = iconCircle(MDI_PERSON_WAVE, riderSize, 10f, color)
        routeCenterDot = riderCircle
        lineWrapper.addView(riderCircle, FrameLayout.LayoutParams(riderSize, riderSize).apply {
            gravity = Gravity.CENTER
        })
        row2.addView(lineWrapper, LinearLayout.LayoutParams(
            0, circleSize, 1f
        ).apply { marginStart = dpToPx(10); marginEnd = dpToPx(10) })

        val rightCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
        }
        val durationTv = TextView(this).apply {
            // "—min" quand la durée affichée ne repose que sur l'estimation
            // vitesse : ni durée de course lue, ni approche ajoutée au total.
            text = if (result.durationMin != null || usesApproach(result))
                "${m.totalDurationMin}min"
            else "—min"
            textSize = 14f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }
        durationView = durationTv
        // Largeur au contenu, explicitement : par défaut une colonne verticale
        // donne MATCH_PARENT, et la durée finale (« 43min » après « —min »)
        // était coupée à la largeur de l'ancienne.
        rightCol.addView(durationTv, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        val distanceTv = TextView(this).apply {
            text = MarketFormat.distanceText(
                this@FloatingBubbleService, m.totalDistanceKm)
            textSize = 11f; setTextColor(Color.argb(140, 255, 255, 255))
            typeface = medium
            includeFontPadding = false
        }
        distanceView = distanceTv
        rightCol.addView(distanceTv, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dpToPx(1) })
        row2.addView(rightCol, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(10) })

        // Verdict au bout du trajet : ✓ / ! / ✕, comme l'île.
        val (verdictCircle, verdictGlyph) = iconCircle(verdictGlyphFor(m.level), circleSize, 11f, color)
        routeGpsGlyphView = verdictGlyph
        routeGpsCircle = verdictCircle
        row2.addView(verdictCircle, LinearLayout.LayoutParams(circleSize, circleSize))

        card.addView(row2, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // ═══════════════════════════════════════════════════════════════
        // ROW 3 : [✕ Refusée] [✓ Prise] — `DecisionButtons` de l'île : deux
        //   capsules pleines, rouge et verte, icône puis libellé.
        // ═══════════════════════════════════════════════════════════════
        val row3 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun decisionButton(label: Int, glyph: Int, bg: Int, status: String): DecisionButton {
            val icon = TextView(this).apply {
                text = mdi(glyph); typeface = iconFont
                textSize = 13f; setTextColor(Color.WHITE)
                includeFontPadding = false
            }
            val text = TextView(this).apply {
                text = str(label)
                textSize = 13f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
                includeFontPadding = false
            }
            val button = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                // 32 et non les 28 pt de l'île : la cible est sous le pouce, en voiture.
                minimumHeight = dpToPx(32)
                background = GradientDrawable().apply {
                    setColor(bg)
                    cornerRadius = dpToPx(16).toFloat()
                }
                isClickable = true
                addView(icon, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = dpToPx(5) })
                addView(text)
            }
            return DecisionButton(button, icon, text, status, bg)
        }
        val declined = decisionButton(com.strive.R.string.scanner_ride_declined, MDI_CLOSE, VERDICT_RED, "DECLINED")
        val taken = decisionButton(com.strive.R.string.scanner_ride_taken, MDI_CHECK, VERDICT_GREEN, "ACCEPTED")
        declined.button.setOnClickListener { onDecisionTapped(card, row3, declined, rideId) }
        taken.button.setOnClickListener { onDecisionTapped(card, row3, taken, rideId) }
        row3.addView(
            declined.button,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dpToPx(8) },
        )
        row3.addView(
            taken.button,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        card.addView(row3, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dpToPx(10) })

        bubbleContainer.addView(card, FrameLayout.LayoutParams(cardW, LayoutParams.WRAP_CONTENT))
        animateTo(cardW, LayoutParams.WRAP_CONTENT)

        // Centrée, comme l'île ; la bulle reprend sa place au retour au repos.
        if (restingX == null) restingX = bubbleParams.x
        bubbleParams.x = ((screenWidth - cardW) / 2).coerceAtLeast(0)
        runCatching { windowManager.updateViewLayout(bubbleContainer, bubbleParams) }

        // Au bout de 10 s, retour direct au logo : la carte a dit ce qu'elle
        // avait à dire, et la course reste taguable depuis sa notification.
        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(COUNTDOWN_MS, COUNTDOWN_MS) {
            override fun onTick(millisLeft: Long) {}
            override fun onFinish() { mainHandler.post { showIdleState() } }
        }.start()
    }

    // ─── Confirmation Prise / Refusée ────────────────────────────────────────────

    private class DecisionButton(
        val button: LinearLayout,
        val icon: TextView,
        val label: TextView,
        val status: String,
        val color: Int,
    )

    /** La décision part TOUT DE SUITE — l'animation n'est qu'un accusé de
     *  réception, rien n'attend qu'elle finisse. Puis retour au logo. */
    private fun onDecisionTapped(
        card: LinearLayout,
        row: LinearLayout,
        chosen: DecisionButton,
        rideId: String,
    ) {
        if (decisionAnimating) return
        decisionAnimating = true
        countdownTimer?.cancel()
        countdownTimer = null
        val accepted = chosen.status == "ACCEPTED"
        applyRideDecision(this, rideId, chosen.status, returnToIdle = false)
        chosen.button.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (accepted) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.VIRTUAL_KEY
            }
        )
        val total = animateDecisionReveal(card, row, chosen, accepted)
        mainHandler.postDelayed({
            if (decisionAnimating && shownRideId == rideId) showIdleState()
        }, total)
    }

    private fun confirmLabel(accepted: Boolean) = str(
        if (accepted) com.strive.R.string.scanner_ride_accepted else com.strive.R.string.scanner_ride_declined
    )

    /** Un cercle de la couleur du bouton part de son icône et remplit la carte,
     *  puis le bloc se rétracte vers le centre jusqu'à une pastille de 40 % de
     *  sa largeur et de sa hauteur — la carte entière en couleur, c'était trop,
     *  la moitié encore un peu (choix de l'utilisateur, 2026-10-21). La coche ou
     *  la croix s'y trace d'un trait, « Acceptée » / « Refusée » à côté, puis
     *  tout s'efface vers le logo. */
    private fun animateDecisionReveal(
        card: LinearLayout,
        row: LinearLayout,
        chosen: DecisionButton,
        accepted: Boolean,
    ): Long {
        val w = card.width
        val h = card.height
        if (w == 0 || h == 0) return 0L
        val pillScale = 0.4f
        val startRadius = dpToPx(32).toFloat()
        val shape = GradientDrawable().apply {
            setColor(chosen.color)
            cornerRadius = startRadius
        }
        val overlay = FrameLayout(this).apply {
            background = shape
            elevation = card.elevation
            visibility = View.INVISIBLE
        }
        val glyph = StrokeGlyphView(this, check = accepted)
        val label = TextView(this).apply {
            text = confirmLabel(accepted)
            textSize = 16f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
            alpha = 0f
            translationX = -dpToPx(6).toFloat()
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(glyph, LinearLayout.LayoutParams(dpToPx(26), dpToPx(26)))
            addView(label, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dpToPx(6) })
        }
        overlay.addView(content, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))
        // Centré : la carte, devenue transparente, garde la hauteur de la bulle,
        // et le bloc se rétracte vers son milieu.
        val lp = FrameLayout.LayoutParams(w, h, Gravity.CENTER)
        bubbleContainer.addView(overlay, lp)

        // Centre de l'icône touchée, en coordonnées de la carte.
        val cx = row.left + chosen.button.left + chosen.icon.left + chosen.icon.width / 2
        val cy = row.top + chosen.button.top + chosen.button.height / 2
        overlay.post {
            overlay.visibility = View.VISIBLE
            val maxR = hypot(max(cx, w - cx).toFloat(), max(cy, h - cy).toFloat())
            ViewAnimationUtils.createCircularReveal(overlay, cx, cy, 0f, maxR).apply {
                duration = 260
                interpolator = DecelerateInterpolator()
            }.start()
            card.animate().alpha(0f).setStartDelay(200).setDuration(120).start()
            ValueAnimator.ofFloat(0f, 1f).apply {
                startDelay = 220
                duration = 320
                interpolator = DecelerateInterpolator(1.6f)
                addUpdateListener {
                    val f = it.animatedValue as Float
                    lp.width = (w - w * (1f - pillScale) * f).toInt()
                    lp.height = (h - h * (1f - pillScale) * f).toInt()
                    // De l'arrondi de la carte à une pastille.
                    shape.cornerRadius = startRadius + (h * pillScale / 2f - startRadius) * f
                    overlay.layoutParams = lp
                }
            }.start()
            ValueAnimator.ofFloat(0f, 1f).apply {
                startDelay = 420
                duration = 320
                interpolator = DecelerateInterpolator()
                addUpdateListener { glyph.progress = it.animatedValue as Float }
            }.start()
            label.animate().alpha(1f).translationX(0f).setStartDelay(520).setDuration(200).start()
        }
        mainHandler.postDelayed({
            if (overlay.isAttachedToWindow) {
                overlay.animate().alpha(0f).scaleX(0.9f).scaleY(0.9f).setDuration(180).start()
            }
        }, 1450L)
        return 1650L
    }

    /** Une coche ou une croix qui se trace d'un trait, de 0 à `progress`. */
    private class StrokeGlyphView(ctx: android.content.Context, private val check: Boolean) : View(ctx) {
        var progress = 0f
            set(value) {
                field = value
                invalidate()
            }
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = Color.WHITE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val path = Path()
        private val segment = Path()
        private val lengths = ArrayList<Float>()

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            val s = minOf(w, h).toFloat()
            paint.strokeWidth = s * 0.11f
            path.reset()
            if (check) {
                path.moveTo(s * 0.22f, s * 0.54f)
                path.lineTo(s * 0.42f, s * 0.72f)
                path.lineTo(s * 0.78f, s * 0.32f)
            } else {
                path.moveTo(s * 0.28f, s * 0.28f)
                path.lineTo(s * 0.72f, s * 0.72f)
                path.moveTo(s * 0.72f, s * 0.28f)
                path.lineTo(s * 0.28f, s * 0.72f)
            }
            lengths.clear()
            val pm = PathMeasure(path, false)
            do { lengths.add(pm.length) } while (pm.nextContour())
        }

        override fun onDraw(canvas: Canvas) {
            if (progress <= 0f || lengths.isEmpty()) return
            var remaining = lengths.sum() * progress
            val pm = PathMeasure(path, false)
            var i = 0
            do {
                if (remaining <= 0f || i >= lengths.size) break
                segment.reset()
                pm.getSegment(0f, minOf(lengths[i], remaining), segment, true)
                canvas.drawPath(segment, paint)
                remaining -= lengths[i]
                i++
            } while (pm.nextContour())
        }
    }

    // ─── Matériau du Dynamic Island ──────────────────────────────────────────────

    /** Police d'icônes de l'app (MaterialCommunityIcons, déjà embarquée pour le
     *  JS) : les symboles de l'île — voiture, passager, ✓, ↗ — sans un seul
     *  vecteur à dessiner. */
    private val iconFont: Typeface by lazy {
        runCatching { Typeface.createFromAsset(assets, "fonts/MaterialCommunityIcons.ttf") }
            .getOrDefault(Typeface.DEFAULT_BOLD)
    }

    private fun mdi(codePoint: Int) = String(Character.toChars(codePoint))

    private fun verdictColor(level: Int) = when (level) {
        2 -> VERDICT_GREEN; 1 -> VERDICT_ORANGE; else -> VERDICT_RED
    }

    private fun verdictGlyphFor(level: Int) = when (level) {
        2 -> MDI_CHECK; 1 -> MDI_EXCLAMATION; else -> MDI_CLOSE
    }

    private fun withAlpha(color: Int, alpha: Float) =
        Color.argb((alpha * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    /** `FarePill` : fond teinté à 28 %, liseré à 85 %. */
    private fun farePillBackground(color: Int) = GradientDrawable().apply {
        setColor(withAlpha(color, 0.28f))
        cornerRadius = dpToPx(999).toFloat()
        setStroke(dpToPx(1), withAlpha(color, 0.85f))
    }

    private fun routeLineBackground(color: Int) = GradientDrawable().apply {
        setColor(withAlpha(color, 0.85f))
        cornerRadius = dpToPx(2).toFloat()
    }

    private fun circleBackground(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    /** Pastille pleine, glyphe noir au centre — les cercles de `RouteRow`. */
    private fun iconCircle(glyph: Int, sizePx: Int, glyphSp: Float, color: Int): Pair<FrameLayout, TextView> {
        val glyphView = TextView(this).apply {
            text = mdi(glyph); typeface = iconFont
            textSize = glyphSp; setTextColor(Color.BLACK)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }
        val circle = FrameLayout(this).apply {
            background = circleBackground(color)
            addView(glyphView, FrameLayout.LayoutParams(sizePx, sizePx).apply { gravity = Gravity.CENTER })
        }
        return circle to glyphView
    }

    /** Décision prise dans l'app : la bulle quitte cette course. Mirror iOS
     *  (`LiveActivityManager.clearResult`). */
    fun clearShownRide(rideId: String) {
        mainHandler.post { if (shownRideId == rideId) showIdleState() }
    }

    private fun showQuotaReachedState() {
        clearTransientState()
        bubbleContainer.removeAllViews()

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FF9800"))   // orange = limite atteinte
                cornerRadius = dpToPx(999).toFloat()
            }
            elevation = dpToPx(8).toFloat()
            isClickable = true
            // Tap sur la pill → ouvre l'app (probablement écran abonnement)
            setOnClickListener { openAppHistory() }
        }
        pill.addView(TextView(this).apply {
            text = "🔒"; textSize = 14f
            setPadding(0, 0, dpToPx(6), 0)
        })
        pill.addView(TextView(this).apply {
            // Un free bloqué voit la sortie sur la pastille elle-même : c'est le
            // seul moment où la proposition est vraie ET utile — il vient de
            // buter sur sa limite, sur une course qu'il ne pourra pas évaluer.
            // Le tap ouvre déjà l'app, la pastille devient donc le point d'entrée.
            //
            // `str(...)` et plus un littéral : ce texte suivait la locale du
            // téléphone alors que tout le reste suit la langue choisie DANS
            // Strive.
            text = str(
                if (isFreeTier) com.strive.R.string.scanner_quota_reached_free
                else com.strive.R.string.scanner_quota_reached
            )
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    /**
     * Pastille d'échec. [network] choisit le motif : « erreur réseau » se retente
     * tel quel, « capture illisible » demande une autre capture. Le libellé était
     * codé en dur (« Échec ») et ne disait donc rien de ce qu'il fallait faire.
     */
    private fun showErrorState(
        network: Boolean = false,
        textRes: Int = if (network) com.strive.R.string.scanner_error_network
                       else com.strive.R.string.scanner_error_capture,
    ) {
        clearTransientState()
        bubbleContainer.removeAllViews()

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#CC2D2D"))
                cornerRadius = dpToPx(999).toFloat()
            }
            elevation = dpToPx(8).toFloat()
        }
        pill.addView(TextView(this).apply {
            text = "✕"; textSize = 14f; setTextColor(Color.WHITE)
            setPadding(0, 0, dpToPx(6), 0)
        })
        pill.addView(TextView(this).apply {
            text = str(textRes)
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showNotARideState(textRes: Int = com.strive.R.string.scanner_not_a_ride) {
        clearTransientState()
        bubbleContainer.removeAllViews()

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#555555"))
                cornerRadius = dpToPx(999).toFloat()
            }
            elevation = dpToPx(8).toFloat()
        }
        pill.addView(TextView(this).apply {
            text = "🔍"; textSize = 14f
            setPadding(0, 0, dpToPx(6), 0)
        })
        pill.addView(TextView(this).apply {
            // Localisé via strings.xml (fr) / values-en (en) — suit la locale appareil.
            text = str(textRes)
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            // La consigne de langue tient sur deux lignes : sans borne, la pastille
            // déborderait de l'écran.
            maxWidth = dpToPx(260)
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    /** Bulle « passez en ligne » — affichée quand on tente un scan hors session. */
    private fun showSessionRequiredState() {
        clearTransientState()
        bubbleContainer.removeAllViews()

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FF9800"))
                cornerRadius = dpToPx(999).toFloat()
            }
            elevation = dpToPx(8).toFloat()
            isClickable = true
            setOnClickListener { openAppHistory() }
        }
        pill.addView(TextView(this).apply {
            text = "⏸"; textSize = 14f
            setPadding(0, 0, dpToPx(6), 0)
        })
        pill.addView(TextView(this).apply {
            text = str(com.strive.R.string.scanner_session_required_bubble)
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })
        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    /** Tap sur une notification du scanner → ouvre l'app, comme sur iOS. */
    private fun launchAppPi(): android.app.PendingIntent {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return android.app.PendingIntent.getActivity(
            this, 0, launch ?: Intent(),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    /** Notification système invitant à démarrer la session. Tap → ouvre l'app. */
    private fun notifySessionRequired() {
        val notif = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setContentTitle(str(com.strive.R.string.scanner_session_required_title))
            .setContentText(str(com.strive.R.string.scanner_session_required_body))
            .setSmallIcon(com.strive.R.drawable.ic_stat_strive)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(launchAppPi())
            .build()
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(SESSION_NOTIF_ID, notif)
    }

    private fun animateTo(w: Int, h: Int) {
        bubbleParams.width = w; bubbleParams.height = h
        runCatching { windowManager.updateViewLayout(bubbleContainer, bubbleParams) }
    }

    // ─── Notification ─────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(CHANNEL_ID, "Scanner VTC", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Bulle de scan active" }
            mgr.createNotificationChannel(ch)
            // Channel d'alertes ponctuelles (session requise) — visible.
            val alertCh = NotificationChannel(ALERT_CHANNEL_ID, "Alertes Strive", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "Notifications d'action requise (session, quota)" }
            mgr.createNotificationChannel(alertCh)
        }
    }

    private fun buildNotification(): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(com.strive.R.drawable.ic_stat_strive)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(launchAppPi())
        // Temps en ligne qui défile, comme le minuteur de la Live Activity.
        if (sessionOnline && sessionStartMs > 0) {
            builder.setUsesChronometer(true).setShowWhen(true).setWhen(sessionStartMs)
        }
        // KPI de session (poussés par le JS) → mini tableau de bord persistant,
        // équivalent du dashboard de la Live Activity iOS. Avant le 1ᵉ push : texte d'invite.
        if (hasSessionKpi) {
            builder.setContentTitle(
                MarketFormat.money(this, todayEarnings, 0) + " · " +
                    MarketFormat.perHour(this, todayHourlyRate)
            ).setContentText(
                "%s · %dh%02d %s".format(
                    MarketFormat.distanceText(this, todayKm), onlineMinutes / 60, onlineMinutes % 60,
                    str(com.strive.R.string.scanner_notif_online)
                )
            )
        } else {
            builder.setContentTitle(str(com.strive.R.string.scanner_notif_active_title))
                .setContentText(str(com.strive.R.string.scanner_notif_active_body))
        }
        return builder.build()
    }

    /** Re-poste la notification persistante du foreground service (mise à jour KPI). */
    fun refreshForegroundNotification() {
        runCatching {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIF_ID, buildNotification())
        }
    }
}

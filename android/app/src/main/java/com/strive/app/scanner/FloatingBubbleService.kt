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
import android.widget.*
import androidx.core.app.NotificationCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.strive.BuildConfig

class FloatingBubbleService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var bubbleContainer: FrameLayout
    private lateinit var bubbleParams: LayoutParams

    private val mainHandler = Handler(Looper.getMainLooper())
    private var scanInProgress = false
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
        /** Notification de résultat de scan avec boutons Accepter / Refuser.
         *  Non privé : `ScanBridgeModule.clearRideResult` l'annule quand la
         *  décision a été prise dans l'app. */
        const val RESULT_NOTIF_ID = 44
        private const val COUNTDOWN_MS = 15_000L
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

        /** KPI de session du jour poussés par le JS (updateSessionKPI) — affichés
         *  dans la notification persistante du foreground service. Équivalent
         *  Android du tableau de bord Live Activity iOS. */
        var todayEarnings: Double = 0.0
        var todayHourlyRate: Double = 0.0
        var todayKm: Double = 0.0
        var onlineMinutes: Int = 0
        var hasSessionKpi: Boolean = false

        fun updateSessionKpi(todayEarnings: Double, todayHourlyRate: Double, todayKm: Double, onlineMinutes: Int) {
            this.todayEarnings = todayEarnings
            this.todayHourlyRate = todayHourlyRate
            this.todayKm = todayKm
            this.onlineMinutes = onlineMinutes
            hasSessionKpi = true
            instance?.refreshForegroundNotification()
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
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
        setupBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY

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
            mainHandler.postDelayed({ showIdleState() }, 2500)
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
        val quotaByCount = scanQuotaLimit > 0 && scanCountForToday() >= scanQuotaLimit
        if (quotaReached || quotaByCount) {
            ScanBridgeModule.emitScanFailure(this, "quota_reached")
            showQuotaReachedState()
            mainHandler.postDelayed({ showIdleState() }, 2500)
            return
        }
        scanInProgress = true
        showLoadingState()

        mainHandler.postDelayed({
            val svc = StriveAccessibilityService.instance
            if (svc == null) {
                onScanError(); scanInProgress = false
                ScanBridgeModule.emitScanFailure(this, "invalid_image", "no_accessibility_service")
                ScanBridgeModule.emitScanFailed(); return@postDelayed
            }
            svc.captureScreen { bitmap ->
                if (bitmap == null) {
                    mainHandler.post { onScanError() }
                    scanInProgress = false
                    ScanBridgeModule.emitScanFailure(this, "invalid_image", "null_bitmap")
                    ScanBridgeModule.emitScanFailed(); return@captureScreen
                }
                runOcr(bitmap, getScreenWidth(), getScreenHeight())
            }
        }, 50)
    }

    private fun runOcr(fullBitmap: Bitmap, w: Int, h: Int) {
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
                val result = OcrParser.parse(visionText, w, h, fullBitmap)
                val debugBlocks = OcrParser.dumpBlocks(visionText)
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
                    resolveTomTomAndEmit(result, base64, debugBlocks, h)
                    scanInProgress = false
                } else if (OcrParser.looksLikeRideOffer(visionText.text)) {
                    fallbackGemini(fullBitmap)
                } else {
                    // Pré-filtre anti-pub : du texte a été lu mais aucun signal VTC
                    // (prix €, km/min, plateforme) → inutile de payer un appel Gemini.
                    // Mirror iOS (ScanProcessor.lastScanMayBeRide).
                    fullBitmap.recycle()
                    onNotARide()
                    ScanBridgeModule.emitScanFailure(this, "not_a_ride")
                    ScanBridgeModule.emitScanFailed()
                    scanInProgress = false
                }
            }
            .addOnFailureListener {
                ocrBitmap?.recycle()
                fallbackGemini(fullBitmap)
            }
    }

    private fun fallbackGemini(bitmap: Bitmap) {
        if (GeminiVisionService.isReady) {
            showLoadingState()
            // On encode d'abord : si Gemini natif réussit on transmettra aussi
            // l'image au JS (il peut l'utiliser en retry sanity-check).
            val base64 = GeminiVisionService.encodeForBridge(bitmap)
            GeminiVisionService.analyze(bitmap) { result ->
                bitmap.recycle()
                if (result != null) {
                    // B : on route le résultat Gemini par la MÊME résolution TomTom
                    // que l'OCR (adresses → vraie distance). Gemini peut désormais
                    // renvoyer pickup/destination → TomTom s'applique aussi ici.
                    resolveTomTomAndEmit(result, base64, null)
                } else {
                    mainHandler.post {
                        onScanError()
                        ScanBridgeModule.emitScanFailure(this, "gemini_ko", "null_result")
                        ScanBridgeModule.emitScanFailed()
                    }
                }
                scanInProgress = false
            }
        } else {
            bitmap.recycle()
            onScanError()
            ScanBridgeModule.emitScanFailure(this, "gemini_ko", "not_configured")
            ScanBridgeModule.emitScanFailed()
            scanInProgress = false
        }
    }

    private fun onScanError() {
        mainHandler.post { showErrorState() }
        mainHandler.postDelayed({ showIdleState() }, 2500)
    }

    /** Écran scanné sans signal d'offre VTC (pub, etc.) — pas d'appel Gemini. */
    private fun onNotARide() {
        mainHandler.post { showNotARideState() }
        mainHandler.postDelayed({ showIdleState() }, 2500)
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
        screenHeight: Int = 0,
    ) {
        // Scan réussi (OCR a produit un résultat) → on incrémente le compteur
        // natif. Le JS réécrira la valeur réelle (compte DB) au prochain sync.
        // Nouveau jour → on repart de 0 avant d'incrémenter.
        val today = todayKey()
        scanCountToday = (if (scanCountDay == today) scanCountToday else 0) + 1
        scanCountDay = today
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
            // Pas d'adresses ou pas de clé → affiche direct les valeurs OCR.
            if (BuildConfig.DEBUG) android.util.Log.d("StriveScan", "TomTom SKIP (adresse vide ou clé absente) → valeurs OCR")
            mainHandler.post { showResultState(ocr); applyVerdict(ocr); postRideDecisionNotification(ocr, rideId) }
            ScanBridgeModule.emitScanResult(this, ocr, base64, debugBlocks, screenHeight, scanTs, rideId)
            return
        }

        TomTomService.calculateRoute(pickup, dest) { route ->
            if (BuildConfig.DEBUG) android.util.Log.d("StriveScan", "TomTom route=$route (OCR dist=${ocr.distanceKm} dur=${ocr.durationMin})")
            val ratio = if (route != null && route.distanceKm > 0) ocr.fare / route.distanceKm else 0.0
            val finalResult = if (route != null
                && route.distanceKm in 0.3..500.0
                && route.durationMin != null && route.durationMin <= 300
                && ratio in 0.2..12.0) {
                ocr.copy(
                    distanceKm = route.distanceKm,
                    durationMin = route.durationMin,
                    // Adresses canoniques TomTom (propres) plutôt que le texte OCR
                    // bruité (ex: "All AV. … Çueue") — fallback OCR si absentes.
                    pickupAddress = route.pickupFormatted ?: ocr.pickupAddress,
                    destinationAddress = route.destFormatted ?: ocr.destinationAddress,
                )
            } else {
                ocr
            }
            mainHandler.post { showResultState(finalResult); applyVerdict(finalResult); postRideDecisionNotification(finalResult, rideId) }
            ScanBridgeModule.emitScanResult(this, finalResult, base64, debugBlocks, screenHeight, scanTs, rideId)
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
            hourlyRate, kmRate, totalDuration.toInt(), totalDistance, level, displayFare
        )
    }

    private fun applyVerdict(result: OcrParser.ScanResult) {
        updateVerdict(computeMetrics(result).level)
    }

    // ─── Verdict ─────────────────────────────────────────────────────────────────

    /** @param level 0=rouge (nul), 1=orange (moyen), 2=vert (bien) */
    fun updateVerdict(level: Int) {
        mainHandler.post {
            val color = when (level) {
                2    -> Color.parseColor("#00C853")  // vert
                1    -> Color.parseColor("#FF9800")  // orange
                else -> Color.parseColor("#EF4444")  // rouge
            }
            val r = dpToPx(12).toFloat()
            val rc = dpToPx(14).toFloat()

            // Badge prix
            fareBadgeView?.background = GradientDrawable().apply { setColor(color); cornerRadius = r }
            // Triangle
            verdictTriangleView?.setTextColor(color)
            // Route : cercle voiture + ligne + dot central + cercle warning
            routeCarCircle?.background = GradientDrawable().apply { setColor(color); cornerRadius = rc }
            routeLine?.setBackgroundColor(color)
            routeCenterDot?.background = GradientDrawable().apply { setColor(color); cornerRadius = dpToPx(5).toFloat() }
            routeGpsCircle?.background = GradientDrawable().apply { setColor(color); cornerRadius = rc }
            // Verdict au bout de la ligne — comme la Live Activity iOS (✓ / ! / ✕).
            routeGpsGlyphView?.text = when (level) { 2 -> "✓"; 1 -> "!"; else -> "✕" }
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
            hourlyRateView?.text = "€%.0f".format(hourlyRate)
            kmRateView?.text = "↑€%.2f/km".format(kmRate)
            durationView?.text = "${durationMin}min"
            distanceView?.text = "%.1f km".format(distanceKm)
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
            hourlyRateView?.text = "€%.0f".format(hourlyRate)
            kmRateView?.text = "↑€%.2f/km".format(kmRate)
            durationView?.text = "${durationMin}min"
            distanceView?.text = "%.1f km".format(distanceKm)
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

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(6), dpToPx(6), dpToPx(14), dpToPx(6))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#E8000000"))
                cornerRadius = dpToPx(999).toFloat()
                setStroke(dpToPx(1), Color.parseColor("#3300E676"))
            }
            elevation = dpToPx(10).toFloat()
        }

        val logoSize = dpToPx(30)
        pill.addView(ImageView(this).apply {
            setImageResource(com.strive.R.drawable.strive_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(logoSize, logoSize).apply {
            marginEnd = dpToPx(8)
        })

        pill.addView(TextView(this).apply {
            text = "Strive"; textSize = 14f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showLoadingState() {
        clearTransientState()
        bubbleContainer.removeAllViews()

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

    private fun showResultState(result: OcrParser.ScanResult) {
        clearTransientState()
        bubbleContainer.removeAllViews()

        val screenWidth = getScreenWidth()
        val cardW = (screenWidth * 0.76f).toInt().coerceAtMost(dpToPx(320))

        // Métriques provisoires affichées *tant que TomTom n'a pas répondu*.
        // Source unique : computeMetrics — il porte déjà la préférence
        // include_pickup_location, l'heuristique de durée et la déduction
        // carburant. Les recalculer ici avait fini par diverger.
        val m = computeMetrics(result)
        val hourlyRate = m.hourlyRate
        val kmRate = m.kmRate

        // ── Card ──
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F01A1A1A"))
                cornerRadius = dpToPx(18).toFloat()
            }
            elevation = dpToPx(10).toFloat()
            // Tap sur la bulle → ouvre l'app sur l'écran Historique
            isClickable = true
            setOnClickListener { openAppHistory() }
        }

        // ═══════════════════════════════════════════════════════════════
        // ROW 1 : Platform | €XX/h | [€XX pill] | ↑€X.XX/km | ▼
        // ═══════════════════════════════════════════════════════════════
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        // ── Zone GAUCHE : Platform + €/h ──
        val leftZone = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
        }
        leftZone.addView(TextView(this).apply {
            text = result.platform.name.let { it[0] + it.substring(1).lowercase() }
            textSize = 15f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(6) })
        val hourlyRateTv = TextView(this).apply {
            text = "€%.0f".format(hourlyRate)
            textSize = 21f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }
        hourlyRateView = hourlyRateTv
        leftZone.addView(hourlyRateTv)
        leftZone.addView(TextView(this).apply {
            text = "/h"
            textSize = 13f; setTextColor(Color.parseColor("#999999"))
            includeFontPadding = false
        })
        row1.addView(leftZone, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // ── Zone MILIEU : Fare pill ──
        val middleZone = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val fareBadge = TextView(this).apply {
            // Net de carburant si la préférence est active (affichage seul).
            text = "€%.0f".format(m.displayFare)
            textSize = 15f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dpToPx(10), dpToPx(4), dpToPx(10), dpToPx(4))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#CC3333"))
                cornerRadius = dpToPx(11).toFloat()
            }
            includeFontPadding = false
        }
        fareBadgeView = fareBadge
        middleZone.addView(fareBadge)
        row1.addView(middleZone, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // ── Zone DROITE : ↑€/km + ▼ ──
        val rightZone = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        val kmRateTv = TextView(this).apply {
            text = "↑€%.2f/km".format(kmRate)
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }
        kmRateView = kmRateTv
        rightZone.addView(kmRateTv)
        val triangle = TextView(this).apply {
            text = "▼"; textSize = 11f
            setTextColor(Color.parseColor("#666666"))
            includeFontPadding = false
        }
        verdictTriangleView = triangle
        rightZone.addView(triangle, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginStart = dpToPx(4) })
        row1.addView(rightZone, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        card.addView(row1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(8) })

        // ═══════════════════════════════════════════════════════════════
        // ROW 2 : [🚗] —— ● —— [29min / 12.9km] [ⓘ]
        //   Circles, line, dot recolor via updateVerdict
        // ═══════════════════════════════════════════════════════════════
        val neutralColor = Color.parseColor("#555555")
        val circleSize = dpToPx(18)
        val dotSize = dpToPx(10)

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        // Car circle (pickup)
        val carView = FrameLayout(this).apply {
            background = GradientDrawable().apply { setColor(neutralColor); cornerRadius = circleSize / 2f }
        }
        carView.addView(TextView(this).apply {
            text = "▶"; textSize = 8f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            includeFontPadding = false
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ).apply { gravity = Gravity.CENTER })
        routeCarCircle = carView
        row2.addView(carView, LinearLayout.LayoutParams(circleSize, circleSize))

        // Connecting line with center dot overlay
        val lineWrapper = FrameLayout(this)
        val lineView = View(this).apply { setBackgroundColor(neutralColor) }
        routeLine = lineView
        lineWrapper.addView(lineView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, dpToPx(2)
        ).apply { gravity = Gravity.CENTER_VERTICAL })
        val centerDot = View(this).apply {
            background = GradientDrawable().apply { setColor(neutralColor); cornerRadius = dotSize / 2f }
        }
        routeCenterDot = centerDot
        lineWrapper.addView(centerDot, FrameLayout.LayoutParams(dotSize, dotSize).apply {
            gravity = Gravity.CENTER
        })
        row2.addView(lineWrapper, LinearLayout.LayoutParams(
            0, circleSize, 1f
        ).apply { marginStart = dpToPx(4); marginEnd = dpToPx(8) })

        // Duration + distance column (right side)
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
        rightCol.addView(durationTv)
        val distanceTv = TextView(this).apply {
            text = "%.1f km".format(m.totalDistanceKm)
            textSize = 12f; setTextColor(Color.parseColor("#888888"))
            includeFontPadding = false
        }
        distanceView = distanceTv
        rightCol.addView(distanceTv)
        row2.addView(rightCol, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(6) })

        // Warning circle (end of row)
        val warnView = FrameLayout(this).apply {
            background = GradientDrawable().apply { setColor(neutralColor); cornerRadius = circleSize / 2f }
        }
        val warnGlyph = TextView(this).apply {
            text = "!"; textSize = 12f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            includeFontPadding = false
        }
        routeGpsGlyphView = warnGlyph
        warnView.addView(warnGlyph, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ).apply { gravity = Gravity.CENTER })
        routeGpsCircle = warnView
        row2.addView(warnView, LinearLayout.LayoutParams(circleSize, circleSize))

        card.addView(row2, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(6) })

        bubbleContainer.addView(card, FrameLayout.LayoutParams(cardW, LayoutParams.WRAP_CONTENT))
        animateTo(cardW, LayoutParams.WRAP_CONTENT)

        // Recentrer si nécessaire
        val maxX = screenWidth - cardW
        if (bubbleParams.x > maxX) {
            bubbleParams.x = maxX.coerceAtLeast(0)
            runCatching { windowManager.updateViewLayout(bubbleContainer, bubbleParams) }
        }

        // Countdown 15s (sans barre visuelle — juste dismiss à la fin)
        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(COUNTDOWN_MS, COUNTDOWN_MS) {
            override fun onTick(millisLeft: Long) {}
            override fun onFinish() { mainHandler.post { showIdleState() } }
        }.start()
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

    private fun showErrorState() {
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
            text = "Échec"; textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showNotARideState() {
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
            text = str(com.strive.R.string.scanner_not_a_ride)
            textSize = 13f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
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

    /** Notification système invitant à démarrer la session. Tap → ouvre l'app. */
    private fun notifySessionRequired() {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = android.app.PendingIntent.getActivity(
            this, 0, launch ?: Intent(),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notif = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setContentTitle(str(com.strive.R.string.scanner_session_required_title))
            .setContentText(str(com.strive.R.string.scanner_session_required_body))
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pi)
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
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
        // KPI de session (poussés par le JS) → mini tableau de bord persistant,
        // équivalent du dashboard de la Live Activity iOS. Avant le 1ᵉ push : texte d'invite.
        if (hasSessionKpi) {
            builder.setContentTitle(
                "%.0f € · %.0f €/h".format(todayEarnings, todayHourlyRate)
            ).setContentText(
                "%.1f km · %dh%02d %s".format(
                    todayKm, onlineMinutes / 60, onlineMinutes % 60,
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

    /**
     * Notification de résultat avec boutons Accepter / Refuser — permet de taguer
     * la course sans ouvrir l'app (mains libres). Au tap, RideDecisionReceiver
     * enregistre la décision sous `rideId`, que le Dashboard écrit directement en
     * base. Mirror iOS (AnalyzeRideIntent.sendLocalNotification + catégorie
     * STRIVE_SCAN_RESULT).
     */
    private fun postRideDecisionNotification(result: OcrParser.ScanResult, rideId: String) {
        val m = computeMetrics(result)
        val verdict = when (m.level) { 2 -> "✅"; 1 -> "⚠️"; else -> "❌" }
        // displayFare = net de carburant si l'option est active, sinon brut.
        val title = "%s · %.0f€ · %s".format(result.platform.name, m.displayFare, verdict)
        val body = "%.0f€/h · %.2f€/km · %dmin · %.1fkm".format(
            m.hourlyRate, m.kmRate, m.totalDurationMin, m.totalDistanceKm
        )

        fun decisionPi(status: String, requestCode: Int): android.app.PendingIntent {
            val intent = Intent(this, RideDecisionReceiver::class.java).apply {
                action = RideDecisionReceiver.ACTION
                putExtra(RideDecisionReceiver.EXTRA_RIDE_ID, rideId)
                putExtra(RideDecisionReceiver.EXTRA_STATUS, status)
                putExtra(RideDecisionReceiver.EXTRA_NOTIF_ID, RESULT_NOTIF_ID)
            }
            return android.app.PendingIntent.getBroadcast(
                this, requestCode, intent,
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
        }

        // Course visée par la notification affichée : `clearRideResult` s'y
        // réfère pour ne l'annuler que si la décision porte bien sur elle — et
        // pas sur un scan plus ancien, dont la carte a déjà été remplacée.
        applicationContext
            .getSharedPreferences(ScanBridgeModule.SCANS_PREFS, MODE_PRIVATE)
            .edit().putString(ScanBridgeModule.LAST_NOTIF_RIDE_KEY, rideId).apply()

        // requestCodes distincts pour ne pas écraser un PendingIntent par l'autre.
        // Deux notifications successives doivent aussi porter des codes distincts,
        // sinon FLAG_UPDATE_CURRENT réécrit les extras de la précédente — d'où le
        // hash de l'id plutôt qu'un compteur.
        val base = (rideId.hashCode() and 0x3FFFFFFF) * 2
        val notif = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .addAction(0, str(com.strive.R.string.scanner_ride_accept), decisionPi("ACCEPTED", base))
            .addAction(0, str(com.strive.R.string.scanner_ride_decline), decisionPi("DECLINED", base + 1))
            .build()
        runCatching {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(RESULT_NOTIF_ID, notif)
        }
    }
}

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
    private var durationView: TextView? = null
    private var distanceView: TextView? = null
    private var hourlyRateView: TextView? = null
    private var kmRateView: TextView? = null
    private var distancePulse: ObjectAnimator? = null

    companion object {
        private const val CHANNEL_ID = "strive_scanner_channel"
        private const val NOTIF_ID = 42
        private const val COUNTDOWN_MS = 15_000L
        var instance: FloatingBubbleService? = null
        /** Préférence utilisateur — si true, les métriques initiales incluent le trajet d'approche */
        var includePickup: Boolean = false
        /** Seuils utilisateur pour le verdict natif (synchronisés depuis JS). */
        var minHourlyRate: Double = 25.0
        var minKmRate: Double = 1.2
        /** Quota journalier dépassé (synchronisé depuis JS via setQuotaReached).
         *  Si true, triggerScan affiche un état "limite atteinte" sans lancer
         *  l'OCR ni TomTom → 0 coût Gemini/TomTom pour les users hors quota. */
        var quotaReached: Boolean = false
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
        if (scanInProgress) return
        // Quota dépassé → on bloque AVANT toute capture/OCR/TomTom. Pas d'event
        // émis au JS, donc rien ne part en queue offline non plus.
        if (quotaReached) {
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
                ScanBridgeModule.emitScanFailed(); return@postDelayed
            }
            svc.captureScreen { bitmap ->
                if (bitmap == null) {
                    mainHandler.post { onScanError() }
                    scanInProgress = false
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
                val result = OcrParser.parse(visionText, w, h)
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
                    val debug = if (BuildConfig.DEBUG) debugBlocks else null
                    resolveTomTomAndEmit(result, base64, debug)
                    scanInProgress = false
                } else {
                    fallbackGemini(fullBitmap)
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
                mainHandler.post {
                    if (result != null) {
                        showResultState(result)
                        ScanBridgeModule.emitScanResult(result, base64)
                    } else {
                        onScanError()
                        ScanBridgeModule.emitScanFailed()
                    }
                }
                scanInProgress = false
            }
        } else {
            bitmap.recycle()
            onScanError()
            ScanBridgeModule.emitScanFailed()
            scanInProgress = false
        }
    }

    private fun onScanError() {
        mainHandler.post { showErrorState() }
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
    ) {
        val pickup = ocr.pickupAddress?.replace("\\s*\\n\\s*".toRegex(), " ")
            ?.replace("^(\\d+)([A-Za-zÀ-ÿ])".toRegex(), "$1 $2")
            ?.trim() ?: ""
        val dest = ocr.destinationAddress?.replace("\\s*\\n\\s*".toRegex(), " ")
            ?.replace("^(\\d+)([A-Za-zÀ-ÿ])".toRegex(), "$1 $2")
            ?.trim() ?: ""

        if (pickup.isEmpty() || dest.isEmpty() || !TomTomService.isReady) {
            // Pas d'adresses ou pas de clé → affiche direct les valeurs OCR.
            mainHandler.post { showResultState(ocr); applyVerdict(ocr) }
            ScanBridgeModule.emitScanResult(ocr, base64, debugBlocks)
            return
        }

        TomTomService.calculateRoute(pickup, dest) { route ->
            val finalResult = if (route != null && route.distanceKm in 0.3..1000.0) {
                // ✅ RÈGLE V2 : TomTom est le ROI. Distance = Course TomTom + Approche OCR.
                ocr.copy(
                    distanceKm = route.distanceKm,
                    durationMin = route.durationMin,
                )
            } else {
                // 🚨 FALLBACK : TomTom a échoué (réseau, adresse introuvable).
                // On garde 100% des valeurs OCR de la plateforme.
                ocr
            }
            mainHandler.post { showResultState(finalResult); applyVerdict(finalResult) }
            ScanBridgeModule.emitScanResult(finalResult, base64, debugBlocks)
        }
    }

    /**
     * Calcule et applique le verdict couleur (rouge/orange/vert) sur la bulle
     * à partir d'un ScanResult final. Centralise le calcul utilisé par les
     * branches "skip TomTom" et "TomTom OK/KO".
     */
    private fun applyVerdict(result: OcrParser.ScanResult) {
        val useApproach = includePickup
            && result.pickupDurationMin != null
            && result.pickupDistanceKm != null

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
        updateVerdict(level)
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
            setImageResource(com.strive.R.mipmap.ic_launcher_round)
            scaleType = ImageView.ScaleType.CENTER_CROP
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
        // Respecte la préférence include_pickup_location : si ON et les champs pickup
        // sont présents, on ajoute le trajet d'approche au total.
        val useApproach = includePickup
            && result.pickupDurationMin != null
            && result.pickupDistanceKm != null

        // Heuristique vitesse moyenne selon la distance — l'ancienne estimation
        // unique à 25 km/h surestimait massivement les durées de courses
        // péri-urbaines (24 km Chennevières→Paris : 25 km/h ≈ 59 min vs réalité
        // ~38 min). Calibration prudente pour éviter de gonfler le €/h estimé.
        val courseDuration = result.durationMin?.toDouble() ?: estimateDurationMin(result.distanceKm)
        val totalDuration = if (useApproach)
            courseDuration + (result.pickupDurationMin?.toDouble() ?: 0.0)
        else courseDuration

        val totalDistance = if (useApproach)
            result.distanceKm + (result.pickupDistanceKm ?: 0.0)
        else result.distanceKm

        val hourlyRate = if (totalDuration > 0) result.fare / (totalDuration / 60.0) else 0.0
        val kmRate = if (totalDistance > 0) result.fare / totalDistance else 0.0

        val pColor = when (result.platform) {
            OcrParser.Platform.UBER   -> "#FFFFFF"
            OcrParser.Platform.BOLT   -> "#34D47A"
            OcrParser.Platform.HEETCH -> "#FF3B80"
            else                      -> "#AAAAAA"
        }
        val pColorInt = Color.parseColor(pColor)

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
            textSize = 15f; setTextColor(pColorInt)
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
            text = "€%.0f".format(result.fare)
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
            text = if (result.durationMin != null || useApproach)
                "${totalDuration.toInt()}min"
            else "—min"
            textSize = 14f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }
        durationView = durationTv
        rightCol.addView(durationTv)
        val distanceTv = TextView(this).apply {
            text = "%.1f km".format(totalDistance)
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
        warnView.addView(TextView(this).apply {
            text = "!"; textSize = 12f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            includeFontPadding = false
        }, FrameLayout.LayoutParams(
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
            text = "Quota atteint"; textSize = 13f; setTextColor(Color.WHITE)
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

    private fun animateTo(w: Int, h: Int) {
        bubbleParams.width = w; bubbleParams.height = h
        runCatching { windowManager.updateViewLayout(bubbleContainer, bubbleParams) }
    }

    // ─── Notification ─────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Scanner VTC", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Bulle de scan active" }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Strive Scanner actif")
        .setContentText("Appuie sur la pill pour scanner")
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .build()
}

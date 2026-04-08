package com.strive.scanner

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
    private var routeGpsCircle: View? = null
    private var durationView: TextView? = null

    companion object {
        private const val CHANNEL_ID = "strive_scanner_channel"
        private const val NOTIF_ID = 42
        private const val COUNTDOWN_MS = 15_000L
        var instance: FloatingBubbleService? = null
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
        countdownTimer?.cancel()
        if (::bubbleContainer.isInitialized) runCatching { windowManager.removeView(bubbleContainer) }
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
        // Downscale à 720px pour accélérer ML Kit (pas de crop — layout VTC peut changer)
        val maxW = 720
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
                if (result != null) {
                    fullBitmap.recycle()
                    showResultState(result)
                    ScanBridgeModule.emitScanResult(result)
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
            GeminiVisionService.analyze(bitmap) { result ->
                bitmap.recycle()
                mainHandler.post {
                    if (result != null) {
                        showResultState(result)
                        ScanBridgeModule.emitScanResult(result)
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
            // Route : cercle voiture + ligne + cercle GPS
            routeCarCircle?.background = GradientDrawable().apply { setColor(color); cornerRadius = rc }
            routeLine?.setBackgroundColor(color)
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

    // ─── UI States ────────────────────────────────────────────────────────────────

    private fun dpToPx(dp: Int) = (dp * resources.displayMetrics.density).toInt()

    private fun showIdleState() {
        countdownTimer?.cancel()
        fareBadgeView = null; verdictBarView = null; verdictTriangleView = null; routeCarCircle = null; routeLine = null; routeGpsCircle = null; durationView = null
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

        pill.addView(TextView(this).apply {
            text = "📷"; textSize = 14f; gravity = Gravity.CENTER
            setPadding(0, 0, dpToPx(6), 0)
        })
        pill.addView(TextView(this).apply {
            text = "Strive"; textSize = 13f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })

        bubbleContainer.addView(pill, FrameLayout.LayoutParams(
            LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT
        ))
        animateTo(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }

    private fun showLoadingState() {
        fareBadgeView = null; verdictBarView = null; verdictTriangleView = null; routeCarCircle = null; routeLine = null; routeGpsCircle = null; durationView = null
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
        fareBadgeView = null; verdictBarView = null; verdictTriangleView = null; routeCarCircle = null; routeLine = null; routeGpsCircle = null; durationView = null
        bubbleContainer.removeAllViews()

        val screenWidth = getScreenWidth()
        val cardW = (screenWidth * 0.93f).toInt().coerceAtMost(dpToPx(400))

        val estimatedDuration = result.durationMin?.toDouble() ?: (result.distanceKm / 25.0 * 60.0)
        val hourlyRate = if (estimatedDuration > 0) result.fare / (estimatedDuration / 60.0) else 0.0
        val kmRate = if (result.distanceKm > 0) result.fare / result.distanceKm else 0.0

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
            setPadding(dpToPx(14), dpToPx(10), dpToPx(14), dpToPx(10))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F01A1A1A"))
                cornerRadius = dpToPx(22).toFloat()
            }
            elevation = dpToPx(12).toFloat()
        }

        // ═══════════════════════════════════════════════════════════════
        // ROW 1 : Platform | €XX/h ▼ | [€XX] | ↑€X.XX/km ▼ | | Xmin
        // ═══════════════════════════════════════════════════════════════
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        // Platform
        row1.addView(TextView(this).apply {
            text = result.platform.name.let { it[0] + it.substring(1).lowercase() }
            textSize = 14f; setTextColor(pColorInt)
            typeface = Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(10) })

        // €/h — large white
        row1.addView(TextView(this).apply {
            text = "€%.0f".format(hourlyRate)
            textSize = 22f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })
        row1.addView(TextView(this).apply {
            text = "/h"
            textSize = 12f; setTextColor(Color.parseColor("#999999"))
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(10) })

        // Fare badge
        val fareBadge = TextView(this).apply {
            text = "€%.0f".format(result.fare)
            textSize = 15f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dpToPx(12), dpToPx(5), dpToPx(12), dpToPx(5))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#CC3333"))
                cornerRadius = dpToPx(12).toFloat()
            }
        }
        fareBadgeView = fareBadge
        row1.addView(fareBadge, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dpToPx(10) })

        // ↑€/km — white
        row1.addView(TextView(this).apply {
            text = "↑€%.2f/km".format(kmRate)
            textSize = 12f; setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })

        // ▼ verdict triangle
        val triangle = TextView(this).apply {
            text = "▼"; textSize = 10f
            setTextColor(Color.parseColor("#666666"))
        }
        verdictTriangleView = triangle
        row1.addView(triangle, LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
        ).apply { marginStart = dpToPx(4) })

        // Vertical separator
        row1.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#333333"))
        }, LinearLayout.LayoutParams(dpToPx(1), dpToPx(32)).apply {
            marginEnd = dpToPx(10)
        })

        // Duration + distance
        val rightCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val durationTv = TextView(this).apply {
            text = if (result.durationMin != null) "${result.durationMin}min" else "—min"
            textSize = 14f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
        }
        durationView = durationTv
        rightCol.addView(durationTv)
        rightCol.addView(TextView(this).apply {
            text = "%.1f km".format(result.distanceKm)
            textSize = 11f; setTextColor(Color.parseColor("#888888"))
        })
        row1.addView(rightCol)

        card.addView(row1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(8) })

        // ═══════════════════════════════════════════════════════════════
        // ROW 2 : [🚗 circle] ———— line ———— [📍 circle]
        //   All in neutral gray — verdict will recolor them
        // ═══════════════════════════════════════════════════════════════
        val neutralColor = Color.parseColor("#555555")
        val circleSize = dpToPx(18)

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(4), 0, dpToPx(4), 0)
        }

        // Car circle (pickup)
        val carView = FrameLayout(this).apply {
            background = GradientDrawable().apply { setColor(neutralColor); cornerRadius = circleSize / 2f }
        }
        carView.addView(TextView(this).apply {
            text = "▶"; textSize = 7f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ).apply { gravity = Gravity.CENTER })
        routeCarCircle = carView
        row2.addView(carView, LinearLayout.LayoutParams(circleSize, circleSize))

        // Connecting line
        val lineView = View(this).apply { setBackgroundColor(neutralColor) }
        routeLine = lineView
        row2.addView(lineView, LinearLayout.LayoutParams(0, dpToPx(2), 1f))

        // GPS circle (destination)
        val gpsView = FrameLayout(this).apply {
            background = GradientDrawable().apply { setColor(neutralColor); cornerRadius = circleSize / 2f }
        }
        gpsView.addView(TextView(this).apply {
            text = "◉"; textSize = 8f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ).apply { gravity = Gravity.CENTER })
        routeGpsCircle = gpsView
        row2.addView(gpsView, LinearLayout.LayoutParams(circleSize, circleSize))

        card.addView(row2, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dpToPx(4) })

        // ── Countdown bar ──
        val trackW = cardW - dpToPx(28)
        val timerTrack = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#2A2A2A"))
                cornerRadius = dpToPx(2).toFloat()
            }
        }
        val timerBar = View(this).apply {
            background = GradientDrawable().apply {
                setColor(neutralColor)
                cornerRadius = dpToPx(2).toFloat()
            }
        }
        verdictBarView = timerBar
        timerTrack.addView(timerBar, FrameLayout.LayoutParams(trackW, dpToPx(3)))
        card.addView(timerTrack, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(3)
        ))

        bubbleContainer.addView(card, FrameLayout.LayoutParams(cardW, LayoutParams.WRAP_CONTENT))
        animateTo(cardW, LayoutParams.WRAP_CONTENT)

        // Recentrer si nécessaire
        val maxX = screenWidth - cardW
        if (bubbleParams.x > maxX) {
            bubbleParams.x = maxX.coerceAtLeast(0)
            runCatching { windowManager.updateViewLayout(bubbleContainer, bubbleParams) }
        }

        // Countdown 15s
        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(COUNTDOWN_MS, 50) {
            override fun onTick(millisLeft: Long) {
                val newW = (trackW * millisLeft.toFloat() / COUNTDOWN_MS).toInt()
                mainHandler.post {
                    timerBar.layoutParams = (timerBar.layoutParams as FrameLayout.LayoutParams)
                        .apply { width = newW }
                    timerBar.requestLayout()
                }
            }
            override fun onFinish() { mainHandler.post { showIdleState() } }
        }.start()
    }

    private fun showErrorState() {
        fareBadgeView = null; verdictBarView = null; verdictTriangleView = null; routeCarCircle = null; routeLine = null; routeGpsCircle = null; durationView = null; countdownTimer?.cancel()
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

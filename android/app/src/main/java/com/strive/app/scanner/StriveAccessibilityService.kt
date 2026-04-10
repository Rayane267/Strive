package com.strive.scanner

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent

class StriveAccessibilityService : AccessibilityService() {

    companion object {
        var instance: StriveAccessibilityService? = null
        /** Token MediaProjection — fourni par ScanBridgeModule pour Android < 11 */
        var mediaProjection: MediaProjection? = null
    }

    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { super.onDestroy(); instance = null }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    fun captureScreen(callback: (Bitmap?) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            captureViaAccessibility(callback)
        } else {
            captureViaMediaProjection(callback)
        }
    }

    // ─── Android 11+ : AccessibilityService.takeScreenshot() ─────────────────────

    private fun captureViaAccessibility(callback: (Bitmap?) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            takeScreenshot(
                Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(screenshot: ScreenshotResult) {
                        val bitmap = Bitmap.wrapHardwareBuffer(
                            screenshot.hardwareBuffer,
                            screenshot.colorSpace
                        )?.copy(Bitmap.Config.ARGB_8888, false)
                        screenshot.hardwareBuffer.close()
                        callback(bitmap)
                    }
                    override fun onFailure(errorCode: Int) { callback(null) }
                }
            )
        } else {
            callback(null)
        }
    }

    // ─── Android 5–10 : MediaProjection + ImageReader ────────────────────────────

    private fun captureViaMediaProjection(callback: (Bitmap?) -> Unit) {
        val mp = mediaProjection ?: run { callback(null); return }

        val metrics = resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        var imageReader: ImageReader? = null
        var virtualDisplay: VirtualDisplay? = null

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

        imageReader.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage()
            if (image == null) {
                virtualDisplay?.release()
                reader.close()
                callback(null)
                return@setOnImageAvailableListener
            }
            try {
                val plane = image.planes[0]
                val rowPadding = plane.rowStride - plane.pixelStride * width
                val paddedWidth = width + rowPadding / plane.pixelStride
                val raw = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
                raw.copyPixelsFromBuffer(plane.buffer)
                val result = if (rowPadding > 0)
                    Bitmap.createBitmap(raw, 0, 0, width, height)
                else raw
                callback(result)
            } catch (e: Exception) {
                callback(null)
            } finally {
                image.close()
                virtualDisplay?.release()
                reader.close()
            }
        }, Handler(Looper.getMainLooper()))

        try {
            virtualDisplay = mp.createVirtualDisplay(
                "StriveCapture", width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.surface, null, null
            )
        } catch (e: Exception) {
            // Token expiré ou révoqué — on le purge pour que l'UI puisse re-demander
            mediaProjection = null
            imageReader.close()
            callback(null)
        }
    }
}

package com.strive.scanner

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reçoit les taps sur les boutons Accepter / Refuser de la notification de
 * résultat de scan et relaie la décision au JS (onRideDecision) via
 * ScanBridgeModule. Équivalent Android de l'AppDelegate iOS
 * (userNotificationCenter didReceive → appendRideDecision → Darwin notif).
 *
 * Déclaré dans le manifest (exported=false) : les PendingIntent ciblent
 * explicitement ce composant, aucun appel externe possible.
 */
class RideDecisionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val scanTs = intent.getDoubleExtra(EXTRA_SCAN_TS, 0.0)
        val status = intent.getStringExtra(EXTRA_STATUS) ?: return
        if (scanTs <= 0.0 || (status != "ACCEPTED" && status != "DECLINED")) return

        ScanBridgeModule.emitRideDecision(context.applicationContext, scanTs, status)

        // Retire la notification de résultat une fois la décision prise.
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1)
        if (notifId != -1) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(notifId)
        }
    }

    companion object {
        const val ACTION = "com.strive.app.RIDE_DECISION"
        const val EXTRA_SCAN_TS = "scanTs"
        const val EXTRA_STATUS = "status"
        const val EXTRA_NOTIF_ID = "notifId"
    }
}

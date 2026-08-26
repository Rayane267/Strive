package com.strive.scanner

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reçoit les taps sur les boutons Accepter / Refuser de la notification de
 * résultat de scan et enregistre la décision (file lue par le Dashboard) via
 * ScanBridgeModule. Équivalent Android de l'AppDelegate iOS
 * (userNotificationCenter didReceive → appendRideDecision).
 *
 * `rideId` est l'identité de la course, frappée au scan par la bulle et portée
 * jusqu'ici par le PendingIntent : le Dashboard n'a rien à corréler, il écrit
 * `update rides set status where id = rideId`.
 *
 * Déclaré dans le manifest (exported=false) : les PendingIntent ciblent
 * explicitement ce composant, aucun appel externe possible.
 */
class RideDecisionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val rideId = intent.getStringExtra(EXTRA_RIDE_ID) ?: return
        val status = intent.getStringExtra(EXTRA_STATUS) ?: return
        if (rideId.isEmpty() || (status != "ACCEPTED" && status != "DECLINED")) return

        ScanBridgeModule.emitRideDecision(context.applicationContext, rideId, status)

        // Retire la notification de résultat une fois la décision prise.
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1)
        if (notifId != -1) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(notifId)
        }
    }

    companion object {
        const val ACTION = "com.strive.app.RIDE_DECISION"
        const val EXTRA_RIDE_ID = "rideId"
        const val EXTRA_STATUS = "status"
        const val EXTRA_NOTIF_ID = "notifId"
    }
}

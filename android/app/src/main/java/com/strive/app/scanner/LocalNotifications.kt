package com.strive.scanner

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * Notifications locales programmées : session inactive, remise à zéro du
 * quota, quota atteint, récap hebdo, course rejetée… Mirror de
 * `ScanBridge.scheduleLocalNotification` (iOS), même signature et mêmes
 * identifiants texte : le JS n'a qu'un chemin.
 *
 * `react-native-push-notification` tenait ce rôle et ne l'a jamais rempli :
 * elle passe l'identifiant à `Integer.parseInt` (« inactivity » → programmation
 * abandonnée en silence), son canal n'était créé nulle part, et notre patch a
 * vidé le manifeste qui déclarait ses receivers.
 *
 * Alarme INEXACTE (`setAndAllowWhileIdle`) : une alarme exacte exige
 * SCHEDULE_EXACT_ALARM depuis Android 12, refusée par défaut depuis Android 14.
 * Un rappel à quelques minutes près ne change rien ici.
 *
 * Une alarme ne survit pas au redémarrage du téléphone, une notification en
 * attente d'iOS si : chaque programmation est donc notée, et [BootReceiver] la
 * repose au démarrage.
 */
object LocalNotifications {
    private const val CHANNEL_ID = "strive_reminders"
    private const val PREFS = "strive_local_notifications"
    private const val ACTION_FIRE = "com.strive.app.LOCAL_NOTIFICATION"
    private const val EXTRA_ID = "id"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"

    fun schedule(ctx: Context, id: String, title: String, body: String, delaySeconds: Double) {
        val app = ctx.applicationContext
        // Délai nul : affichage immédiat, comme le `trigger: nil` d'iOS.
        if (delaySeconds <= 0) {
            forget(app, id)
            show(app, id, title, body)
            return
        }
        val fireAt = System.currentTimeMillis() + (maxOf(delaySeconds, 1.0) * 1000).toLong()
        prefs(app).edit().putString(id, JSONObject()
            .put(EXTRA_TITLE, title).put(EXTRA_BODY, body).put("at", fireAt)
            .toString()).apply()
        arm(app, id, title, body, fireAt)
    }

    /** Retire un rappel EN ATTENTE ; une notification déjà affichée reste,
     *  comme `removePendingNotificationRequests` côté iOS. */
    fun cancel(ctx: Context, id: String) {
        val app = ctx.applicationContext
        forget(app, id)
        val pi = PendingIntent.getBroadcast(
            app, id.hashCode(), fireIntent(app, id),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        alarms(app).cancel(pi)
        pi.cancel()
    }

    /** Repose les rappels notés. Une échéance passée téléphone éteint est
     *  abandonnée : « session inactive » à l'allumage n'aurait plus d'objet. */
    fun rearmAll(ctx: Context) {
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        for ((id, raw) in prefs(app).all) {
            val o = try { JSONObject(raw as String) } catch (e: Exception) { null }
            val fireAt = o?.optLong("at") ?: 0L
            if (o == null || fireAt <= now) { forget(app, id); continue }
            arm(app, id, o.optString(EXTRA_TITLE), o.optString(EXTRA_BODY), fireAt)
        }
    }

    internal fun fire(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        forget(ctx, id)
        show(ctx, id, intent.getStringExtra(EXTRA_TITLE) ?: "", intent.getStringExtra(EXTRA_BODY) ?: "")
    }

    private fun arm(ctx: Context, id: String, title: String, body: String, fireAt: Long) {
        val intent = fireIntent(ctx, id)
            .putExtra(EXTRA_ID, id).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body)
        val pi = PendingIntent.getBroadcast(
            ctx, id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        alarms(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
    }

    /** L'identifiant est porté par l'URI : deux rappels distincts ne partagent
     *  jamais le même PendingIntent, et `cancel` retrouve le bon. */
    private fun fireIntent(ctx: Context, id: String) =
        Intent(ctx, LocalNotificationReceiver::class.java)
            .setAction(ACTION_FIRE)
            .setData(Uri.parse("strive-local://${Uri.encode(id)}"))

    private fun show(ctx: Context, id: String, title: String, body: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Importance haute : le bandeau, l'équivalent de la bannière qu'iOS
            // affiche pour une notification locale.
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_ID, localized(ctx, com.strive.R.string.notif_channel_reminders),
                NotificationManager.IMPORTANCE_HIGH,
            ))
        }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val tap = PendingIntent.getActivity(
            ctx, id.hashCode(), launch ?: Intent(),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(com.strive.R.drawable.ic_stat_strive)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        nm.notify(id.hashCode(), notif)
    }

    /** Dans la langue choisie DANS Strive, comme la bulle (`FloatingBubbleService.str`). */
    private fun localized(ctx: Context, resId: Int): String {
        val lang = ctx.getSharedPreferences(FloatingBubbleService.LANG_PREFS, Context.MODE_PRIVATE)
            .getString(FloatingBubbleService.LANG_KEY, null)
        if (lang.isNullOrBlank()) return ctx.getString(resId)
        val cfg = android.content.res.Configuration(ctx.resources.configuration)
        cfg.setLocale(java.util.Locale.forLanguageTag(lang))
        return ctx.createConfigurationContext(cfg).getString(resId)
    }

    private fun forget(ctx: Context, id: String) = prefs(ctx).edit().remove(id).apply()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun alarms(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
}

/** L'échéance d'un rappel. Déclaré exported=false : seul notre PendingIntent l'atteint. */
class LocalNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        LocalNotifications.fire(context.applicationContext, intent)
    }
}

/** Redémarrage du téléphone : les alarmes sont perdues, on repose les rappels
 *  notés. Redémarrage ou mise à jour de l'app : la bulle, arrêtée avec le reste,
 *  revient si le chauffeur était en ligne (`FloatingBubbleService.ensureRunning`). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                LocalNotifications.rearmAll(context.applicationContext)
                FloatingBubbleService.ensureRunning(context)
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> FloatingBubbleService.ensureRunning(context)
        }
    }
}

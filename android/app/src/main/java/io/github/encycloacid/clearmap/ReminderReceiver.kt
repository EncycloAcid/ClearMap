package io.github.encycloacid.clearmap

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Posts the "Time to head to your gate" notification when the reminder alarm fires. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_HIGH)
        )
        // tapping it opens the app with directions to the gate
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(Intent.ACTION_VIEW, Uri.parse("clegate://action/gate"), context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_gate)
            .setContentTitle(intent.getStringExtra(EXTRA_TITLE) ?: "Time to head to your gate")
            .setContentText(intent.getStringExtra(EXTRA_BODY) ?: "")
            .setStyle(Notification.BigTextStyle().bigText(intent.getStringExtra(EXTRA_BODY) ?: ""))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTIFICATION_ID, n) }   // no-op if notifications are off
    }

    companion object {
        private const val CHANNEL = "gate_reminders"
        private const val NOTIFICATION_ID = 1
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_BODY = "body"

        private fun pending(context: Context, title: String = "", body: String = "") = PendingIntent.getBroadcast(
            context, 7,
            Intent(context, ReminderReceiver::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        fun schedule(context: Context, atMillis: Long, title: String, body: String) {
            // inexact but allowed in Doze, so no special alarm permission is needed
            context.getSystemService(AlarmManager::class.java)
                .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending(context, title, body))
        }

        fun cancel(context: Context) {
            context.getSystemService(AlarmManager::class.java).cancel(pending(context))
        }
    }
}

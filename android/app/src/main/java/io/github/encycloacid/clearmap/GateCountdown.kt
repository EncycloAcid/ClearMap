package io.github.encycloacid.clearmap

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The gate countdown: an ongoing notification with your gate, boarding time and when to leave, counting
 * down to boarding on the lock screen. It follows the same trip the home-screen widget shows (the page
 * sends it through CLEApp.updateWidget), and only appears once you've turned it on.
 *
 * The countdown itself is a chronometer, so it ticks without the app running. Alarms at the leave-by
 * time and at boarding refresh the wording ("Head to your gate now"); it removes itself 20 minutes after
 * boarding. On Android 16 it asks to be a promoted Live Update with a progress bar towards boarding.
 */
object GateCountdown {
    private const val CHANNEL = "gate_countdown"
    private const val ID = 2
    private const val PREFS = "gate_countdown"
    private const val AFTER_BOARDING = 20 * 60_000L

    fun enabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on", false)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", on).apply()
        if (on) refresh(context) else cancel(context)
    }

    /** Redraws from the trip the widget keeps (or clears it when there's nothing to count down to). */
    fun refresh(context: Context) {
        val raw = context.getSharedPreferences("trip_widget", Context.MODE_PRIVATE).getString("trip", null)
        val t = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
        show(context, t)
    }

    private fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(ID)
        val am = context.getSystemService(AlarmManager::class.java)
        am.cancel(alarm(context, 1)); am.cancel(alarm(context, 2))
    }

    private fun alarm(context: Context, code: Int) = PendingIntent.getBroadcast(
        context, 40 + code, Intent(context, CountdownReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun show(context: Context, t: JSONObject?) {
        if (!enabled(context)) return cancel(context)
        val now = System.currentTimeMillis()
        val board = t?.optLong("board") ?: 0L
        val gate = t?.optString("gate").orEmpty()
        if (t == null || gate.isEmpty() || board <= 0 || now > board + AFTER_BOARDING) return cancel(context)
        val leave = t.optLong("leave")
        val walk = t.optInt("walk")

        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.countdown_channel), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.countdown_channel_desc)
                setShowBadge(false)
            }
        )
        val zone = runCatching { ZoneId.of(t.optString("tz")) }.getOrDefault(ZoneId.systemDefault())
        val fmt = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault()).withZone(zone)
        val clock = { ms: Long -> fmt.format(Instant.ofEpochMilli(ms)) }
        val flight = t.optString("flight"); val status = t.optString("status")
        val title = "Gate $gate · boards ${clock(board)}"
        val line = when {
            now >= board -> "Boarding time · check the screens at the gate"
            leave in 1..now -> "Head to your gate now · $walk min walk"
            leave > 0 -> "Leave by ${clock(leave)} · $walk min walk"
            else -> "$walk min walk"
        }
        val open = PendingIntent.getActivity(
            context, 30,
            Intent(Intent.ACTION_VIEW, Uri.parse("clegate://action/gate"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val b = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_gate)
            .setContentTitle(title)
            .setContentText(line)
            .setSubText(listOf(flight, status).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null })
            .setCategory(Notification.CATEGORY_STATUS)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(board)
            .setUsesChronometer(now < board)
            .setChronometerCountDown(true)
            .setTimeoutAfter(board + AFTER_BOARDING - now)
            .setContentIntent(open)
            .setColor(context.getColor(R.color.primary))
        if (Build.VERSION.SDK_INT >= 36) {
            // a Live Update: progress from when it first showed towards boarding, with a mark at leave-by
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val key = "start.$gate.$board"
            val start = prefs.getLong(key, 0L).takeIf { it > 0 } ?: minOf(now, if (leave > 0) leave - 30 * 60_000L else now)
                .also { prefs.edit().putLong(key, it).apply() }
            val span = (board - start).coerceAtLeast(60_000L)
            val pos = { ms: Long -> (((ms - start).toDouble() / span) * 1000).toInt().coerceIn(0, 1000) }
            val style = Notification.ProgressStyle()
                .setProgressSegments(listOf(Notification.ProgressStyle.Segment(1000).setColor(context.getColor(R.color.primary))))
                .setProgress(pos(now))
            if (leave in (start + 1) until board) style.setProgressPoints(listOf(Notification.ProgressStyle.Point(pos(leave)).setColor(Color.WHITE)))
            // ask to be promoted to a Live Update (the platform reads this extra; needs POST_PROMOTED_NOTIFICATIONS)
            b.setStyle(style).setShortCriticalText(gate).addExtras(android.os.Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
        } else {
            b.setStyle(Notification.BigTextStyle().bigText(line))
        }
        runCatching { nm.notify(ID, b.build()) }

        // refresh the wording at the leave-by time and at boarding, even if the app isn't open
        val am = context.getSystemService(AlarmManager::class.java)
        if (leave > now) am.setAndAllowWhileIdle(AlarmManager.RTC, leave, alarm(context, 1)) else am.cancel(alarm(context, 1))
        if (board > now) am.setAndAllowWhileIdle(AlarmManager.RTC, board, alarm(context, 2)) else am.cancel(alarm(context, 2))
    }
}

/** Wakes the gate countdown at the leave-by time and at boarding so its wording stays right. */
class CountdownReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = GateCountdown.refresh(context)
}

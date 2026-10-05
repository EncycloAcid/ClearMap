package io.github.encycloacid.clearmap

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Home-screen widget: your gate, boarding time and walk, and one-tap nearest restroom and coffee.
 * The map page sends the trip whenever it changes (CLEApp.updateWidget); it's kept in
 * SharedPreferences so the widget can draw it without opening the app.
 */
class TripWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, views(context))
    }

    companion object {
        private const val PREFS = "trip_widget"
        private const val KEY = "trip"

        /** Called from the page with the trip as JSON; redraws every widget if it changed. */
        fun save(context: Context, json: String) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (prefs.getString(KEY, null) == json) return
            prefs.edit().putString(KEY, json).apply()
            refresh(context)
        }

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TripWidget::class.java))
            if (ids.isNotEmpty()) for (id in ids) manager.updateAppWidget(id, views(context))
        }

        private fun open(context: Context, action: String, code: Int) = PendingIntent.getActivity(
            context, code,
            Intent(Intent.ACTION_VIEW, Uri.parse("clegate://action/$action"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        private fun views(context: Context): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_trip)
            v.setOnClickPendingIntent(R.id.widget_root, open(context, "gate", 21))
            v.setOnClickPendingIntent(R.id.w_restroom, open(context, "restroom", 22))
            v.setOnClickPendingIntent(R.id.w_coffee, open(context, "coffee", 23))

            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            val t = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (t == null || t.optString("gate").isEmpty()) {
                v.setViewVisibility(R.id.w_main, View.GONE)
                v.setViewVisibility(R.id.w_leave, View.GONE)
                v.setViewVisibility(R.id.w_empty, View.VISIBLE)
                val code = t?.optString("code").orEmpty()
                v.setViewVisibility(R.id.w_code, if (code.isEmpty()) View.GONE else View.VISIBLE)
                v.setTextViewText(R.id.w_code, code)
                v.setTextViewText(R.id.w_title, context.getString(R.string.app_name))
                return v
            }
            v.setViewVisibility(R.id.w_main, View.VISIBLE)
            v.setViewVisibility(R.id.w_empty, View.GONE)

            val zone = runCatching { ZoneId.of(t.optString("tz")) }.getOrDefault(ZoneId.systemDefault())
            val fmt = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault()).withZone(zone)
            val now = System.currentTimeMillis()
            val board = t.optLong("board")
            val leave = t.optLong("leave")

            v.setViewVisibility(R.id.w_code, View.VISIBLE)
            v.setTextViewText(R.id.w_code, t.optString("code"))
            val flight = t.optString("flight")
            val status = t.optString("status")
            v.setTextViewText(R.id.w_title, listOf(flight, status).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { t.optString("airport") })
            v.setTextViewText(R.id.w_gate, t.optString("gate"))
            v.setTextViewText(R.id.w_board, if (board > 0) fmt.format(Instant.ofEpochMilli(board)) else "–")
            v.setTextViewText(R.id.w_walk, "${t.optInt("walk")} min")
            v.setViewVisibility(R.id.w_leave, View.VISIBLE)
            v.setTextViewText(
                R.id.w_leave,
                when {
                    board in 1 until now -> "Boarding time has passed · check the screens"
                    leave in 1..now -> "Head to your gate now"
                    leave > 0 -> "Leave by ${fmt.format(Instant.ofEpochMilli(leave))}"
                    else -> ""
                }
            )
            return v
        }
    }
}

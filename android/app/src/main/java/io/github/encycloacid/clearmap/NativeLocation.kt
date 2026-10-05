package io.github.encycloacid.clearmap

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Looper
import android.view.Surface
import android.view.WindowManager
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Location for the map, better than WebView's built-in geolocation indoors: Android's fused
 * provider (GPS, Wi-Fi and cell together; Android 12+), else GPS and network side by side, plus
 * the compass, so the dot can show which way you're facing while standing still.
 * Each fix and heading goes to the page through [send] as a small JavaScript call.
 */
class NativeLocation(private val context: Context, private val send: (String) -> Unit) : LocationListener, SensorEventListener {
    private val lm = context.getSystemService(LocationManager::class.java)
    private val sm = context.getSystemService(SensorManager::class.java)
    private var running = false
    private var lastHeading = Float.NaN
    private var lastHeadingAt = 0L
    private val rot = FloatArray(9)
    private val orient = FloatArray(3)

    @SuppressLint("MissingPermission")   // MainActivity checks the permission first
    fun start() {
        if (running) return
        running = true
        val providers = if (Build.VERSION.SDK_INT >= 31 && lm.hasProvider(LocationManager.FUSED_PROVIDER))
            listOf(LocationManager.FUSED_PROVIDER)
        else listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) { send("window.cleLocationError && cleLocationError(2)"); running = false; return }
        // the freshest fix we already have, so the dot appears straight away (the filter on the
        // page trusts it only as far as its accuracy, and real fixes take over within seconds)
        (providers + LocationManager.PASSIVE_PROVIDER).distinct()
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .filter { System.currentTimeMillis() - it.time < 10 * 60_000 }
            .maxByOrNull { it.time }?.let { onLocationChanged(it) }
        val main = Looper.getMainLooper()
        if (Build.VERSION.SDK_INT >= 31) {
            // ask for high accuracy explicitly: the old (provider, time, distance) call gives the
            // fused provider a low-power request, which updates slowly and coarsely
            val req = LocationRequest.Builder(1000L)
                .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(500L)
                .build()
            val exec = context.mainExecutor
            for (p in providers) {
                runCatching { lm.getCurrentLocation(p, req, null, exec) { l -> if (running && l != null) onLocationChanged(l) } }
                runCatching { lm.requestLocationUpdates(p, req, exec, this) }
            }
        } else {
            for (p in providers) runCatching { lm.requestLocationUpdates(p, 1000L, 0f, this, main) }
        }
        sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
    }

    fun stop() {
        if (!running) return
        running = false
        runCatching { lm.removeUpdates(this) }
        sm.unregisterListener(this)
    }

    override fun onLocationChanged(l: Location) {
        val heading = if (l.hasBearing() && l.hasSpeed() && l.speed > 0.8f) l.bearing.toString() else "null"
        val speed = if (l.hasSpeed()) l.speed.toString() else "null"
        send("window.cleLocation && cleLocation({lat:${l.latitude},lon:${l.longitude},acc:${l.accuracy},heading:$heading,speed:$speed,t:${l.time},src:'${l.provider}'})")
    }

    override fun onSensorChanged(e: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rot, e.values)
        // keep the compass right when the phone is turned sideways
        val remapped = FloatArray(9)
        @Suppress("DEPRECATION")
        val rotation = (context.getSystemService(WindowManager::class.java)).defaultDisplay.rotation
        val (ax, ay) = when (rotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        SensorManager.remapCoordinateSystem(rot, ax, ay, remapped)
        SensorManager.getOrientation(remapped, orient)
        val deg = ((Math.toDegrees(orient[0].toDouble()) + 360) % 360).toFloat()
        val now = System.currentTimeMillis()
        // a few updates a second, and only when it has turned noticeably
        if (now - lastHeadingAt < 120) return
        if (!lastHeading.isNaN() && abs(((deg - lastHeading + 540) % 360) - 180) < 3) return
        lastHeading = deg; lastHeadingAt = now
        send("window.cleHeading && cleHeading(${deg.roundToInt()})")
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    @Deprecated("Needed below Android 10") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}

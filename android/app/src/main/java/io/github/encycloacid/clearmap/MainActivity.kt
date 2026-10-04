package io.github.encycloacid.clearmap

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var insetsJs = ""

    // A location request from the page waiting on the Android permission dialog
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null

    // Serve the bundled page from a secure https origin; WebView only allows GPS on secure pages.
    private val assets by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        goEdgeToEdge()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setGeolocationEnabled(true)
            settings.allowFileAccess = false
            settings.builtInZoomControls = false
            settings.setSupportZoom(false)
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            setBackgroundColor(Color.parseColor(if (isNight()) "#121612" else "#eef0ec"))
            addJavascriptInterface(AppBridge(), "CLEApp")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // Keep the app on its bundled page; other links open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == APP_HOST) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) = pushInsets()
            }
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    if (hasLocationPermission()) {
                        callback.invoke(origin, true, false)
                    } else {
                        pendingGeo = origin to callback
                        requestPermissions(
                            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                            REQ_LOCATION
                        )
                    }
                }
            }
        }

        // The map draws behind the status and navigation bars, like iOS. The page keeps its
        // search bar and sheet clear of them using these insets (CSS px).
        web.setOnApplyWindowInsetsListener { _, insets ->
            val d = resources.displayMetrics.density
            val (l, t, r, b) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                listOf(i.left, i.top, i.right, i.bottom)
            } else {
                @Suppress("DEPRECATION")
                listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insetsJs = "(()=>{const s=document.documentElement.style;" +
                "s.setProperty('--sal','${l / d}px');s.setProperty('--sat','${t / d}px');" +
                "s.setProperty('--sar','${r / d}px');s.setProperty('--sab','${b / d}px');" +
                "dispatchEvent(new Event('resize'));})()"
            pushInsets()
            insets
        }

        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("https://$APP_HOST/assets/index.html" + (actionOf(intent)?.let { "#$it" } ?: ""))

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    /** "restroom", "coffee" or "gate" from a home-screen shortcut or the reminder notification. */
    private fun actionOf(intent: Intent?): String? =
        intent?.data?.takeIf { it.scheme == "clegate" }?.lastPathSegment?.takeIf { it.matches(Regex("[a-z]+")) }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        actionOf(intent)?.let { web.evaluateJavascript("window.cleAction && cleAction('$it')", null) }
    }

    private fun hasLocationPermission() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_LOCATION) return
        val granted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
        pendingGeo?.let { (origin, callback) -> callback.invoke(origin, granted, false) }
        pendingGeo = null
    }

    /** Lets the page send people to this app's settings page when location was turned off. */
    inner class AppBridge {
        @JavascriptInterface
        fun scheduleReminder(atMillis: Double, title: String, body: String) {
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY) }
            ReminderReceiver.schedule(this@MainActivity, atMillis.toLong(), title, body)
        }

        @JavascriptInterface
        fun cancelReminder() = ReminderReceiver.cancel(this@MainActivity)

        @JavascriptInterface
        fun openSettings() {
            runOnUiThread {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }
        }
    }

    private fun pushInsets() {
        if (insetsJs.isNotEmpty()) web.evaluateJavascript(insetsJs, null)
    }

    private fun isNight() =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    @Suppress("DEPRECATION")
    private fun goEdgeToEdge() {
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        val light = !isNight()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (light) mask else 0, mask)
        } else {
            var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            if (light) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            window.decorView.systemUiVisibility = flags
        }
    }

    // Let the page close a toast, search, a place card or a full-height sheet first; otherwise leave.
    private fun handleBack() {
        web.evaluateJavascript("window.cleBack ? window.cleBack() : false") { handled ->
            if (handled != "true") finish()
        }
    }

    @Deprecated("Used below Android 13")
    override fun onBackPressed() = handleBack()

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        private const val REQ_LOCATION = 41
        private const val REQ_NOTIFY = 42
    }
}

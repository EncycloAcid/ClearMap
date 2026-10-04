package io.github.encycloacid.clearmap

import android.annotation.SuppressLint
import android.app.Activity
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher

class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.builtInZoomControls = false
            settings.setSupportZoom(false)
            overScrollMode = View.OVER_SCROLL_NEVER
            setBackgroundColor(Color.parseColor(if (isNight()) "#0e1418" else "#e9eef0"))
            webViewClient = object : WebViewClient() {
                // Keep the app on its bundled page; nothing else should load inside it.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                    !request.url.toString().startsWith("file:///android_asset/")
            }
        }

        // Pad the page clear of the status bar, navigation bar and camera cutout
        // (Android 15 always draws apps edge to edge).
        web.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/index.html")

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    private fun isNight() =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    // Let the page close its info card or search results first; otherwise leave the app.
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
}

package com.mrwebtoapk.template

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var splashView: ImageView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        applyConfiguredTheme()
        super.onCreate(savedInstanceState)
        applyConfiguredOrientation()
        applySystemBarColors()

        val root = FrameLayout(this)
        webView = WebView(this)
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }

        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(progressBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 8))

        if (BuildConfig.HAS_SPLASH) {
            val splashResId = resources.getIdentifier("splash_screen", "drawable", packageName)
            if (splashResId != 0) {
                splashView = ImageView(this).apply {
                    setImageResource(splashResId)
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundColor(Color.parseColor(BuildConfig.STATUS_BAR_COLOR))
                }
                root.addView(splashView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                Handler(Looper.getMainLooper()).postDelayed({ splashView?.visibility = View.GONE }, 1500)
            }
        }

        setContentView(root)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        val whitelistedDomains = BuildConfig.EXTERNAL_LINKS_DOMAINS
            .split(",")
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress in 1..99) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val host = url.host?.lowercase() ?: ""
                if (host == "appassets.androidplatform.net") {
                    return false
                }
                val scheme = url.scheme?.lowercase() ?: ""
                if (scheme == "tel" || scheme == "mailto") {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    return true
                }
                return when (BuildConfig.EXTERNAL_LINKS_MODE) {
                    "external_browser" -> {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                        true
                    }
                    "whitelist" -> {
                        val allowed = whitelistedDomains.any { d -> host == d || host.endsWith(".$d") }
                        if (allowed) {
                            false
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW, url))
                            true
                        }
                    }
                    else -> false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                splashView?.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })

        val cleanStart = BuildConfig.START_PAGE.trimStart('/')
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/$cleanStart")
    }

    private fun applyConfiguredTheme() {
        when (BuildConfig.APP_THEME) {
            "light" -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
            "dark" -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
            else -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        }
    }

    private fun applyConfiguredOrientation() {
        requestedOrientation = when (BuildConfig.SCREEN_ORIENTATION) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    private fun applySystemBarColors() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        runCatching {
            window.statusBarColor = Color.parseColor(BuildConfig.STATUS_BAR_COLOR)
            window.navigationBarColor = Color.parseColor(BuildConfig.NAV_BAR_COLOR)
        }
    }
}

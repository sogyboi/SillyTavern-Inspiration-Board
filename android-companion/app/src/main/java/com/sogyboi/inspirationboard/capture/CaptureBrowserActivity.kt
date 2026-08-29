package com.sogyboi.inspirationboard.capture

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class CaptureBrowserActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var titleView: TextView
    private lateinit var bubble: TextView
    private val prefs by lazy { getSharedPreferences("capture-browser", MODE_PRIVATE) }

    private val providerHomes = mapOf(
        "pinterest" to "https://www.pinterest.com/",
        "cosmos" to "https://www.cosmos.so/",
        "web" to "https://www.google.com/imghp",
    )

    private val targets = listOf(
        SaveTarget("inbox", "Inbox"), SaveTarget("board", "Board"), SaveTarget("main", "Main portrait"),
        SaveTarget("face", "Face"), SaveTarget("hair", "Hair"), SaveTarget("body", "Body / pose"),
        SaveTarget("outfit", "Outfit"), SaveTarget("style", "Art style"), SaveTarget("mood", "Mood / vibe"),
        SaveTarget("environment", "Environment"), SaveTarget("generation", "Generation Studio"),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(13, 13, 21)
        window.navigationBarColor = Color.rgb(13, 13, 21)
        buildUi()
        configureWebView()
        handleIntent(intent, firstLaunch = true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent, firstLaunch = false)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Int = 12, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        stroke?.let { setStroke(dp(1), it) }
    }

    private fun toolbarButton(label: String): Button = Button(this).apply {
        text = label
        setTextColor(Color.WHITE)
        textSize = 12f
        isAllCaps = false
        setPadding(dp(8), 0, dp(8), 0)
        background = rounded(Color.rgb(31, 31, 44), 10, Color.rgb(55, 55, 73))
        minWidth = 0
        minimumWidth = 0
        minHeight = 0
        minimumHeight = 0
    }

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(13, 13, 21)) }
        val vertical = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(vertical, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(5), dp(6), dp(5))
            setBackgroundColor(Color.rgb(16, 16, 25))
        }
        vertical.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))

        val back = toolbarButton("‹")
        val forward = toolbarButton("›")
        titleView = TextView(this).apply {
            text = "Capture Browser"
            setTextColor(Color.rgb(235, 231, 249))
            textSize = 12f
            maxLines = 1
            setPadding(dp(10), 0, dp(8), 0)
            gravity = Gravity.CENTER_VERTICAL
        }
        val external = toolbarButton("App/Site")
        val share = toolbarButton("Share")
        val settings = toolbarButton("⚙")

        toolbar.addView(back, LinearLayout.LayoutParams(dp(42), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(4) })
        toolbar.addView(forward, LinearLayout.LayoutParams(dp(42), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(4) })
        toolbar.addView(titleView, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        toolbar.addView(external, LinearLayout.LayoutParams(dp(76), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginStart = dp(4) })
        toolbar.addView(share, LinearLayout.LayoutParams(dp(62), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginStart = dp(4) })
        toolbar.addView(settings, LinearLayout.LayoutParams(dp(44), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginStart = dp(4) })

        webView = WebView(this)
        vertical.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        bubble = TextView(this).apply {
            text = "+"
            textSize = 31f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            elevation = dp(12).toFloat()
            background = rounded(Color.rgb(132, 96, 244), 30)
            contentDescription = "Save visible inspiration"
        }
        val bubbleParams = FrameLayout.LayoutParams(dp(62), dp(62), Gravity.END or Gravity.BOTTOM).apply {
            marginEnd = dp(18)
            bottomMargin = dp(24)
        }
        root.addView(bubble, bubbleParams)
        installBubbleDrag()

        back.setOnClickListener { if (webView.canGoBack()) webView.goBack() else finish() }
        forward.setOnClickListener { if (webView.canGoForward()) webView.goForward() }
        external.setOnClickListener { openExternal() }
        share.setOnClickListener { captureContext { context -> shareFallback(context, prefs.getString("lastTarget", "inbox") ?: "inbox") } }
        settings.setOnClickListener { showSettings() }
        titleView.setOnClickListener { showNavigateDialog() }

        setContentView(root)
    }

    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = true
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString InspirationBoardCapture/0.5.2"
        }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (uri.scheme == "http" || uri.scheme == "https") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: ActivityNotFoundException) {
                    false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                updateTitle()
                url?.let { prefs.edit().putString("lastUrl", it).apply() }
            }
        }
        webView.setOnLongClickListener {
            val hit = webView.hitTestResult
            val image = if (hit.type == WebView.HitTestResult.IMAGE_TYPE || hit.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) hit.extra else null
            if (!image.isNullOrBlank()) {
                captureContext(preferredImage = image) { openSaveSheet(it) }
                true
            } else false
        }
    }

    private fun installBubbleDrag() {
        bubble.setOnTouchListener(object : View.OnTouchListener {
            var downX = 0f
            var downY = 0f
            var startX = 0f
            var startY = 0f
            var moved = false

            override fun onTouch(view: View, event: MotionEvent): Boolean {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        downX = event.rawX
                        downY = event.rawY
                        startX = view.x
                        startY = view.y
                        moved = false
                        view.scaleX = .95f
                        view.scaleY = .95f
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - downX
                        val dy = event.rawY - downY
                        if (abs(dx) > dp(7) || abs(dy) > dp(7)) moved = true
                        if (moved) {
                            val maxX = max(0f, root.width - view.width.toFloat())
                            val maxY = max(0f, root.height - view.height.toFloat())
                            view.x = min(maxX, max(0f, startX + dx))
                            view.y = min(maxY, max(dp(56).toFloat(), startY + dy))
                        }
                        return true
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        view.scaleX = 1f
                        view.scaleY = 1f
                        if (event.actionMasked == MotionEvent.ACTION_UP && !moved) captureContext { openSaveSheet(it) }
                        return true
                    }
                }
                return false
            }
        })
    }

    private fun handleIntent(intent: Intent, firstLaunch: Boolean) {
        val data = intent.data
        val fromDeepLink = data?.scheme == "inspirationboard" && data.host == "browse"
        val provider = data?.getQueryParameter("provider")?.takeIf { providerHomes.containsKey(it) }
            ?: prefs.getString("provider", "pinterest") ?: "pinterest"
        val server = data?.getQueryParameter("server")
        val boardId = data?.getQueryParameter("boardId")
        val boardName = data?.getQueryParameter("boardName")
        val explicitUrl = data?.getQueryParameter("url")
        val edit = prefs.edit().putString("provider", provider)
        if (!server.isNullOrBlank()) edit.putString("server", normalizeServer(server))
        if (!boardId.isNullOrBlank()) edit.putString("boardId", boardId)
        if (!boardName.isNullOrBlank()) edit.putString("boardName", boardName)
        edit.apply()

        val targetUrl = explicitUrl?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?: if (fromDeepLink) providerHomes[provider]
            else if (firstLaunch) prefs.getString("lastUrl", null) ?: providerHomes[provider]
            else providerHomes[provider]
        if (!targetUrl.isNullOrBlank() && (webView.url == null || fromDeepLink || !firstLaunch)) webView.loadUrl(targetUrl)
        if (prefs.getString("server", "").isNullOrBlank()) root.postDelayed({ showSettings(firstRun = true) }, 700)
    }

    private fun normalizeServer(value: String): String {
        val clean = value.trim().trimEnd('/')
        return if (clean.isBlank()) "" else clean
    }

    private fun updateTitle() {
        val host = runCatching { Uri.parse(webView.url).host }.getOrNull().orEmpty()
        titleView.text = if (host.isNotBlank()) host else (webView.title ?: "Capture Browser")
    }

    private fun showNavigateDialog() {
        val input = EditText(this).apply {
            setText(webView.url ?: "")
            setSingleLine(true)
            selectAll()
        }
        AlertDialog.Builder(this)
            .setTitle("Open URL")
            .setView(input)
            .setPositiveButton("Go") { _, _ ->
                var value = input.text.toString().trim()
                if (!value.startsWith("http://") && !value.startsWith("https://")) value = "https://$value"
                webView.loadUrl(value)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun captureContext(preferredImage: String? = null, callback: (PageCapture) -> Unit) {
        val script = """
            (function(){
              const vw=Math.max(1,innerWidth), vh=Math.max(1,innerHeight);
              const visible=[...document.images].map(img=>{
                const r=img.getBoundingClientRect();
                const iw=Math.max(0,Math.min(r.right,vw)-Math.max(r.left,0));
                const ih=Math.max(0,Math.min(r.bottom,vh)-Math.max(r.top,0));
                const src=img.currentSrc||img.src||'';
                let score=iw*ih;
                const cx=r.left+r.width/2, cy=r.top+r.height/2;
                const dist=Math.hypot(cx-vw/2,cy-vh*.46);
                score+=Math.max(0,Math.min(vw,vh)-dist)*900;
                if(/pinimg|cosmos/i.test(src)) score+=150000;
                if(r.width<90||r.height<90) score-=300000;
                return {img,src,score};
              }).filter(x=>x.src&&x.score>0).sort((a,b)=>b.score-a.score);
              const point=document.elementFromPoint(vw*.5,vh*.45);
              let pointImg=point&&point.tagName==='IMG'?point:(point&&point.closest?point.closest('a,figure,div')?.querySelector?.('img'):null);
              const og=document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content||'';
              const best=(pointImg&&(pointImg.currentSrc||pointImg.src))||visible[0]?.src||og||'';
              return JSON.stringify({pageUrl:location.href,title:document.title||'',imageUrl:best,alt:(pointImg||visible[0]?.img)?.alt||'',provider:/pinterest|pinimg/i.test(location.hostname+best)?'pinterest':/cosmos/i.test(location.hostname+best)?'cosmos':'web'});
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { raw ->
            val context = runCatching {
                val decoded = JSONTokener(raw).nextValue()
                val json = JSONObject(if (decoded is String) decoded else raw)
                PageCapture(
                    pageUrl = json.optString("pageUrl", webView.url ?: ""),
                    title = json.optString("title", webView.title ?: "Captured inspiration"),
                    imageUrl = preferredImage ?: json.optString("imageUrl", ""),
                    alt = json.optString("alt", ""),
                    provider = json.optString("provider", prefs.getString("provider", "web") ?: "web"),
                )
            }.getOrElse {
                PageCapture(webView.url ?: "", webView.title ?: "Captured inspiration", preferredImage ?: "", "", prefs.getString("provider", "web") ?: "web")
            }
            callback(context)
        }
    }

    private fun openSaveSheet(context: PageCapture) {
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(14))
        }
        scroll.addView(content)
        content.addView(TextView(this).apply {
            text = "Save visible inspiration"
            textSize = 19f
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(4))
        })
        content.addView(TextView(this).apply {
            val detection = if (context.imageUrl.isNotBlank()) "Image detected" else "Page link only"
            text = "${context.title}\n$detection · ${context.provider.replaceFirstChar { it.uppercase() }}"
            textSize = 11f
            setTextColor(Color.rgb(170, 165, 187))
            setPadding(0, 0, 0, dp(10))
        })

        val dialog = AlertDialog.Builder(this).setView(scroll).create()
        targets.chunked(2).forEach { rowTargets ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowTargets.forEach { target ->
                val button = Button(this).apply {
                    text = target.label
                    isAllCaps = false
                    setTextColor(Color.WHITE)
                    textSize = 12f
                    background = rounded(if (target.id == prefs.getString("lastTarget", "inbox")) Color.rgb(73, 55, 119) else Color.rgb(31, 31, 44), 11, Color.rgb(62, 59, 82))
                    setOnClickListener {
                        prefs.edit().putString("lastTarget", target.id).apply()
                        dialog.dismiss()
                        captureNow(context, target.id)
                    }
                }
                row.addView(button, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                    marginEnd = if (target == rowTargets.last()) 0 else dp(6)
                    bottomMargin = dp(6)
                })
            }
            content.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }

        val fallback = Button(this).apply {
            text = "Android Share fallback"
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = rounded(Color.rgb(34, 34, 47), 11, Color.rgb(62, 59, 82))
            setOnClickListener {
                dialog.dismiss()
                shareFallback(context, prefs.getString("lastTarget", "inbox") ?: "inbox")
            }
        }
        content.addView(fallback, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(4) })
        dialog.show()
    }

    private fun captureNow(context: PageCapture, target: String) {
        val server = normalizeServer(prefs.getString("server", "").orEmpty())
        if (server.isBlank()) {
            Toast.makeText(this, "Set your SillyTavern server first. Opening Android Share instead.", Toast.LENGTH_LONG).show()
            showSettings(firstRun = true)
            shareFallback(context, target)
            return
        }
        Toast.makeText(this, "Saving as ${targetLabel(target)}…", Toast.LENGTH_SHORT).show()
        thread {
            try {
                val result = postCapture(server, context, target)
                runOnUiThread {
                    val suffix = if (result.uploadedImage) "image uploaded" else "link captured"
                    Toast.makeText(this, "Saved as ${targetLabel(target)} · $suffix", Toast.LENGTH_LONG).show()
                }
            } catch (error: Throwable) {
                val message = friendlyError(error)
                runOnUiThread {
                    Toast.makeText(this, "Direct save failed: $message. Opening Android Share fallback.", Toast.LENGTH_LONG).show()
                    shareFallback(context, target)
                }
            }
        }
    }

    private fun postCapture(server: String, context: PageCapture, target: String): SaveResult {
        val session = fetchCsrfSession(server)
        val downloaded = if (context.imageUrl.startsWith("http://") || context.imageUrl.startsWith("https://")) {
            runCatching { downloadImage(context.imageUrl, context.pageUrl) }.getOrNull()
        } else null

        val boundary = "----IBCapture${UUID.randomUUID()}"
        val endpoint = URL("$server/api/plugins/inspiration-board-sync/share-target")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 12_000
        connection.readTimeout = 22_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        connection.setRequestProperty("Accept", "application/json,text/html,*/*")
        connection.setRequestProperty("X-CSRF-Token", session.token)
        connection.setRequestProperty("Origin", server)
        connection.setRequestProperty("Referer", "$server/")
        if (session.cookie.isNotBlank()) connection.setRequestProperty("Cookie", session.cookie)

        connection.outputStream.use { output ->
            writeField(output, boundary, "title", context.title.ifBlank { "Captured inspiration" })
            writeField(output, boundary, "text", "${buildMarker(context, target)}\n${context.pageUrl}")
            writeField(output, boundary, "url", context.imageUrl.ifBlank { context.pageUrl })
            if (downloaded != null) writeFile(output, boundary, downloaded)
            output.write("--$boundary--\r\n".toByteArray())
        }

        val code = connection.responseCode
        val responseText = readConnectionText(connection, code)
        connection.disconnect()
        if (code !in 200..399) {
            val detail = responseText.trim().replace(Regex("\\s+"), " ").take(220)
            throw IllegalStateException("SillyTavern HTTP $code${if (detail.isNotBlank()) ": $detail" else ""}")
        }
        return SaveResult(uploadedImage = downloaded != null)
    }

    private fun fetchCsrfSession(server: String): StSession {
        val endpoint = URL("$server/csrf-token")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 10_000
        connection.readTimeout = 12_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("User-Agent", webView.settings.userAgentString)

        val existingCookie = CookieManager.getInstance().getCookie(server).orEmpty()
        if (existingCookie.isNotBlank()) connection.setRequestProperty("Cookie", existingCookie)

        val code = connection.responseCode
        val responseText = readConnectionText(connection, code)
        val setCookies = connection.headerFields
            .filterKeys { key -> key?.equals("Set-Cookie", ignoreCase = true) == true }
            .values
            .flatten()
            .mapNotNull { header -> header.substringBefore(';').trim().takeIf { it.contains('=') } }

        for (header in setCookies) CookieManager.getInstance().setCookie(server, header)
        CookieManager.getInstance().flush()
        connection.disconnect()

        if (code !in 200..299) {
            val detail = responseText.trim().replace(Regex("\\s+"), " ").take(180)
            throw IllegalStateException("CSRF handshake HTTP $code${if (detail.isNotBlank()) ": $detail" else ""}")
        }

        val token = runCatching { JSONObject(responseText).optString("token") }.getOrDefault("")
        if (token.isBlank()) throw IllegalStateException("SillyTavern did not return a CSRF token")

        val cookies = buildList {
            if (existingCookie.isNotBlank()) add(existingCookie)
            addAll(setCookies)
            val webViewCookie = CookieManager.getInstance().getCookie(server).orEmpty()
            if (webViewCookie.isNotBlank()) add(webViewCookie)
        }
            .flatMap { value -> value.split(';').map(String::trim) }
            .filter { it.contains('=') }
            .distinct()
            .joinToString("; ")

        return StSession(token = token, cookie = cookies)
    }

    private fun readConnectionText(connection: HttpURLConnection, code: Int): String {
        val stream = if (code in 200..399) connection.inputStream else connection.errorStream
        return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    }

    private fun buildMarker(context: PageCapture, target: String): String {
        val boardId = prefs.getString("boardId", "").orEmpty()
        val boardName = prefs.getString("boardName", "").orEmpty()
        val pairs = linkedMapOf(
            "target" to target,
            "boardId" to boardId,
            "boardName" to boardName,
            "provider" to context.provider,
            "page" to context.pageUrl,
            "image" to context.imageUrl,
        ).filterValues { it.isNotBlank() }
        return "[IBCAPTURE_V1 ${pairs.entries.joinToString("&") { "${it.key}=${Uri.encode(it.value)}" }}]"
    }

    private fun writeField(output: OutputStream, boundary: String, name: String, value: String) {
        output.write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray())
    }

    private fun writeFile(output: OutputStream, boundary: String, image: DownloadedMedia) {
        output.write("--$boundary\r\nContent-Disposition: form-data; name=\"media\"; filename=\"${image.fileName}\"\r\nContent-Type: ${image.mime}\r\n\r\n".toByteArray())
        output.write(image.bytes)
        output.write("\r\n".toByteArray())
    }

    private fun downloadImage(value: String, referer: String): DownloadedMedia {
        val connection = URL(value).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = 10_000
        connection.readTimeout = 18_000
        connection.setRequestProperty("User-Agent", webView.settings.userAgentString)
        connection.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        if (referer.startsWith("http://") || referer.startsWith("https://")) connection.setRequestProperty("Referer", referer)
        CookieManager.getInstance().getCookie(value)?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }
        val code = connection.responseCode
        if (code !in 200..299) {
            readConnectionText(connection, code)
            connection.disconnect()
            throw IllegalStateException("Image HTTP $code")
        }
        val mime = connection.contentType?.substringBefore(';')?.trim()?.takeIf { it.startsWith("image/") }
            ?: run {
                connection.disconnect()
                throw IllegalStateException("Selected URL is not an image")
            }
        val bytes = readLimited(connection.inputStream, 30 * 1024 * 1024)
        connection.disconnect()
        val extension = when {
            mime.contains("png") -> "png"
            mime.contains("webp") -> "webp"
            mime.contains("gif") -> "gif"
            mime.contains("avif") -> "avif"
            else -> "jpg"
        }
        return DownloadedMedia(bytes, mime, "capture-${System.currentTimeMillis()}.$extension")
    }

    private fun readLimited(input: java.io.InputStream, limit: Int): ByteArray {
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(32 * 1024)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > limit) throw IllegalStateException("Image is larger than 30 MB")
                output.write(buffer, 0, read)
            }
            return output.toByteArray()
        }
    }

    private fun shareFallback(context: PageCapture, target: String) {
        val text = buildString {
            append(buildMarker(context, target))
            append('\n')
            append(context.pageUrl)
            if (context.imageUrl.isNotBlank() && context.imageUrl != context.pageUrl) {
                append('\n')
                append(context.imageUrl)
            }
        }
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, context.title)
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(intent, "Share to Inspiration Board Inbox"))
    }

    private fun openExternal() {
        val url = webView.url ?: providerHomes[prefs.getString("provider", "pinterest")] ?: return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No app can open this URL.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showSettings(firstRun: Boolean = false) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(8), dp(18), dp(6))
        }
        val serverInput = EditText(this).apply {
            hint = "http://127.0.0.1:8000"
            setText(prefs.getString("server", "") ?: "")
            setSingleLine(true)
        }
        content.addView(TextView(this).apply {
            text = "SillyTavern server"
            setTextColor(Color.WHITE)
            textSize = 13f
        })
        content.addView(serverInput)
        content.addView(TextView(this).apply {
            val board = prefs.getString("boardName", "").orEmpty().ifBlank { "Current board will be supplied by Inspiration Board" }
            text = "Board: $board\n\nDirect save uses SillyTavern's /csrf-token handshake automatically. If your server requires a separate login, Android Share remains the fallback."
            setTextColor(Color.rgb(174, 169, 192))
            textSize = 11f
            setPadding(0, dp(10), 0, 0)
        })

        val dialog = AlertDialog.Builder(this)
            .setTitle(if (firstRun) "Connect SillyTavern" else "Capture Browser settings")
            .setView(content)
            .setPositiveButton("Save") { _, _ ->
                prefs.edit().putString("server", normalizeServer(serverInput.text.toString())).apply()
            }
            .setNeutralButton("Test") { _, _ ->
                val server = normalizeServer(serverInput.text.toString())
                if (server.isBlank()) {
                    Toast.makeText(this, "Enter your SillyTavern address first.", Toast.LENGTH_SHORT).show()
                } else {
                    testServer(server)
                }
            }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.show()
    }

    private fun testServer(server: String) {
        Toast.makeText(this, "Testing SillyTavern…", Toast.LENGTH_SHORT).show()
        thread {
            try {
                val session = fetchCsrfSession(server)
                val connection = URL("$server/api/plugins/inspiration-board-sync/status").openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 8_000
                connection.readTimeout = 10_000
                connection.setRequestProperty("Accept", "application/json")
                if (session.cookie.isNotBlank()) connection.setRequestProperty("Cookie", session.cookie)
                val code = connection.responseCode
                val body = readConnectionText(connection, code)
                connection.disconnect()
                if (code !in 200..299) throw IllegalStateException("plugin status HTTP $code")
                val version = runCatching { JSONObject(body).optString("version") }.getOrDefault("")
                runOnUiThread {
                    Toast.makeText(this, "Connected · Inspiration Board Sync ${version.ifBlank { "ready" }}", Toast.LENGTH_LONG).show()
                    prefs.edit().putString("server", server).apply()
                }
            } catch (error: Throwable) {
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle("Connection test failed")
                        .setMessage(friendlyError(error))
                        .setPositiveButton("OK", null)
                        .show()
                }
            }
        }
    }

    private fun friendlyError(error: Throwable): String {
        val raw = error.message.orEmpty().trim()
        if (raw.isNotBlank()) return raw.take(320)
        return error.javaClass.simpleName.ifBlank { "unknown network error" }
    }

    private fun targetLabel(target: String): String = targets.firstOrNull { it.id == target }?.label ?: target

    private data class SaveTarget(val id: String, val label: String)
    private data class PageCapture(val pageUrl: String, val title: String, val imageUrl: String, val alt: String, val provider: String)
    private data class DownloadedMedia(val bytes: ByteArray, val mime: String, val fileName: String)
    private data class StSession(val token: String, val cookie: String)
    private data class SaveResult(val uploadedImage: Boolean)
}

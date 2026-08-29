# Android Capture Browser (v0.5.6)

Inspiration Board v0.5 adds an optional Android companion browser for the fastest Pinterest/Cosmos capture workflow while keeping the reliable Android Share workflow from v0.4.1.

## Why a companion browser?

Pinterest and Cosmos can block iframe embedding, third-party cookies, browser-side page scanning, and image downloads inside SillyTavern. An Android WebView is much closer to a normal mobile browser and lets Inspiration Board own a floating save control. It still cannot force a provider to support WebView, so the real app/site and Android Share remain the fallback.

## v0.5.6 thread-safety fix

Native HTTP saving now snapshots the WebView user agent on the Android UI thread and marshals all CookieManager access back to that thread before worker-thread network requests. This fixes Android's `All WebView methods must be called on the same thread` failure while retaining the CSRF/session handshake and direct image upload.

## v0.5.6 native JSON save

The purple `+` direct-save path no longer uses multipart form parsing. The APK performs the existing SillyTavern CSRF/session handshake, then posts JSON to `/api/plugins/inspiration-board-sync/capture-native`, including source metadata and optional base64 image bytes. This avoids native multipart/Multer parser failures. **v0.5.6 requires updating the `inspiration-board-sync` server plugin copy in Termux once.** Android Share/PWA capture remains a fallback and continues to use the existing share-target route.

## v0.5.6 verified native transport

The companion now sends direct captures with a private raw content type so SillyTavern does not pre-parse the body. The server plugin parses the payload inside its own guarded handler. Settings → **Test** now performs a real POST probe, so `POST save path verified` confirms the same transport used by the floating **+** is working.

## Install

1. Update the SillyTavern Inspiration Board extension to v0.5.6 and restart/reload SillyTavern.
2. Open **Inspiration Board → Capture**.
3. Tap **Install / update APK** in the Capture Browser banner.
4. Install `InspirationBoard-CaptureBrowser-v0.5.6.apk` from the GitHub release.
5. Return to Capture Center and tap **Capture Browser · Pinterest** or **Capture Browser · Cosmos**.

The extension opens the companion with an `inspirationboard://browse` deep link containing the current SillyTavern origin and current board ID/name. You normally do not have to enter these manually.

The beta APK is debug-signed. A later switch to stable release signing may require uninstalling/reinstalling the companion once.

## Floating save workflow

1. Browse normally inside Capture Browser.
2. Scroll the image you care about into the visible area.
3. Tap the draggable purple **+** button. The browser scores visible images by viewport size, position, and provider hints and proposes the strongest visible image.
4. Or long-press a specific image to explicitly choose that image.
5. Pick a destination:
   - Inbox
   - Board
   - Main portrait
   - Face
   - Hair
   - Body / pose
   - Outfit
   - Art style
   - Mood / vibe
   - Environment
   - Generation Studio
6. Continue browsing. The capture is sent to your own SillyTavern capture inbox with the intended board, destination, provider, source page, and selected image URL embedded in capture metadata.
7. Back in Inspiration Board, the Capture Center badge shows pending captures. Companion captures display their intended destination and board. Tap **Save · <destination>** to finalize them.

When the companion was able to upload the actual image bytes, Inspiration Board imports those stored bytes instead of trying to download the remote image again. This helps with temporary/signed CDN image URLs.

## Direct save and SillyTavern CSRF

The companion first tries to save directly to:

```text
/api/plugins/inspiration-board-sync/share-target
```

SillyTavern protects POST endpoints with CSRF validation. Capture Browser v0.5.6 now performs the same handshake that a SillyTavern browser page relies on:

1. GET `/csrf-token` from the configured SillyTavern origin.
2. Preserve the cookie bound to that token.
3. POST the capture with the bound cookie and `X-CSRF-Token` header.

This fixes the v0.5.0 native-save failure where the APK posted directly without a CSRF token. That failure also used to show only the endpoint URL because Android attempted to open the failed response as a successful input stream. v0.5.6 reads the correct success/error stream and reports the real HTTP status and response body.

The settings screen includes **Test** for checking both the CSRF handshake and the Inspiration Board Sync `/status` endpoint.

## Android Share fallback

If direct saving still fails because the server plugin is missing, SillyTavern requires a separate login, networking is unavailable, or another server-side restriction rejects the request, the companion automatically opens Android Share with the capture metadata. Choose **Inspiration Board Inbox** and the normal capture-first workflow continues.

The top **App/Site** button opens the current page using Android's normal app/browser handling. This is the fallback when Pinterest/Cosmos refuses to work correctly inside WebView. From there use Android **Share → Inspiration Board Inbox**.

## WebView limitations

- A provider can still refuse WebView login or browsing.
- Google/Facebook sign-in inside embedded WebViews is commonly restricted. Native username/password login or an already-valid provider cookie may work better.
- Some pages use canvases, protected media, or script-created blobs rather than normal image URLs. In those cases, long-press may not produce an image URL and page-link resolving or Android Share is used instead.
- The companion does not bypass provider authentication, DRM, or access controls.

## Z Fold usage

The companion is intended to stay portrait-friendly on an unfolded foldable screen. The floating **+** can be dragged vertically/horizontally so it does not cover content. Capture choices use large two-column buttons, and the SillyTavern Capture Center retains its two-column Fold portrait layout and batch tools.

## Existing server plugin

v0.5.6 does not require a new server-plugin API. If `SillyTavern/plugins/inspiration-board-sync` from v0.4.0 is already installed and running, it remains compatible. The extension update and v0.5.6 APK are the new pieces.

# Changelog

## 0.6.0

- Added **Venice** as a second Generate provider beside OpenRouter, with native image generation, image edit/reference generation, text-to-video, image-to-video, and reference-to-video.
- Added server-side Venice API-key storage through SillyTavern's own `secrets.json`; the Venice key is never returned to browser JavaScript after saving.
- Added live Venice model discovery instead of a hardcoded catalog, including availability, privacy, task capabilities, image price metadata, and live model traits.
- Added explicit **Uncensored / NSFW-capable** badges and filters for Venice models/variants advertised as uncensored, including the live `most_uncensored` image trait and explicit uncensored variants. Image Safe mode can be switched off for raw model output; video uncensored support stays model-specific.
- Added exact Venice video quotes before queueing, persistent async video job status, polling, finished inline video previews, fullscreen playback, and MP4 save actions.
- Routed video references by model family: Grok flat references, Seedance/Wan flat `reference_image_urls`, and Kling O3 structured Elements plus scene references based on board reference roles.
- Added provider-first model browsing so OpenRouter and Venice are separate catalogs instead of one giant list.
- Added OpenRouter search, price/name/newest sorting, reference-support filtering, explicit uncensored/NSFW labeling when advertised, and honest `Unmoderated`/`Moderated` badges from OpenRouter's live `top_provider.is_moderated` metadata.
- Generate remembers the last provider and continues to preserve provider-specific controls/prompts between visits.
- Inspiration Board Sync is now **v0.6.0** and must be recopied/restarted once to enable Venice. The Android Capture Browser APK remains compatible at v0.5.6.

## 0.5.8

- Fixed the board's original **Generate image · OpenRouter** / Quick Generate modal so it now shows the same live OpenRouter image pricing added to Generation Studio in v0.5.7.
- Model choices now show unit-aware price text plus live reference support (`no refs`, optional maximum, or required minimum/maximum).
- Quick Generate now remembers model, aspect ratio, image count, reference source, reference toggle, board/Inbox destination, and the prompt itself as soon as they change instead of only after a successful Generate click.
- Reference compatibility is read from OpenRouter's dedicated Image API `supported_parameters.input_references` metadata instead of guessed from model names. Supported aspect ratios and output-count limits also follow each model's live capability record.
- Added a dedicated OpenRouter Images API server bridge using SillyTavern's existing server-side OpenRouter secret, so reference-guided generation uses `POST /api/v1/images` with `input_references` instead of SillyTavern's older chat-completions image path.
- Generation references now use the original stored image rather than the board thumbnail, preventing minimum-reference-size failures on providers such as Recraft Styles.
- Added explicit style-reference handling for models such as Recraft V4 Styles Vector: the UI marks style matching as the model's purpose instead of promising identity-preserving editing.
- Inspiration Board Sync is now v0.5.8 and must be recopied/restarted for modern reference generation. Non-reference Quick Generate can still fall back to SillyTavern's legacy route if the bridge is unavailable.

## 0.5.7

- Added a searchable OpenRouter image-model picker with price text directly beside model names.
- Uses OpenRouter's dedicated image-model and per-endpoint pricing metadata in the background; flat output prices render as `$X/img`, ranges as `from $X/img`, megapixel billing as `$X/MP`, and token-priced image output is labeled instead of being misreported as a tiny per-picture price.
- Hardened cost estimation so generic OpenRouter image-token/input-image rates are no longer mistaken for one generated picture.
- Added a persistent live generation chip on the board showing Queued, Preparing, Sending, Request dispatched, OpenRouter response received, Saving, Done, Failed, or Cancelled without requiring the Queue modal to be open.
- Generate Now immediately changes to `Sending…`, and the extension confirms when the browser has dispatched the request and when a result is saved.
- Queue jobs now retain dispatch time, response time, HTTP status, progress phase, and readable progress text for easier troubleshooting.
- Fixed the generated-result `Creator` action to use the existing board-move helper instead of an undefined function.
- No Android Capture Browser or server-plugin update is required for this release; v0.5.6 of those components remains compatible.

## 0.5.6

- Reworked native Capture Browser saving to use `application/x-inspiration-board-capture` instead of `application/json`, bypassing SillyTavern's global JSON body parser entirely.
- Inspiration Board Sync now reads the private native request stream itself inside the route try/catch with a 20 MB request limit and structured 400/413 errors.
- Added a no-write `probe` mode to `/capture-native`.
- The companion Settings **Test** button now performs a real CSRF-protected POST probe through the same transport as the purple `+` button; a successful test now verifies the actual save path.
- Hardened native session cookie construction so duplicate cookie names cannot send stale and fresh SillyTavern session values together.
- Added regression tests for the private raw transport, POST probe, stream limits, and cookie de-duplication.

## 0.5.5

- Fixed the v0.5.4 native JSON save route throwing SillyTavern's generic HTML HTTP 500 before the plugin handler could run.
- Removed the redundant route-level `express.json()` middleware from `/capture-native`; SillyTavern already parses JSON globally before server plugins are mounted.
- Added a regression test preventing the native capture route from double-parsing SillyTavern request streams again.
- Android Capture Browser v0.5.4 remains compatible; no APK reinstall is required for this server-side hotfix.
- The installed `inspiration-board-sync` server plugin must be replaced with v0.5.5 and SillyTavern restarted.

## 0.5.4

- Replaced the Android Capture Browser native direct-save multipart request with a dedicated JSON capture path.
- Added server-plugin `POST /capture-native` with a route-local JSON body limit, optional validated base64 image storage, and structured JSON errors.
- Added the `native-json-capture` server capability and bumped Inspiration Board Sync to v0.5.4.
- Kept the SillyTavern CSRF/session handshake and UI-thread-safe cookie handling from v0.5.3.
- Reduced direct native image payloads to 12 MB; larger/blocked images fall back to source-link capture/Android Share.
- Added a companion connection test that explicitly warns when the installed Termux server plugin is too old.
- Added regression tests ensuring the native app no longer uses multipart for its purple `+` direct-save path.
- Published `InspirationBoard-CaptureBrowser-v0.5.4.apk`.

## 0.5.3

- Fixed direct saves failing with `All WebView methods must be called on the same thread`.
- Removed direct WebView and CookieManager access from background network operations.
- Snapshotted the browser user agent on the UI thread and marshalled cookie reads/writes safely through the UI thread.
- Preserved the CSRF/session handshake, real HTTP diagnostics, image-byte uploads, and Android Share fallback.
- Added regression tests that fail if worker-thread networking touches WebView or CookieManager directly.
- Published `InspirationBoard-CaptureBrowser-v0.5.3.apk`.

## 0.5.0

- Added an optional native Android **Capture Browser** companion for Pinterest, Cosmos, and general web inspiration.
- Added `inspirationboard://browse` deep-link launching from Capture Center, carrying the current SillyTavern server origin and current character board automatically.
- Added a draggable floating **+** save button over the companion WebView. It scores visible images and chooses the strongest visible reference; long-pressing an image explicitly targets that image.
- Added destination selection directly in the companion: Inbox, Board, Main Portrait, Face, Hair, Body/Pose, Outfit, Art Style, Mood, Environment, or Generation Studio.
- Added direct capture upload to the existing `inspiration-board-sync` share-target API with board, destination, provider, page URL, and image URL metadata.
- Added stored-file import for companion captures so images successfully uploaded to SillyTavern are reused instead of being re-downloaded from temporary/signed CDN URLs.
- Added Capture Center destination/board chips for companion captures and a one-tap **Save · destination** action that respects the destination selected in the Android browser.
- Added a top **App/Site** button and automatic Android Share fallback when Pinterest/Cosmos blocks WebView, direct server saving fails, or the chosen image cannot be downloaded.
- Preserved the v0.4.1 real-app workflow: normal Pinterest/Cosmos/Chrome → Android Share → Inspiration Board Inbox remains fully supported.
- Added WebView cookie/DOM-storage support, back/forward navigation, URL navigation, provider deep links, and browser settings/status checking.
- Added a dedicated GitHub Actions Android build that compiles the companion APK and publishes `InspirationBoard-CaptureBrowser-v0.5.0.apk` to the `capture-browser-v0.5.0` GitHub release after merge to main.
- Added `CAPTURE_BROWSER.md` with install, floating-save, fallback, WebView limitation, and Z Fold usage documentation.
- Added Capture Browser bridge tests covering server URLs, deep links, capture metadata markers, target labels, and normal-share compatibility.

## 0.4.1

- Pivoted Pinterest/Cosmos integration to a capture-first workflow instead of relying on fragile embedded browsers.
- Added a new Capture Center with large touch-first launch cards for Pinterest, Cosmos, and the web; the normal app/site is used for browsing and Android Share brings references back into Inspiration Board.
- Added a live pending-capture badge to the board rail and top bar with configurable polling.
- Added a two-column unfolded Z Fold portrait Capture Center with sticky bulk controls, large preview cards, bottom-sheet routing, safe-area padding, and thumb-friendly actions.
- Added URL-only capture resolving: shared Pinterest/Cosmos/web links are scanned through the existing server bridge and the best image candidate is ranked automatically.
- Added lazy capture previews, source/provider labels, search, provider filters, multi-select, select-all, refresh, delete, retry/source actions, and recent import history.
- Added batch routing to any board and destination: Inbox, Board, Main Portrait, Face, Hair, Body/Pose, Outfit, Art Style, Mood, Environment, or Generation Studio.
- Added per-provider quick-save defaults so Pinterest, Cosmos, and general web captures can each remember a preferred destination.
- Added optional clipboard-link detection when Capture Center opens plus a paste/import field for Pins, Cosmos elements, webpages, and direct image URLs.
- Added exact duplicate reuse plus configurable near-duplicate handling: ask, reuse existing, or keep the new copy.
- Added richer source metadata, provider collections/tags, capture timestamps, failure history, and source reopening.
- Generation-target captures now become configured references and can open Generation Studio with the imported images selected.
- Kept the v0.4 page scanner as a compatibility fallback, but removed it from the primary workflow.
- Reused the existing v0.4 server plugin API, so users who already installed the v0.4 plugin do not need a new plugin copy for this update.
- Corrected the optional server plugin package metadata from 0.3.0 to its actual 0.4.0 runtime version.
- Added Capture Core tests for settings, provider detection, launch URLs, candidate ranking, clipboard handling, filtering, relative time, and batch summaries.

## 0.4.0

- Added a touch-first Browse Hub with Pinterest, Cosmos, Web, and Android Captures tabs.
- Added Pinterest and Cosmos search/open flows, URL paste, experimental live-site embedding, and external-open fallbacks for sites that block iframes.
- Added direct page scanning and image extraction, with an optional server-side resolver for pages blocked by browser CORS.
- Added one-tap image destinations for Inbox, Board, Main Portrait, Face, Hair, Body/Pose, Outfit, Art Style, Mood, Environment, and Generation Studio references.
- Added source metadata, provider tags, import history, exact duplicate reuse, and near-duplicate warnings for browser imports.
- Added a safe remote-image proxy to the optional sync plugin for sites that block browser-side image downloads.
- Hardened remote fetches against local/private-network targets, redirect abuse, oversized responses, and long-running requests.
- Expanded the Android share target so image shares and URL-only shares from Pinterest, Cosmos, Chrome, and Gallery can appear in Browse → Captures.
- Fixed sticky-note dragging: note bodies are now selectable/scrollable and notes move only from a dedicated drag grip; resize and menu controls stay isolated.
- Added a dedicated unfolded portrait Z Fold layout with a two-column masonry browser, larger touch targets, full-height Browse view, bottom-sheet import actions, and compact board chrome.
- Added Browse Core tests for provider detection, search URLs, URL extraction, candidate de-duplication, targets, filenames, source notes, image detection, and Fold layout selection.

## 0.3.0

- Added Character Blueprint fields for canonical identity, face, hair, body, outfit, accessories, palette, art style, must-keep traits, allowed changes, and avoid rules.
- Added per-reference purpose, strength, strictness, must-preserve, crop-only, ignore-background, and instruction controls.
- Added grouped Identity, Design, Pose/Expression, Style, and Scene reference handling.
- Added a structured prompt builder with a visible final prompt and model-specific presets.
- Added 19 image-generation recipes, including portraits, sheets, turnaround, chibi, sprite, scene, chat scene, transparent asset, wallpaper, edit, and outpaint workflows.
- Added OpenRouter model capability badges, pricing estimates, credit display, cost warnings, per-job limit, and daily estimated-spend limit.
- Added automatic OpenRouter fallback for reference-count, unsupported-reference, and aspect-ratio failures.
- Added generation queue controls, retry/cancel/pause, comparison view, favorites/rejections, character gallery, and parent/child generation history.
- Added result actions for board placement, main portrait, reference reuse, variations, prompt editing, download, current chat, chat background, Character Creator handoff, and Image Lab.
- Added Image Lab with painted inpaint guides, outpaint guides, local background removal, AI isolation, and automatic crop packs.
- Added vision-assisted tagging, role suggestions, notes, palette extraction, text search, perceptual similarity search, smart clustering, and conflict reporting.
- Added current-chat scene prompting and multi-character board slots.
- Added optional per-user server sync and Android share-target plugin under `server-plugin/inspiration-board-sync`.
- Added tests for blueprint migration, references, recipes, prompt building, conflict detection, capabilities, cost limits, spend tracking, and generation trees.

## 0.2.1

- Added OpenRouter image generation using the key stored by SillyTavern.
- Added image-capable model loading, credit display, reference-image generation, result previews, and board/Inbox result storage.

## 0.2.0

- Added multi-photo Image Inbox with bulk placement and metadata controls.
- Added perceptual near-duplicate detection and review.
- Added named, colored, collapsible canvas groups/frames.
- Added lasso selection and expanded multi-select actions.
- Replaced the flat reference list with a permanent role-based Character Reference Basket.
- Added non-destructive crop/focal-point editing, rotation, flipping, ratings, favorites, source links, and notes.
- Added Character Design, Compact Design, and Blank Canvas templates.
- Added linked SillyTavern characters and field importing.
- Added optional vision-assisted character suggestions through SillyTavern Image Captioning.
- Added PNG moodboard export.
- Added automatic/manual history snapshots and restore.
- Improved Android/Z Fold gestures, hardware Back behavior, canvas-only mode, and bottom-toolbar option.
- Added a native SillyTavern top-bar launcher and removed reliance on the floating launcher.
- Added v0.1 state migration, automated core tests, syntax checks, and browser smoke tests.

## 0.1.5

- Added reliable Android touch launching and a settings-panel launcher.

## 0.1.0

- Initial infinite-canvas prototype with multi-photo upload, references, notes, backups, and Character Creator handoff.

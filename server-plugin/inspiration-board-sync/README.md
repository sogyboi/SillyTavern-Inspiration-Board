# Inspiration Board Sync / Capture server plugin

This optional SillyTavern server plugin adds:

- Per-user compressed workspace storage for phone/PC sync.
- A safe remote page resolver and remote-image bridge for sites that block browser-side fetching.
- An installable Android share-target PWA and pending Capture Inbox.
- The **OpenRouter Images API bridge** used by Quick Generate for real `input_references` support.
- The **v0.6.0 Venice media bridge** for live image/video models, secure Venice API-key storage, image generation/editing, exact video quotes, and async video jobs.

The plugin runtime is **v0.6.0**. Inspiration Board itself can still open without it, but **OpenRouter reference-image requests require v0.5.8+ and Venice image/video generation requires v0.6.0+**. Updating the browser extension does not update a manually copied server plugin.

## Install / update

Copy this directory into:

```text
SillyTavern/plugins/inspiration-board-sync
```

If an older `inspiration-board-sync` folder is already there, replace its files with the current repository version.

Ensure this is enabled in `config.yaml`:

```yaml
enableServerPlugins: true
```

Then **fully restart the SillyTavern server**. Updating the browser extension alone does not update a manually copied server-plugin folder.

After restart, `/api/plugins/inspiration-board-sync/status` should report version `0.6.0` or newer and include both `openrouter-image-api` and `venice-image-video`.

## OpenRouter image generation

The `/openrouter-images` route keeps the OpenRouter API key server-side by reading the key already stored by SillyTavern. It forwards supported Image API fields such as:

- `model`
- `prompt`
- `n`
- `aspect_ratio`
- `input_references`

This is especially important for models whose OpenRouter Image API metadata explicitly requires or limits reference images. Quick Generate checks those live capabilities before sending the request.

## Venice image + video generation

The Venice bridge keeps the Venice API key server-side. In **Generate → Venice**, save the key once; the browser sends it to this plugin over the authenticated SillyTavern session, the plugin validates it, then stores it in SillyTavern's `secrets.json` under `api_key_venice`. The key is never returned to browser JavaScript.

The bridge exposes local authenticated routes for live Venice model metadata/traits, balance, image generation/editing, exact video quotes, queue/retrieve/complete, and model-family-specific reference routing. See `VENICE_MEDIA_GENERATION.md` in the repository root for the user workflow.

## Android share target

After restart, open this path on the same SillyTavern server in Chrome on Android:

```text
/api/plugins/inspiration-board-sync/app/
```

Install the web app when Chrome offers it. It appears as **Inspiration Board Inbox** in Android's Share menu.

Recommended flow:

1. Browse normally in Pinterest, Cosmos, Chrome, or Gallery.
2. Tap **Share**.
3. Choose **Inspiration Board Inbox**.
4. Return to SillyTavern and open Inspiration Board → **Capture**.
5. Quick-save, batch-import, or route the capture to a reference role / Generation Studio.

URL-only shares are kept in the same inbox and resolved when Capture Center imports them.

## Storage

Workspace and Capture Inbox files are stored under the current SillyTavern user's data root in `inspiration-board-sync/`.

# Character Gallery Studio

A separate SillyTavern extension for each character's images and reference-guided generation. Built from the provider-routing lessons in Inspiration Board, without depending on its canvas or changing its data.

**Release: 0.1.0.** This extension is published on the `character-gallery-studio` branch of the public `sogyboi/SillyTavern-Inspiration-Board` repository. The repository's `main` branch remains Inspiration Board. Install this branch into its **own folder**, not over an existing Inspiration Board installation.

## Features

- Opens the current chat character's gallery; group chats ask which member to use.
- Separate server-side storage for each SillyTavern user and character avatar filename. Characters with the same display name do not share images.
- Upload multiple originals, drag files in from desktop, or import the character's avatar. Images are never uploaded to GitHub.
- Main reference, ordered selected references, favorites, names, notes, tags, and face/hair/body/outfit/pose/style/scene roles.
- Separate OpenRouter and Venice catalogs. Search, price-per-image sorting, reference-only filtering, and provider-policy labels.
- Flat, variable, megapixel and token pricing are distinguished. Estimates are base estimates, not a billing guarantee.
- Uses OpenRouter's dedicated Images API. Venice uses generation, single-image edit, or multi-edit as appropriate.
- Sends actual stored originals, not thumbnails. Missing/unsupported/excess references stop the request rather than silently becoming prompt-only generation.
- Uses live reference capabilities, including Venice `capabilities.maxInputImages`. Unspecified multi-image support is conservatively treated as single-image editing.
- Per-character prompts, models and generation settings persist on the server.
- Jobs are bound to the original character. Leaving the menu or switching chats does not redirect outputs to another gallery.
- Local queued / preparing / dispatched / saving / completed / failed status; original-reference count and SHA-256 receipt. The receipt describes the outgoing request, not what the model understood or preserved.
- Completed images automatically save to the character gallery and appear full-width below Generate. Tap for the full-screen viewer, swipe navigation, pinch zoom, pan, download, or reuse as a reference.
- Duplicate-submit protection. No automatic paid retries. Server restarts mark unfinished jobs interrupted rather than resubmitting them.
- Touch-first layout for an unfolded portrait Galaxy Z Fold, narrow phones and desktop.

This first release is for **image generation**. Video generation is not included.

## Install in Termux

This command installs the extension into a unique folder alongside Inspiration Board. It assumes your SillyTavern folder is `~/SillyTavern` and your user is `default-user`.

```bash
cd ~/SillyTavern &&
git clone --depth 1 --single-branch --branch character-gallery-studio \
  https://github.com/sogyboi/SillyTavern-Inspiration-Board.git \
  data/default-user/extensions/Character-Gallery-Studio &&
bash data/default-user/extensions/Character-Gallery-Studio/tools/install-plugin.sh \
  "$PWD" default-user
```

Set `enableServerPlugins: true` in SillyTavern's `config.yaml` if it is not already enabled. **Fully restart the SillyTavern server**, then reload the app/browser. A browser refresh alone does not load a server plugin.

For another user, replace `default-user` with the actual user directory name. For another server path, change the `cd` path. Do not use the ordinary extension installer with this repository's default branch: that installs Inspiration Board instead.

### Update

Use SillyTavern's Manage Extensions to update **Character Gallery Studio**, or run:

```bash
cd ~/SillyTavern/data/default-user/extensions/Character-Gallery-Studio
git pull --ff-only
bash tools/install-plugin.sh "$HOME/SillyTavern" default-user
```

Restart the server after server-plugin updates. The plugin installer backs up the previous **plugin code** before replacing it. It does not delete your galleries or keys.

### Manual / desktop install

Clone/download the `character-gallery-studio` branch into your user's `extensions/Character-Gallery-Studio` folder. Copy `server-plugin/character-gallery-api` to `SillyTavern/plugins/character-gallery-api`. Enable server plugins, restart the server, and reload the browser. Node 20 or newer is required by the server plugin's fetch/AbortSignal APIs.

## Using it

1. Open a character chat, then press the floating **Gallery** button. The wand menu and Extensions settings also contain **Character Gallery Studio** launchers.
2. Upload images. Tap **Ref** on each image you want to use. Selection order is input order. To make a persistent main image, open the image and press **Set main ref**.
3. Open **Generate** and select OpenRouter or Venice. Your existing server-side provider key is reused. Add or replace keys under **Connections** when needed.
4. Select a reference-capable model. Venice edit models require at least one image. Prompt-only models require **References: None** when references are selected.
5. Review the reference count and first source, write the prompt, and press **Generate image**. Results appear beneath the button and in the character's gallery.

Role tags organize the gallery; they are not independent provider control signals. Explain each reference's purpose in the prompt. Style-reference models are not a promise of character-identity preservation.

## Keys, privacy and storage

Keys are stored through SillyTavern's secrets API (`OPENROUTER` and `api_key_venice`). Saving a key changes the same provider key used by other SillyTavern features/Inspiration Board. The plugin never returns the saved key to browser JavaScript.

Gallery data lives under:

```text
data/<user>/character-gallery-studio/<hash-of-avatar-filename>/
```

Back up the `character-gallery-studio` directory with your usual SillyTavern data backups. Display-name changes preserve the gallery. If the character's avatar filename changes, it gets a new gallery; the old data is retained. There is no automatic cross-device localStorage dependency for gallery images.

Provider calls are server-side. Only the prompt, explicit generation parameters and selected original images are sent. Character chat messages are not sent automatically. Model policies still apply; **Unmoderated is not the same as guaranteed NSFW support**. Labels come from the provider metadata, not a promise that every request will be accepted.

Keep SillyTavern's normal authentication and CSRF protection enabled. This plugin uses its authenticated user directories and protected routes; it does not open a public image-upload service.

## Development / verification

No npm dependencies or compilation step are needed.

```bash
npm test
npm run check
# Optional local-only fixture UI. Provider calls are mocked.
node tests/mock-host.mjs
```

Tests cover per-user/per-character storage, concurrent uploads, original-image forwarding, provider payloads, duplicate submit protection, persistent settings, and interrupted jobs. The fixture host only listens on loopback and never uses a real provider key. Browser smoke checks were performed with mock responses at 768×1000 and 412×915; real paid generations and a physical Galaxy Z Fold were not tested during this release.

## API references

- SillyTavern extension context: https://docs.sillytavern.app/for-contributors/writing-extensions/
- OpenRouter Images API: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Image-model capabilities: https://openrouter.ai/docs/api/api-reference/images/list-image-models
- Per-provider image prices: https://openrouter.ai/docs/api/api-reference/images/list-image-model-endpoints
- Venice single edit: https://docs.venice.ai/api-reference/endpoint/image/edit
- Venice multi-edit: https://docs.venice.ai/api-reference/endpoint/image/multi-edit

MIT licensed. No character art or private data is distributed with this extension.

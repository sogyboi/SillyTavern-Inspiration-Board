# Character Gallery Studio

A separate SillyTavern extension for each character's images and reference-guided generation. Built from the provider-routing lessons in Inspiration Board, without depending on its canvas or changing its data.

**Release: 0.1.1.** This extension is published on the `character-gallery-studio` branch of the public `sogyboi/SillyTavern-Inspiration-Board` repository. The repository's `main` branch remains Inspiration Board. Install this branch into its **own folder**, not over an existing Inspiration Board installation.

## Features

- Opens the current chat character's gallery; group chats ask which member to use.
- Separate server-side storage for each SillyTavern user and character avatar filename. Characters with the same display name do not share images.
- Upload multiple originals, drag files in from desktop, or import the character's avatar. Images are never uploaded to GitHub.
- Main reference, ordered selected references, favorites, names, notes, tags, and face/hair/body/outfit/pose/style/scene roles.
- Separate OpenRouter and Venice catalogs. Search, price-per-image sorting, reference-only filtering, and provider-policy labels.
- Sends actual stored originals, not thumbnails. Missing/unsupported/excess references stop the request rather than silently becoming prompt-only generation.
- Per-character prompts, models and generation settings persist on the server.
- Jobs are bound to the original character. Leaving the menu or switching chats does not redirect outputs to another gallery.
- Completed images automatically save to the character gallery and appear full-width below Generate. Tap for the full-screen viewer, swipe navigation, pinch zoom, pan, download, or reuse as a reference.
- Touch-first layout for an unfolded portrait Galaxy Z Fold, narrow phones and desktop.

This first release is for **image generation**. Video generation is not included.

## Install in Termux

### Recommended: Git-free installer

The v0.1.1 installer deliberately avoids `git clone`. It downloads the public branch archive, installs it into its own extension folder, removes any Git metadata, and installs the bundled server plugin. Character galleries and saved provider keys are not deleted.

Assuming SillyTavern is at `~/SillyTavern` and the user directory is `default-user`:

```bash
cd ~
rm -f "$TMPDIR/install-character-gallery.sh"

curl -fL \
  https://raw.githubusercontent.com/sogyboi/SillyTavern-Inspiration-Board/character-gallery-studio/tools/install-termux.sh \
  -o "$TMPDIR/install-character-gallery.sh"

bash "$TMPDIR/install-character-gallery.sh" "$HOME/SillyTavern" default-user
```

Set `enableServerPlugins: true` in SillyTavern's `config.yaml` if it is not already enabled. **Fully stop and restart the SillyTavern server**, then reload the app/browser. A browser refresh alone does not load a server plugin.

The extension manifest intentionally has `auto_update: false` because this branch-based distribution should not launch background Git update commands on Termux. Use the installer above again whenever a new Character Gallery Studio version is released.

### If a previous Git install is prompting for a GitHub username

Stop any stuck Git prompt/process, remove only the old extension code, then run the Git-free installer:

```bash
pkill -f 'git.*github.com' 2>/dev/null || true
rm -rf "$HOME/SillyTavern/data/default-user/extensions/Character-Gallery-Studio"
```

Do **not** remove `data/default-user/character-gallery-studio`; that directory contains gallery data. The installer backs up/replaces plugin code without deleting gallery data or provider keys.

### Manual / desktop install

Download the `character-gallery-studio` branch archive into your user's `extensions/Character-Gallery-Studio` folder. Copy `server-plugin/character-gallery-api` to `SillyTavern/plugins/character-gallery-api`. Enable server plugins, restart the server, and reload the browser. Node 20 or newer is required by the server plugin.

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

Back up the `character-gallery-studio` directory with your usual SillyTavern data backups. Display-name changes preserve the gallery. If the character's avatar filename changes, it gets a new gallery; the old data is retained.

Provider calls are server-side. Only the prompt, explicit generation parameters and selected original images are sent. Character chat messages are not sent automatically. Model policies still apply; **Unmoderated is not the same as guaranteed NSFW support**.

## Development / verification

No npm dependencies or compilation step are needed.

```bash
npm test
npm run check
bash -n tools/install-plugin.sh
bash -n tools/install-termux.sh
```

Tests cover per-user/per-character storage, concurrent uploads, original-image forwarding, provider payloads, duplicate submit protection, persistent settings, and interrupted jobs.

## API references

- SillyTavern extension context: https://docs.sillytavern.app/for-contributors/writing-extensions/
- OpenRouter Images API: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Venice single edit: https://docs.venice.ai/api-reference/endpoint/image/edit
- Venice multi-edit: https://docs.venice.ai/api-reference/endpoint/image/multi-edit

MIT licensed. No character art or private data is distributed with this extension.

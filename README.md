# Character Gallery Studio

A separate SillyTavern extension for each character's images and reference-guided generation. Built from the provider-routing lessons in Inspiration Board, without depending on its canvas or changing its data.

**Release: 0.2.0.** This extension is published on the `character-gallery-studio` branch of the public `sogyboi/SillyTavern-Inspiration-Board` repository. The repository's `main` branch remains Inspiration Board. Install this branch into its **own folder**, not over an existing Inspiration Board installation.

## New in 0.2.0: organized galleries

**Review, Library, Archived, Recently deleted.** New generations are saved immediately but start in Review. Keep, favorite, archive, assign albums, trash, restore and permanently delete using the selection boxes and bulk toolbar. Selecting for organizing is separate from selecting a reference. Existing images stay in Library on upgrade. Nothing in Recently deleted expires automatically; permanent deletion requires confirmation. Images used by an active local job cannot be deleted.

**Albums.** Create, rename or delete albums with Manage albums. Select images and use Add to album; an image can belong to multiple albums without duplicating its original file. Removing an album does not delete images. Album filtering combines with search, roles and favorites.

**Reference sets.** In Gallery, Identity pins a persistent identity reference; Ref selects a temporary outfit, style, pose or scene image. In Generate, save a named set, load it, update/rename it, or delete the set without deleting images. Sets preserve identity/temporary layers, explicit base image, order and optional reference guidance. Clear temporary keeps pinned identities. Use Base to send an image first; left arrows reorder within each layer. Guidance is appended to the prompt only when references are attached. A set containing missing/deleted images is marked incomplete and cannot be loaded until restored or updated. Pinning identity is an organization/instruction feature, not a guarantee of model fidelity.

**Fold layout.** Generate and its current model/reference/cost summary stay at the bottom of the panel, while model selection and advanced options can collapse. Star models to pin them first (per character and provider), or use Favorite models only. The unfolded portrait view uses two columns and touch-sized controls. Browsing builds small cached previews as needed; viewers, downloads and generation continue using originals. Preview generation gracefully falls back to originals for unsupported browser formats.

**Backup and relink.** Connections now includes Export this gallery, Import backup, Attach an existing gallery, and Use original gallery. Backups are portable `.cgs.jsonl.gz` bundles containing originals, Review/Archive/Trash states, names, tags, notes, albums, reference sets, prompts, per-character settings, favorites and job history. They never include provider API keys. Up to 512 MB of originals / 10,000 images per bundle; thumbnails are rebuilt. Backups can contain private images and prompts, so store them privately.

Import first uploads to isolated temporary storage and checks image types, sizes, hashes and the complete archive before showing a preview. Confirming import **adds** copies with fresh IDs into the current gallery; it does not overwrite existing images. Album/set/image references are remapped. Restore generation settings only by checking the option in the preview. Imported active jobs become interrupted history and are never submitted. Canceled previews are discarded; stale staging data is cleaned on a later import after one hour.

Relinking changes the current avatar-filename association to an existing gallery belonging to the same SillyTavern user. It neither merges nor deletes data. Existing characters that point to the source can still share it. Use original gallery returns to this avatar filename's original gallery. Running jobs stay bound to their original gallery ID. To make an independent copy instead, export and import a backup.

### Update from 0.1.x

Run the Git-free installer below again. It updates **both** the extension and `character-gallery-api`; fully restart SillyTavern afterward. Do not replace Inspiration Board Sync or the Capture Browser APK. No provider or paid generation changes are required for this update.

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

The installer deliberately avoids `git clone`. It downloads the public branch archive, installs it into its own extension folder, removes any Git metadata, and installs the bundled server plugin. Character galleries and saved provider keys are not deleted.

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

Back up the `character-gallery-studio` directory with your usual SillyTavern data backups. Display-name changes preserve the gallery. If the character's avatar filename changes, it initially gets a new gallery; use Connections → Attach an existing gallery to relink the old data.

Provider calls are server-side. Only the prompt, explicit generation parameters and selected original images are sent. Character chat messages are not sent automatically. Model policies still apply; **Unmoderated is not the same as guaranteed NSFW support**.

## Development / verification

No npm dependencies or compilation step are needed.

```bash
npm test
npm run check
bash -n tools/install-plugin.sh
bash -n tools/install-termux.sh
```

Tests cover per-user/per-character storage, concurrent uploads, original-image forwarding, provider payloads, duplicate submit protection, persistent settings, interrupted jobs, reference sets, albums, review/trash/restore, original-vs-thumbnail integrity, backup validation/round trips and user-isolated relinking. `tests/ui-smoke.py` exercises the controls with a mocked local provider at unfolded-portrait and narrow-phone viewports. No paid API calls are part of tests.

## API references

- SillyTavern extension context: https://docs.sillytavern.app/for-contributors/writing-extensions/
- OpenRouter Images API: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Venice single edit: https://docs.venice.ai/api-reference/endpoint/image/edit
- Venice multi-edit: https://docs.venice.ai/api-reference/endpoint/image/multi-edit

MIT licensed. No character art or private data is distributed with this extension.

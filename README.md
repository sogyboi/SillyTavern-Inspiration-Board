# SillyTavern Inspiration Board

A touch-first visual character-design and image-generation workspace for SillyTavern. It is designed around an unfolded Samsung Z Fold in portrait orientation, while also supporting standard phones, tablets, and desktop browsers.

## v0.3 Generation Studio

### Character Blueprint

Every board can hold a canonical character blueprint:

- Identity and silhouette
- Face and eyes
- Hair
- Body/build
- Default outfit
- Signature accessories
- Color palette
- Canonical art style
- Traits that must stay unchanged
- Traits that may change
- Avoid rules and design notes

The blueprint can be added to every generation without repeatedly rewriting the character.

### Reference controls

Every reference image can be configured independently:

- Purpose: Identity, Face, Hair, Body, Outfit, Accessory, Prop, Pose, Expression, Style, Mood, or Environment
- Influence strength from 0–100%
- Loose, Balanced, or Strict interpretation
- Must Preserve
- Use visible crop only
- Ignore the reference background
- Per-reference instructions

Generation Studio separates references into Identity, Design, Pose/Expression, Style, and Scene groups. It warns about likely conflicts such as competing hair or eye colors.

### Structured prompt builder and recipes

Generation Studio offers separate fields for:

- Subject
- Pose
- Expression
- Outfit
- Action
- Location
- Camera/composition
- Lighting
- Art style
- Extra instructions
- Things to avoid

The final prompt is always visible before a job is queued. Model presets can add a model-specific prefix, negative prompt, and prompt style.

Included recipes:

- Main portrait
- Full-body art
- Character card art
- Avatar
- Expression sheet
- Outfit concept sheet
- Pose sheet
- Character turnaround
- Chibi version
- Sprite concept
- Character scene
- Current chat scene
- Background only
- Transparent/isolated asset
- Phone wallpaper
- Alternate/evolved form
- Reference edit
- Outpaint
- AI isolated asset

### OpenRouter generation

- Uses the OpenRouter key already stored by SillyTavern. The extension never displays or saves the key.
- Loads current image-capable models.
- Shows capability badges for reference input, editing, multiple references, transparency, and likely maximum reference count.
- Shows OpenRouter credit balance.
- Shows a cost estimate when model pricing metadata is available.
- Supports cost warnings, a per-job hard limit, and a daily estimated-spend limit.
- Automatically retries common failures with fewer references, no references, or a square aspect ratio when enabled.
- Generates 1–8 images per queued job.

Image-input and editing support depend on the selected OpenRouter model and provider.

### Queue, comparison, gallery, and generation tree

- Queue many jobs and let them run one at a time.
- Pause, resume, cancel, retry, or remove jobs.
- Compare results side by side.
- Favorite or reject results.
- Add a result to the board, make it the main portrait, or use it as a new reference.
- Create a variation or reopen its prompt.
- Download, send to the current SillyTavern chat, or use as the chat background.
- Open a generated result in Image Lab.
- Keep complete prompt/model/reference metadata.
- Browse a character gallery and parent/child generation tree.

### Image Lab

- Paint an inpaint mask and create an edit job.
- Prepare an outpaint canvas for wider or taller images.
- Local corner-connected background removal with adjustable tolerance and edge feathering.
- AI isolated-asset workflow.
- Automatic avatar, portrait, bust, card, wallpaper, and banner crops.
- All edits are non-destructive and create new image records.

### Smart organization

- Vision-assisted tag suggestions, role suggestions, notes, and palette extraction with a review step.
- Text search across image names, tags, roles, collections, and notes.
- Visual similarity search using perceptual hashes.
- Smart clustering by reference role, visual similarity, or average color.
- Reference conflict report.

### SillyTavern integration

- Link boards to SillyTavern characters.
- Build a generation prompt from recent visible chat messages.
- Add multiple character boards to one scene while keeping their identities separate.
- Send generated images into the current chat.
- Set a result as the chat background.
- Set a generated result as the board main portrait and continue through the normal Character Creator drawer.

### Sync, Android sharing, and server storage

The extension still works fully with browser storage only. An optional server plugin is included under:

```text
server-plugin/inspiration-board-sync
```

When installed in SillyTavern's `plugins` directory with server plugins enabled, it adds:

- Per-user compressed board/image workspaces
- Save, load, merge, list, and delete server copies
- Phone/PC board transfer
- An installable Android PWA share target
- A pending Share Inbox for images shared from Pinterest, Gallery, or another Android app

The Sync & Share panel contains the install command and status check.

## Existing board features

### Image Inbox and bulk importing

- Select many photos from Android Gallery in one upload.
- Paste images, drag and drop files, or import a direct image URL.
- New images enter a separate Inbox instead of flooding the canvas.
- Exact duplicate detection plus perceptual near-duplicate review.

### Infinite character canvas

- One-finger pan, pinch zoom, mouse-wheel zoom, minimap, fit-to-board, and per-board view memory.
- Drag and resize images, notes, and group frames.
- Long-press image actions.
- Lasso and multi-select actions.
- Canvas-only mode and left/bottom toolbar layouts.

### Groups, templates, and Reference Basket

- Named colored collapsible frames.
- Character Design, Compact Design, and Blank Canvas templates.
- Permanent role-based Character Reference Basket.
- Main portrait selection and Character Creator handoff.

### Safety and portability

- Automatic saves, undo, redo, and persistent snapshots.
- Full backup/restore including original image blobs.
- PNG moodboard export.
- Cleanup of image files no longer used by boards or Inboxes.

## Install

In SillyTavern:

1. Open **Extensions**.
2. Select **Install extension**.
3. Paste:

```text
https://github.com/sogyboi/SillyTavern-Inspiration-Board
```

4. Restart or fully reload SillyTavern.

Open it from the image icon in SillyTavern's top bar or from **Extensions → Inspiration Board → Open Inspiration Board**.

## Update

Use **Manage extensions → Inspiration Board → Update**, then fully reload SillyTavern. Existing v0.1 and v0.2 board data remains compatible. Create a normal board backup before a major update as a precaution.

## Development

Requires Node.js 20 or newer for tests.

```bash
npm test
npm run check
```

The browser extension has no build step. The optional sync/share server plugin is separate and is not required for the board or OpenRouter generation.

## License

MIT

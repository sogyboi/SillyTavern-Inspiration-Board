# SillyTavern Inspiration Board

A touch-first visual character-design workspace for SillyTavern. It is built around the unfolded Samsung Z Fold in portrait orientation, while also supporting normal phones, tablets, and desktop browsers.

## Main features

### Image Inbox and bulk importing

- Select many photos from Android Gallery in one upload.
- Paste images, drag and drop files, or import a direct image URL.
- New images enter a separate Inbox instead of flooding the canvas.
- Select many Inbox images, set their reference type, favorite/rate them, and place them together.
- Exact duplicate detection plus perceptual near-duplicate review for resized or recompressed copies.

### Infinite character canvas

- One-finger pan, pinch zoom, mouse-wheel zoom, minimap, fit-to-board, and per-board view memory.
- Drag and resize images and notes.
- Long-press or use the item menu for actions.
- Double-tap an item to focus it; double-tap empty space to fit the board.
- Lasso selection and bulk move, reference type, tags, grouping, duplication, and deletion.
- Canvas-only mode and left/bottom toolbar layouts.

### Groups and templates

- Resizable named group frames with colors.
- Drop images into groups and move a whole group with its contents.
- Collapse or expand groups.
- Character Design, Compact Design, and Blank Canvas templates.
- Smart Arrange places references into matching groups.

### Character Reference Basket

References are stored separately from the canvas layout and grouped as:

- General
- Face
- Hair
- Body
- Outfit
- Expression
- Accessory
- Prop
- Mood / Vibe
- Environment

Choose a main portrait and send the assembled draft and avatar into SillyTavern's normal Character Creator.

### Image editing and metadata

- Non-destructive crop zoom and focal point.
- Rotate, horizontal/vertical flip, reset crop, replace image, and view original.
- Favorites, 1–5 star ratings, source URLs, notes, tags, and collections.

### SillyTavern integration

- Link a board to an existing SillyTavern character.
- Import current character fields into the board.
- Open the linked character chat.
- Automatically select the linked board when that character is active.
- Optional AI-assisted suggestions using SillyTavern's configured **Image Captioning** model. Suggestions are shown for review and are never applied automatically.

### Safety and portability

- Automatic browser-storage saves.
- Undo and redo.
- Automatic and manual history snapshots with restore.
- Full JSON backup and restore including original stored images.
- Export the entire visible moodboard as a PNG.
- Clean up image files that are no longer used by any board or Inbox.

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

## Updating from v0.1

Use **Manage extensions → Inspiration Board → Update**, then fully reload SillyTavern. Existing v0.1 boards and character references are migrated automatically. Creating a backup before a major update is still recommended.

## AI reference analysis

The AI button uses SillyTavern's built-in Image Captioning configuration. Set up a vision-capable provider/model under the Image Captioning extension first. The board analyzes only images in the Character Reference Basket and asks before using API credits.

## Storage notes

Board state is kept in browser storage and image blobs are kept in IndexedDB for the current SillyTavern browser/profile. Use **Backup** to move everything to another browser or device. Browser cleanup, app-data clearing, or using another SillyTavern URL can create a separate storage area.

## Development

Requires Node.js 20 or newer for tests.

```bash
npm test
npm run check
```

The extension is plain browser JavaScript and does not require a server plugin or build step.

## License

MIT

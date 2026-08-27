# SillyTavern Inspiration Board

A touch-first visual reference board for building SillyTavern characters from saved artwork and inspiration images.

The interface is designed around an unfolded foldable phone held vertically, while still working on normal phones and desktop browsers.

## Features

- Infinite pan-and-zoom reference canvas.
- Multi-photo import from Android Gallery or any browser file picker. Select as many images as you want in one operation.
- Drag-and-drop image import on desktop.
- Paste images directly from the clipboard.
- Import direct image URLs when the source allows browser access.
- Automatic thumbnail generation so large boards stay responsive.
- Duplicate-file detection using an image hash. The original file is stored only once even if you place it multiple times.
- Move and resize image cards.
- One-finger pan and two-finger pinch zoom.
- Mouse wheel zoom and desktop keyboard shortcuts.
- Search by filename, tag, collection, role, or note text.
- Multiple character boards.
- Notes.
- Image tags and collections.
- Reference roles: General, Face, Outfit, Hair, Accessory, and Mood.
- Main portrait and character-reference selection.
- Item locking, duplication, trash, undo, and redo.
- Smart Arrange and Fit Board.
- Character Creator drawer with standard SillyTavern character fields.
- Sends the completed draft and chosen main portrait into SillyTavern's normal character creator.
- Full JSON backup/restore including the original stored image files.
- Cleanup tool for images that are no longer used by any board.
- Local persistence through IndexedDB plus lightweight board metadata storage.

## Installation

### SillyTavern extension URL

Once this repository is public, open SillyTavern's extension installer and paste the repository URL.

### Manual installation

Place the repository folder in your SillyTavern user extensions directory:

```text
SillyTavern/data/default-user/extensions/SillyTavern-Inspiration-Board/
```

If your SillyTavern user handle is not `default-user`, use that user's directory instead.

Restart SillyTavern after installing.

## Opening the board

Use the **Inspiration Board** extension button or press:

```text
Ctrl + Shift + B
```

## Multi-photo workflow on Android

1. Open Inspiration Board.
2. Tap **Add Photos** or the large `+` button.
3. Android's photo picker opens.
4. Select multiple saved images.
5. Confirm your selection.
6. Every selected image is imported and arranged around the current canvas position.

Images remain full-quality in local storage. Smaller thumbnails are used on the live board for speed.

## Character workflow

Tap an image's `•••` menu to mark it as a face, outfit, hair, accessory, mood, or general reference. Add important images to the Character References list and choose one as the Main Portrait.

Open the **Character Creator** drawer at the bottom to fill in the character fields. **Send Draft to SillyTavern Character Creator** transfers the draft to SillyTavern's normal creator so you can review and save it normally.

## Data and backups

The extension stores original image blobs in browser IndexedDB. Board layout/state is stored locally in the same browser profile.

Use **Backup** before clearing browser data or moving devices. The backup contains the board state and the original image files. **Restore** replaces the current Inspiration Board data with the chosen backup.

## Notes about Pinterest and similar sites

Direct page URLs are not reliable image sources because many sites block browser cross-origin image downloads. Saving the images to your phone first and then using multi-photo import is the recommended workflow.

## Current version

`0.1.0`

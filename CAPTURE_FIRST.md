# Capture-first workflow (v0.4.1)

Pinterest and Cosmos frequently block iframe embedding, third-party cookies, page scanning, and direct browser downloads. v0.4.1 therefore treats those services as **sources** instead of trying to reproduce their full apps inside SillyTavern.

## Recommended Android / Z Fold workflow

1. Open Inspiration Board and tap **Capture**.
2. Tap **Open Pinterest**, **Open Cosmos**, or **Open Web**.
3. Browse normally in the real Android app or browser.
4. Use Android **Share** and choose **Inspiration Board Inbox**.
5. Return to SillyTavern. The Capture button shows a badge when pending shares exist.
6. Quick-save a capture or open it and route it to a specific board/reference type.

The Capture Center is designed for an unfolded Z Fold held vertically: two-column cards, sticky batch controls, large touch targets, and a bottom-sheet destination picker.

## Capture destinations

A capture can go directly to:

- Inbox
- Board
- Main Portrait
- Face
- Hair
- Body / Pose
- Outfit
- Art Style
- Mood / Vibe
- Environment
- Generation Studio

Generation Studio destinations are added to the board as configured references and can immediately open the generation workflow.

## URL-only shares

Many apps share a page link rather than the image file. Capture Center sends those links through the optional `inspiration-board-sync` server plugin's safe page resolver, ranks the discovered image candidates, and selects the strongest candidate automatically.

The same resolver is used by the **Import Link** box for pasted Pinterest Pins, Cosmos elements, webpages, and direct image URLs.

## Clipboard import

When Capture Center is opened by a user gesture, it can try to read the clipboard. If it finds a new web URL, a small import banner appears. Browser clipboard permissions may prevent automatic reads; the normal paste/import field remains available.

## Batch workflow

- Select several pending captures.
- Choose a board.
- Choose a destination.
- Tap **Import selected**.

Successful captures can be removed from the server inbox automatically. Failed captures stay available for retry and are recorded in Recent history.

## Quick-save defaults

Capture Center settings let Pinterest, Cosmos, and general web sources each remember a preferred quick destination. For example:

- Pinterest → Outfit
- Cosmos → Art Style
- Web → Inbox

You can also choose how near-duplicates are handled: ask, reuse the existing asset, or keep the new copy.

## Server plugin

v0.4.1 uses the same server API introduced with the v0.4.0 plugin. If you already copied the v0.4.0 plugin to:

```text
SillyTavern/plugins/inspiration-board-sync
```

and it is running, you do **not** need another plugin copy just for v0.4.1.

The plugin is required for the Android share-target inbox and is strongly recommended for URL-only Pinterest/Cosmos imports. The extension still supports direct/local image imports without it.

## Legacy page scanner

The v0.4 page scanner remains available under Capture Center → Settings → **Open legacy page scanner**. It is intentionally no longer the primary workflow because provider-side restrictions are outside the extension's control.

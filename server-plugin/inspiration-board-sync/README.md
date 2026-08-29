# Inspiration Board Sync / Capture server plugin

This optional SillyTavern server plugin adds:

- Per-user compressed workspace storage for phone/PC sync.
- A safe remote page resolver and remote-image bridge for sites that block browser-side fetching.
- An installable Android share-target PWA.
- A pending Capture Inbox for image shares and URL-only shares from Pinterest, Cosmos, Chrome, Gallery, and other Android apps.

The plugin runtime is **v0.4.0** and is compatible with Inspiration Board **v0.4.1**. If you already installed the v0.4.0 plugin, you do not need to copy it again solely for the v0.4.1 capture-first extension update.

## Install

Copy this directory into:

```text
SillyTavern/plugins/inspiration-board-sync
```

Ensure this is enabled in `config.yaml`:

```yaml
enableServerPlugins: true
```

Then fully restart SillyTavern.

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

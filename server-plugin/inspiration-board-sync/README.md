# Inspiration Board Sync server plugin

This optional SillyTavern server plugin adds:

- Per-user compressed workspace storage for phone/PC sync.
- A small installable Android share-target PWA.
- A pending share inbox that the Inspiration Board can import.

## Install

Copy this directory into `SillyTavern/plugins/inspiration-board-sync`, ensure `enableServerPlugins: true` in `config.yaml`, and restart SillyTavern.

After restart, open:

`/api/plugins/inspiration-board-sync/app/`

in Chrome on Android and install it. It will appear as **Inspiration Board Inbox** in Android's Share menu. Images shared to it wait on the server until imported from Inspiration Board → Sync & Share.

Workspace files are stored under the current SillyTavern user's data root in `inspiration-board-sync/`.

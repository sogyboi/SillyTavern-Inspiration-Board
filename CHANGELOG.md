# Changelog

## 0.3.0

- Added Character Blueprint fields for canonical identity, face, hair, body, outfit, accessories, palette, art style, must-keep traits, allowed changes, and avoid rules.
- Added per-reference purpose, strength, strictness, must-preserve, crop-only, ignore-background, and instruction controls.
- Added grouped Identity, Design, Pose/Expression, Style, and Scene reference handling.
- Added a structured prompt builder with a visible final prompt and model-specific presets.
- Added 19 image-generation recipes, including portraits, sheets, turnaround, chibi, sprite, scene, chat scene, transparent asset, wallpaper, edit, and outpaint workflows.
- Added OpenRouter model capability badges, pricing estimates, credit display, cost warnings, per-job limit, and daily estimated-spend limit.
- Added automatic OpenRouter fallback for reference-count, unsupported-reference, and aspect-ratio failures.
- Added generation queue controls, retry/cancel/pause, comparison view, favorites/rejections, character gallery, and parent/child generation history.
- Added result actions for board placement, main portrait, reference reuse, variations, prompt editing, download, current chat, chat background, Character Creator handoff, and Image Lab.
- Added Image Lab with painted inpaint guides, outpaint guides, local background removal, AI isolation, and automatic crop packs.
- Added vision-assisted tagging, role suggestions, notes, palette extraction, text search, perceptual similarity search, smart clustering, and conflict reporting.
- Added current-chat scene prompting and multi-character board slots.
- Added optional per-user server sync and Android share-target plugin under `server-plugin/inspiration-board-sync`.
- Added tests for blueprint migration, references, recipes, prompt building, conflict detection, capabilities, cost limits, spend tracking, and generation trees.

## 0.2.1

- Added OpenRouter image generation using the key stored by SillyTavern.
- Added image-capable model loading, credit display, reference-image generation, result previews, and board/Inbox result storage.

## 0.2.0

- Added multi-photo Image Inbox with bulk placement and metadata controls.
- Added perceptual near-duplicate detection and review.
- Added named, colored, collapsible canvas groups/frames.
- Added lasso selection and expanded multi-select actions.
- Replaced the flat reference list with a permanent role-based Character Reference Basket.
- Added non-destructive crop/focal-point editing, rotation, flipping, ratings, favorites, source links, and notes.
- Added Character Design, Compact Design, and Blank Canvas templates.
- Added linked SillyTavern characters and field importing.
- Added optional vision-assisted character suggestions through SillyTavern Image Captioning.
- Added PNG moodboard export.
- Added automatic/manual history snapshots and restore.
- Improved Android/Z Fold gestures, hardware Back behavior, canvas-only mode, and bottom-toolbar option.
- Added a native SillyTavern top-bar launcher and removed reliance on the floating launcher.
- Added v0.1 state migration, automated core tests, syntax checks, and browser smoke tests.

## 0.1.5

- Added reliable Android touch launching and a settings-panel launcher.

## 0.1.0

- Initial infinite-canvas prototype with multi-photo upload, references, notes, backups, and Character Creator handoff.

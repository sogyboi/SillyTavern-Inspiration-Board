## 0.2.1 — Complete Venice model catalog

- Venice model discovery now requests the official full `type=all` live catalog rather than only `image` and `inpaint`.
- The model viewer shows the actual Venice API type and can filter image, edit/inpaint, upscale, video, text, music, TTS, ASR and embedding models.
- Non-image Venice models remain visible for discovery but are explicitly view-only and validation blocks them from Character Gallery's paid image endpoints.
- Newly added Venice models no longer require extension code changes; the normal live catalog cache refresh picks them up.
- Requires extension and `character-gallery-api` 0.2.1; rerun the existing Git-free installer and fully restart SillyTavern.

## 0.2.0 — Reference sets, collections and recovery

- Added named reference sets with identity/temporary layers, explicit first/base image, ordering and optional reference guidance.
- Added Review for new generations, Library, Archived, recoverable Recently deleted, and separate bulk selection.
- Added albums with shared image membership, safe rename/delete, and batch organization.
- Added a persistent mobile Generate bar, collapsible model/advanced controls, favorite models and cached browsing previews without changing original-image generation.
- Added streaming portable gallery backup, validated preview-first additive imports, credential-free metadata, and gallery relinking after avatar filename changes.
- Preserved original provider routing, per-character settings, user isolation and running-job ownership.
- Existing images remain kept on migration. Old DELETE requests now move images to recoverable trash.
- Requires extension and character-gallery-api 0.2.0; update both with the existing Git-free installer. Inspiration Board and the Capture Browser APK do not need changes.

# Changelog

## 0.1.1

- Added a Git-free Termux installer that downloads the public `character-gallery-studio` branch archive directly and installs both the extension and `character-gallery-api` server plugin.
- The archive installer removes Git metadata from the installed extension so SillyTavern does not launch Git credential prompts for this branch-based distribution.
- Disabled extension `auto_update`; rerun the Git-free installer to update Character Gallery Studio.
- Existing gallery data and provider keys are preserved. Previous extension/plugin code is backed up before replacement.
- Added installer shell-syntax verification to CI.

## 0.1.0

Initial Character Gallery Studio release: isolated per-character galleries, multi-upload, reference selection and original-image verification, OpenRouter/Venice image generation, live model capabilities and pricing, persistent settings, server-side jobs, inline generated results, mobile viewer, and separate per-user storage.

This extension and its `character-gallery-api` server plugin are independent of Inspiration Board and do not modify its data or `main` branch. Capture Browser does not need an update.

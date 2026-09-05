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

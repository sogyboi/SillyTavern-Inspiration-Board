# Venice image + video generation (v0.6.0)

Inspiration Board v0.6.0 adds Venice as a second media-generation provider beside OpenRouter.

## Setup

1. Update the Inspiration Board browser extension to v0.6.0.
2. Copy the current `server-plugin/inspiration-board-sync` folder to `SillyTavern/plugins/inspiration-board-sync` and fully restart SillyTavern.
3. Open **Generate → Venice**.
4. Paste a Venice API key once and choose **Save + test key**.

The Venice key is stored server-side in SillyTavern's `secrets.json` through SillyTavern's own secret helper. The key is never returned to browser JavaScript after it is saved.

## Model browser

The Generate button remembers the last provider. OpenRouter and Venice remain separate model catalogs instead of one giant combined list.

Venice can be filtered by:

- Image or Video
- Generate / Edit / Text-to-Video / Image-to-Video / Reference-to-Video
- Uncensored / NSFW-capable vs standard/other
- Search text
- Recommended/available, price, newest, or name

Model names, availability, privacy, constraints and image pricing are loaded from Venice's live Models API. Video pricing is obtained from Venice's exact `/video/quote` endpoint for the current duration/resolution/aspect/audio settings.

OpenRouter keeps its own model search and sorting. Its **Unmoderated** label is based on OpenRouter's live `top_provider.is_moderated` field. It should not be interpreted as a guarantee that every OpenRouter provider or fallback route accepts every adult prompt.

## Uncensored / NSFW labels

Venice exposes dedicated uncensored models/variants. Inspiration Board marks a model **Uncensored / NSFW-capable** when Venice's live model trait points to it, its live model metadata says uncensored/adult, or it is an explicit uncensored variant such as Lustify, `*-uncensored`, or the Wan 2.7 Enhanced video variants.

Image generation includes a **Safe mode** toggle. Safe mode on asks Venice to blur adult output; safe mode off requests the raw model output. Video does not use `safe_mode`; adult-content support is model-specific, so choose an uncensored video variant when needed.

## References

Board reference images are read from the original stored image, not thumbnails.

- Venice image edit: 1–3 reference images through `/image/edit` or `/image/multi-edit`.
- Image-to-video: the first reference becomes `image_url`.
- Flat reference-to-video families such as Seedance use `reference_image_urls`.
- Grok Imagine R2V uses its flat reference list.
- Kling O3 R2V is routed as structured character **Elements** plus scene references based on the board reference roles.

The UI filters models by their live media/task metadata rather than keeping a hardcoded model list.

## Video jobs

Video generation is asynchronous. Inspiration Board:

1. Requests an exact quote.
2. Queues the job.
3. Shows a persistent status chip while the job runs.
4. Polls Venice for status.
5. Shows the finished MP4 directly in the Venice Generate panel.
6. Provides **View full** and **Save MP4** actions.

The current completed-video preview history is kept for the current page session. Save important videos to the device if you need them after a full browser reload.

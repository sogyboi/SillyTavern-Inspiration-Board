# OpenRouter image generation

Inspiration Board v0.5.8 can generate images from inside the board with OpenRouter. Quick Generate now reads OpenRouter's live Image API model capabilities and pricing before it sends a request.

## Setup

1. In SillyTavern, open **API Connections**.
2. Configure/authorize **OpenRouter** once so SillyTavern has an OpenRouter API key saved.
3. Update/restart Inspiration Board.
4. Open a board and tap **Generate** in the board toolbar.

The extension does **not** store or display the OpenRouter API key. Reference-guided Quick Generate requests use the v0.5.8 `inspiration-board-sync` server plugin, which reads SillyTavern's existing server-side OpenRouter secret and forwards the request to OpenRouter's dedicated `/api/v1/images` endpoint.

## Generate from references

The Generate panel can use:

- selected canvas images
- the character reference basket
- the main portrait
- automatic selection (selected images first, then the reference basket)

Quick Generate reads `supported_parameters.input_references` from OpenRouter's dedicated image-model catalog. The UI shows whether references are unsupported, optional, or required and enforces the model's current min/max. The original stored image is sent rather than a downsized board thumbnail.

Style-reference models are labeled separately. For example, a Recraft Styles model uses references to match rendering style; that does not mean it is the best model for exact character-identity preservation.

## Controls

- OpenRouter image model
- aspect ratio
- output count constrained to the selected model's live `n` limit
- reference source
- send/don't send references
- add completed images directly to the canvas or save them to the Inbox
- save generated previews to the device

Generated board items are tagged `generated` and `openrouter` and keep the prompt/model metadata.

## Billing

OpenRouter image generation uses your OpenRouter credit balance. The panel shows the remaining balance when SillyTavern can retrieve it. OpenRouter currently does not offer free image-generation models.

## v0.5.7 pricing and send status

Generation Studio now enriches the SillyTavern image-model list with OpenRouter's dedicated Image API catalog and per-provider endpoint pricing. Price labels are unit-aware: a true flat output-image price is shown per image, variable flat tiers use a `from` label, megapixel-priced models are shown per MP, and token-priced models are explicitly marked `token-priced`. If pricing metadata cannot be loaded, the Studio keeps working and shows the price as unavailable instead of guessing.

A live status chip stays visible while a generation is queued or running. The client distinguishes between preparing the request, initiating the SillyTavern request, dispatching it, receiving the HTTP response, receiving image data, saving the result, and final success/failure. `Request dispatched` means the browser has handed the request to the SillyTavern generation endpoint; `OpenRouter responded` only appears after an HTTP response returns.

## v0.5.8 server-plugin requirement

If Quick Generate is sending reference images, copy the current `server-plugin/inspiration-board-sync` folder into `SillyTavern/plugins/inspiration-board-sync` and fully restart SillyTavern. `/api/plugins/inspiration-board-sync/status` should report v0.5.8+ and include `openrouter-image-api`. Updating the browser extension does not update a manually copied server plugin.

Quick Generate persists its controls and prompt in local browser storage immediately, so reopening the panel restores the last working setup.

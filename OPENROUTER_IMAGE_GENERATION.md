# OpenRouter image generation

Inspiration Board v0.2.1 can generate images from inside the board with OpenRouter.

## Setup

1. In SillyTavern, open **API Connections**.
2. Configure/authorize **OpenRouter** once so SillyTavern has an OpenRouter API key saved.
3. Update/restart Inspiration Board.
4. Open a board and tap **Generate** in the board toolbar.

The extension does **not** store or display the OpenRouter API key. Requests are sent through SillyTavern's existing `/api/openrouter/*` server routes, which use SillyTavern's server-side secret storage.

## Generate from references

The Generate panel can use:

- selected canvas images
- the character reference basket
- the main portrait
- automatic selection (selected images first, then the reference basket)

Up to eight references are attached. The prompt tells the model how each role should be used (face, hair, outfit, accessory, mood, environment, and so on).

Reference-image support depends on the selected OpenRouter image model. If a model rejects image input, use a model that supports image inputs (for example an appropriate GPT Image model) or turn off **Send reference images**.

## Controls

- OpenRouter image model
- aspect ratio
- 1-4 outputs per run
- reference source
- send/don't send references
- add completed images directly to the canvas or save them to the Inbox
- save generated previews to the device

Generated board items are tagged `generated` and `openrouter` and keep the prompt/model metadata.

## Billing

OpenRouter image generation uses your OpenRouter credit balance. The panel shows the remaining balance when SillyTavern can retrieve it. OpenRouter currently does not offer free image-generation models.

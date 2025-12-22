# Lumina Model Matrix

## Text models (agent/chat)
- `gemini-3-flash-preview` (TextModel.FLASH)
- `gemini-3-pro-preview` (TextModel.PRO)

## Image models
- `gemini-2.5-flash-image` (ImageModel.FLASH)
- `gemini-3-pro-image-preview` (ImageModel.PRO)

## Video models
- `veo-3.1-fast-generate-preview` (VideoModel.VEO_FAST)
- `veo-3.1-generate-preview` (VideoModel.VEO_HQ)

## Default policies
- Flash is default for speed unless the user explicitly asks for Pro/high quality.
- Image resolution defaults: Flash -> 1K, Pro -> 2K unless overridden.

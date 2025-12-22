# Official Gemini API Docs (JS)

Use these links for authoritative API details. Keep notes concise and aligned with docs.

## Gemini 3 (JS)
- https://ai.google.dev/gemini-api/docs/gemini-3?hl=zh-cn#javascript
- JS SDK: `GoogleGenAI` from `@google/genai`, call `ai.models.generateContent(...)`.
- Thinking: `thinking_level` controls reasoning depth; default is `high`. Even `minimal` still requires thought signatures.
- Temperature: keep default `1.0`; lower values can cause loops or degraded reasoning.
- Thought signatures (docs call them `thoughtSignature`):
  - Strict validation for function calling and image generation/editing; missing signatures => 400.
  - Parallel tool calls: only the first `functionCall` part includes a signature, but return all parts in exact order.
  - Sequential multi-step tools: every call can include a signature; return all accumulated signatures.
  - Streaming: signature may appear in a final empty-text chunk; parser must still capture it.
  - Official SDK auto-handles signatures when using standard chat history.

## Text generation
- https://ai.google.dev/gemini-api/docs/text-generation?hl=zh-cn
- Streaming: `generateContentStream` / `sendMessageStream`.
- Chat history is added only after the stream is fully consumed; history includes the aggregated response.

## Image generation
- https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn
- Multi-turn image editing: use a chat session and keep the conversation history; recommended for iterative edits.
- Chat config uses `responseModalities: ['TEXT', 'IMAGE']` when you want mixed text + image parts.
- Thought signatures in this doc appear as `thought_signature` in REST examples; pass back as-is.
- All image parts include signatures; missing signatures can cause failures in multi-turn edits.
- Models: `gemini-2.5-flash-image` (fast) and `gemini-3-pro-image-preview` (advanced editing).

## Video generation
- https://ai.google.dev/gemini-api/docs/video?hl=zh-cn&example=dialogue
- Veo 3.1: generates 8-second 720p or 1080p video with native audio.
- Features: video extension, first/last-frame guidance, up to 3 reference images.
- JS flow: `ai.models.generateVideos(...)` -> poll `ai.operations.getVideosOperation(...)` until done -> `ai.files.download(...)`.

## Nanobanana
- https://ai.google.dev/gemini-api/docs/nanobanana?hl=zh-cn
- "Nano Banana" is the branding for Gemini native image generation.
- Models: `gemini-2.5-flash-image` (speed/volume) and `gemini-3-pro-image-preview` (pro, reasoning).

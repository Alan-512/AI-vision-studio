# Lumina Studio Gemini Integration (Project Reference)

## SDK and keys
- SDK: `@google/genai` (package.json shows `^1.0.0`).
- User key: `localStorage` key `user_gemini_api_key` in `services/geminiService.ts`.
- Dev-only key: `VITE_API_KEY` (README). End-users must save a key in Settings.

## Core files
- `services/geminiService.ts`: text streaming, image generation, video generation, image chat session.
- `components/ChatInterface.tsx`: text chat UI, streaming, agent tool calls.
- `components/GenerationForm.tsx`: studio params UI and chat panel wiring.
- `App.tsx`: tool call handling, task lifecycle, asset updates.

## Current data flow
- Text chat uses `streamChatResponse(...)` with `TextModel` (Flash/Pro).
- Tool call arrives as `{toolName, args}`; `args` can be wrapped as `{ parameters: ... }`.
- `handleAgentToolCall` normalizes args, validates prompt, and triggers `generateImage`/`generateVideo`.
- Chat and Studio params are isolated: chat uses `chatParams`, studio uses `params`.
- Chat generation auto-attaches the most recent image from `chatHistory` as a reference (`smartAssets`).

## Image generation
- `getImageChat(projectId, model, useGrounding)` creates a per-project image chat session.
- `generateImage(...)` uses `chat.sendMessage({ message, config })` with `responseModalities: ['TEXT','IMAGE']`.
- Image output is inline base64 data; add to assets or chat context as needed.

## Video generation
- `generateVideo(...)` uses `ai.models.generateVideos` and polls `ai.operations.getVideosOperation`.
- Requires download link + API key; downloads blob and returns a blob URL.

## Search and tools constraint
- Text chat cannot combine `googleSearch` tools and function declarations in one request.
- When search is on, use the text trigger fallback in `streamChatResponse`.

## Product constraints to preserve
- Generation requires user-supplied API key; dev key is for local testing only.
- Comparison is image-only.

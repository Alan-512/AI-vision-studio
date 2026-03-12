# Project Context

## Purpose
AI Vision Studio is a browser-first creative workspace for AI image and video generation with Google Gemini and Veo models. The product combines a studio-style parameter panel with a chat-driven assistant that can plan prompts, use reference images, search for external facts, generate or edit images, and persist project history locally.

## Tech Stack
- React 18 with TypeScript
- Vite for local development and production build
- `@google/genai` for Gemini text, image, search, and Veo video calls
- Browser storage via local persistence services in `services/storageService.ts`
- Vitest with jsdom for unit tests
- Cloudflare Pages style frontend deployment, with optional Deno proxy for long-running API calls

## Project Conventions

### Code Style
- Functional React components with hooks; avoid class components
- Shared product types live in `types.ts`
- Service modules under `services/` hold integration logic, prompt routing, persistence, and memory behavior
- Prefer small, explicit helper functions over hidden magic in UI components
- Preserve chat params and studio params isolation; do not let chat-side agent behavior silently mutate studio defaults

### Architecture Patterns
- `App.tsx` is the main orchestration shell for project state, tasks, assets, and chat/tool bridging
- `components/ChatInterface.tsx` owns streaming UI state, upload handling, and the user-facing chat workflow
- `services/geminiService.ts` is the integration layer for Gemini text/image/video requests, search flow, and response parsing
- `services/agentService.ts` contains the lightweight agent state machine and helper actions
- Existing architecture is chat-history-centric: images, search progress, and system feedback are often written back into the transcript instead of a dedicated artifact runtime
- Existing docs in `docs/` describe prior architecture thinking; new OpenSpec changes should align with the real codebase rather than replace it with abstract patterns

### Testing Strategy
- Use `npm run test:run` as the baseline validation command
- Current coverage is strongest around service helpers and state-machine behavior
- Architecture changes must add tests for the real chat -> tool call -> generation bridge, not only unit tests for helper functions
- For major runtime changes, prefer both unit tests and at least one end-to-end or integration-style workflow test

### Git Workflow
- The repository may contain ongoing local edits; do not revert unrelated work
- Use OpenSpec proposals for architecture changes, new capabilities, and behavior-changing refactors before implementation
- Keep changes incremental and reviewable; prefer phased migration over a single large rewrite

## Domain Context
- The app supports both image and video workflows, but the most complex path today is image generation through chat
- Image generation supports reference images, edit base images, masks, aspect ratios, resolution, model selection, negative prompts, and multi-turn context
- Search can be used to gather external facts for image generation, but Gemini request constraints mean `googleSearch` and `functionDeclarations` cannot be used in the same request
- The current product already exposes thought text, thought images, `thoughtSignature`, search progress, and autonomous tool-call UX
- User-facing quality depends heavily on preserving subject consistency, explicit artifact references, and reliable multi-turn context

## Important Constraints
- BYOK model: user API keys are stored in browser local storage; server-side secrets are not assumed for normal usage
- The frontend must remain usable even if long-running generations take minutes or the user switches projects
- Existing project and asset history is stored locally and should remain backward compatible during migrations
- Chat and studio modes share assets and projects but have different parameter semantics
- Gemini-specific constraints and model capability differences must remain explicit in the runtime

## External Dependencies
- Google AI Studio / Gemini API
- Veo video generation endpoints via `@google/genai`
- Optional Deno proxy used to bypass browser/server timeout limits for long-running requests
- Browser APIs: Local Storage, IndexedDB-like persistence wrappers, Blob URLs, File APIs, Web Audio

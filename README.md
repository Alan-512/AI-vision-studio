<div align="center">

# AI Vision Studio

**[English](README.md)** | [中文](README_zh.md)

Browser-first AI image and video studio powered by **Google Gemini** and **Veo**.  
It combines a parameter-driven studio workspace with a chat assistant that can plan, generate, review, revise, and continue image tasks across multi-turn sessions.

</div>

## Overview

AI Vision Studio is built for creators who want both direct control and agent-assisted workflows. You can work from the studio panel when you want explicit parameters, or stay in chat and let the assistant orchestrate image generation, reference reuse, search grounding, local memory, and multi-step revisions.

This repository is frontend-first and BYOK by default: your API key stays in browser storage, projects stay local, and the app can run without a dedicated backend. For deployments that need a proxy path, the repo also includes a Cloudflare Pages Function for `/api/*`.

## Features

### Advanced Image Generation

- **Gemini-powered image workflows**: Create and edit images with Google's latest image-capable Gemini models.
- **Pro-level controls**: Adjust aspect ratio, quality, negative prompts, and task-specific generation parameters from the studio UI.
- **Reference-aware generation**: Reuse uploaded references, prior outputs, and artifact history to maintain subject, structure, and style continuity.
- **Search-assisted prompting**: Bring external facts into image tasks when products, brands, or real-world details matter.

### Video Creation

- **Veo-powered generation**: Create video content from text and visual guidance.
- **Extension workflows**: Continue existing video generations when the task requires follow-up motion.
- **Reference-guided tasks**: Use images and prior outputs to guide video direction and consistency.

### Deep Agent Assistant

- **Chat-first orchestration**: Describe what you want in natural language and let the assistant plan and trigger the right workflow.
- **Multi-step image runtime**: The assistant can run `review -> revise -> requires_action` instead of treating image generation as a single fire-and-forget tool call.
- **Continuation support**: When a task needs user input, the assistant can pause and continue the same image job instead of restarting from scratch.
- **Artifact-first context**: References, search results, and generated outputs are tracked as runtime artifacts instead of living only in chat history.

### Editing and Inpainting

- **Canvas-based editing**: Work with image editing and masked update flows directly in the app.
- **Localized changes**: Target specific regions while preserving the rest of the composition.
- **Mask workflow support**: Base image, mask, and edit instructions are handled as separate parts of the edit pipeline.

### Memory and Context

- **Rolling short-term context**: Recent turns stay explicit while older chat is compacted into summaries.
- **Local-first memory**: Long-term preferences and project context are persisted locally instead of requiring a backend memory service.
- **On-demand retrieval**: Memory can be retrieved into the same turn when needed rather than injected as a large fixed prompt every time.

### Privacy and BYOK

- **Bring Your Own Key**: API keys are stored in browser local storage.
- **Local project persistence**: Projects, assets, and memory stay local by default.
- **No required application backend**: The default setup works without a dedicated server.

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS via CDN in [index.html](index.html) plus custom styles
- `@google/genai`
- IndexedDB/local persistence services
- Vitest + jsdom

## Quick Start

### Requirements

- Node.js 18+
- A Google AI Studio API key

### Installation

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` and enter your API key in the app settings.

## Validation

```bash
npm run test:run
npm run build
```

## Deployment

### Static BYOK deployment

For most setups, this project can be deployed as a static frontend.

- Build command: `npm run build`
- Output directory: `dist`

### Cloudflare Pages with optional proxy

This repository includes a Cloudflare Pages Function at [functions/api/[[catchall]].ts](functions/api/[[catchall]].ts) that proxies `/api/*` requests to Gemini endpoints.

Use this path when you want:

- an edge proxy for browser-originated API requests
- a more stable route in regions where direct access is unreliable
- a frontend-first deployment model with optional server-side routing

The app also supports an optional Deno proxy configuration for long-running requests.

## Repository Layout

```text
components/   React UI
contexts/     shared React contexts
functions/    Cloudflare Pages Functions
openspec/     architecture changes and implementation specs
services/     Gemini, agent, memory, storage, and runtime logic
tests/        Vitest coverage
docs/         architecture notes
```

## Documentation

Long-form architecture notes live under [docs/architecture](docs/architecture):

- `agent-architecture-upgrade.md`
- `image-generation-architecture.md`
- `long-term-memory-system-v1.md`
- `mask-editing-workflow.md`
- `playbook-agent-mode.md`

Structured change proposals and implementation history live under [openspec/](openspec/).

## License

MIT. See [LICENSE](LICENSE).

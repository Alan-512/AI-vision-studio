# AI Vision Studio

Browser-first AI image and video studio built with React, Vite, Google Gemini, and Veo. It combines a parameter-driven studio workspace with a chat assistant that can plan generations, reuse references, manage local project history, and drive multi-step image jobs.

## Highlights

- Image generation and editing with Gemini image models
- Video generation and extension with Veo
- Chat-first image agent runtime with `review -> revise -> requires_action`
- Reference-aware image workflows and artifact-based job history
- Local-first memory and context management for multi-turn work
- BYOK mode with API keys stored in browser local storage
- Optional Cloudflare Pages Function proxy for `/api/*`

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

### Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, then enter your API key in settings.

## Validation

```bash
npm run test:run
npm run build
```

## Deployment

### Static BYOK deployment

The app can be deployed as a static frontend. For most users, this is enough.

- Build command: `npm run build`
- Output directory: `dist`

### Cloudflare Pages with optional proxy

This repository also includes a Cloudflare Pages Function at [functions/api/[[catchall]].ts](functions/api/[[catchall]].ts) that can proxy `/api/*` requests to Gemini endpoints.

Use this when you want:

- an edge proxy for browser requests
- a more stable path for regions where direct access is unreliable
- a frontend-only deployment with optional server-side routing

The app also supports an optional Deno proxy configuration for long-running requests.

## Repository Layout

```text
components/   React UI
contexts/     shared React contexts
functions/    Cloudflare Pages Functions
openspec/     architecture changes and specs
services/     Gemini, agent, memory, storage, runtime logic
tests/        Vitest coverage
docs/         architecture notes
```

## Architecture Notes

Useful docs live under [docs/architecture](docs/architecture):

- `agent-architecture-upgrade.md`
- `image-generation-architecture.md`
- `long-term-memory-system-v1.md`
- `mask-editing-workflow.md`
- `playbook-agent-mode.md`

Structured change history and implementation plans live under [openspec/](openspec/).

## License

MIT. See [LICENSE](LICENSE).

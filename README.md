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

- Gemini image generation and editing workflows
- Aspect ratio, quality, negative prompt, and reference-image controls
- Multi-turn image editing with reusable references and artifact history
- Search-assisted image prompts when external facts or product details matter
- Mask-based editing workflow for localized changes

### Video Creation

- Veo-powered video generation
- Video extension workflows
- Image-guided and reference-guided video tasks

### Agent Assistant

- Chat-first image assistant with tool calling
- Image job runtime with `review -> revise -> requires_action`
- Action-card based continuation for tasks that need user input
- Artifact-first context handling for references, search context, and generated outputs
- Local-first memory and rolling context management for longer sessions

### Privacy and Local Persistence

- BYOK mode with keys stored in browser local storage
- Project history and assets persisted locally
- No required application backend for the default setup

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

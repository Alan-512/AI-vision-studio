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

- **Powered by Gemini 3.1**: Support for `gemini-3.1-flash-image-preview` (Nano Banana 2) and `gemini-3-pro-image-preview` (Nano Banana Pro).
- **Pro-Level Controls**: Fine-tune Aspect Ratio (including 1:4, 1:8, etc.), Style, Resolution (0.5K, 1K, 2K, 4K), and Negative Prompts.
- **Smart Assets**: Support for up to 14 reference images (NB2) to control **Identity (Character)**, **Structure (Pose/Layout)**, and **Style (Vibe)**.
- **Grounding**: Built-in Google Search grounding for accurate real-world visual generation (NB2).

### Video Creation

- **Veo Model Integration**: Generate high-quality videos using Google's latest `Veo` model (`veo-3.1`).
- **Video Extension**: Upload existing videos and extend them seamlessly (720p).
- **Keyframe & Reference Control**: Use images to guide the start/end frames or lock character consistency in videos.

### Deep Agent Assistant

- **Thinking Process**: Powered by **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`). The AI Assistant doesn't just reply; it thinks, plans, and executes complex workflows.
- **Autonomous Control**: The Agent can autonomously control the studio interface, changing models, parameters, and initiating generation based on natural language requests.
- **Auto-Selection**: Intelligent model selection logic that ensures the best output for your specific prompt.

### Editing and Inpainting

- **Canvas Editor**: Integrated editor for masking and inpainting.
- **Region-Based Editing**: Define specific regions with instructions (e.g., "Make this shirt red") while keeping the rest of the image intact.

### Privacy and BYOK

- **Bring Your Own Key**: Your API Key is stored securely in your browser's Local Storage.
- **No Middleman**: Requests go directly from your browser to Google's servers. We do not store or see your keys.

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

---
name: lumina-gemini-api
description: Project-specific guidance for Lumina Studio's Gemini API integration across text chat, image generation, video generation, function calling, search, thinking, and multi-turn context. Use when working in services/geminiService.ts, services/agentService.ts, components/ChatInterface.tsx, or App.tsx, or when debugging prompt/parameter flow and context bridging for Gemini/Veo in this project.
---

# Lumina Gemini Api

## Overview

Use this skill to implement or debug Lumina Studio's Gemini API behavior with correct prompt flow, tool calling, and context handling for text, image, and video generation.

## Workflow

1. Identify the request type: text chat, image gen, video gen, tool calling, search, or multi-turn editing.
2. Open the project implementation reference first to align changes with current behavior.
3. Check official API notes only for the relevant surface (text, image, video, tools).
4. Make changes in the smallest scope and keep chat vs studio isolation intact.
5. Verify model IDs and config fields against the model matrix.

## Guardrails

- Treat tool call args as possibly wrapped in `parameters`; unpack before use.
- Do not fall back to Studio params when handling chat tool calls; keep chat and studio contexts isolated.
- Keep search and function declarations in separate requests; do not mix them.
- Preserve multi-turn image behavior by using the per-project image chat session or explicit reference images.

## References

- `references/lumina-implementation.md`: open when changing or debugging project code paths.
- `references/model-matrix.md`: open when validating model IDs or defaults.
- `references/official-docs.md`: open when verifying API surface details or best practices.

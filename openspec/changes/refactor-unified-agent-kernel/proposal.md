# Change: Refactor the chat and image generation stack into a unified agent kernel

## Why
The current architecture has converged on the same user surface, but it still operates through multiple overlapping execution layers: a chat-side tool loop, a generation task flow, a critic/requires-action flow, and page-level orchestration in `App.tsx`. This split makes sequence generation, tool fan-out semantics, retry behavior, and write-model ownership harder to reason about and easier to break.

Recent failures exposed the structural issue directly:
- a single conversational request for a four-frame sequence fanned out into multiple generation tasks while still passing `numberOfImages > 1` into each task
- the runtime has no single place to validate that tool-call semantics match generation semantics
- chat tool execution and generation lifecycle progression still meet only through adapters and controllers rather than one kernel-owned command loop

## What Changes
- Introduce a unified `AgentKernel` contract that owns chat turns, tool-call planning, tool execution, tool-result reinjection, `TurnRuntimeState`, and `AgentJob` mutation decisions
- Replace the current split between chat runtime and generation runtime with one kernel-facing command model and one toolbox-facing tool execution contract
- Reframe generation, review, requires-action resolution, resume, and cancel as kernel commands or kernel-owned tool results rather than page-level orchestration branches
- Define a first-class toolbox/registry layer with explicit tool classes so chat tools, generation tools, critic steps, and memory tools do not share ambiguous execution semantics
- Reduce `App.tsx` and `ChatInterface.tsx` to surface adapters that submit commands and subscribe to kernel-owned projections
- Keep `BackgroundTaskView` and transcript as derived projections, not execution truth, and fix recovery to rebuild projections from write models

## Impact
- Affected specs: `unified-agent-kernel`, `image-agent-runtime`
- Affected code: `App.tsx`, `components/ChatInterface.tsx`, `services/chat*`, `services/generation*`, `services/agentRuntime.ts`, `services/geminiService.ts`, tool runtimes, persistence adapters, related tests

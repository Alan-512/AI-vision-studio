# Change: Refactor image agent runtime into a closed-loop artifact-driven architecture

## Why
The current image chat flow is usable for single-turn generation, but it is not a true image agent runtime. Tool execution is optimistic, retries are detached from actual generation completion, and execution state is reconstructed from chat history and inline image blobs. That makes multi-step generation, review, revision, and long-running task recovery brittle.

## What Changes
- Introduce a closed-loop tool execution contract so the orchestrator waits for real image task completion and receives structured tool results
- Separate artifact and job state from the chat transcript so references, search facts, generated outputs, and review outputs have stable IDs and lineage
- Upgrade the image agent workflow from one-shot dispatch to a multi-step job flow: plan, execute, review, revise, and finalize
- Promote search outputs to first-class retrieved context that can be reused by later agent steps instead of only being flattened into prompt text
- Keep the current chat UX and backward compatibility during migration, but move runtime truth out of transient UI state
- Preserve existing locally stored projects and transcript-backed references through explicit compatibility adapters and migration rules

## Impact
- Affected specs: `image-agent-runtime`
- Affected code: `components/ChatInterface.tsx`, `services/geminiService.ts`, `services/agentService.ts`, `services/storageService.ts`, `App.tsx`, related tests

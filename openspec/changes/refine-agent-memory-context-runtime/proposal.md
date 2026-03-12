# Change: Refine image-agent memory and context runtime

## Why
The current image-agent runtime is now closed-loop for generation, review, revision, and artifact persistence, but its context and memory layer still has several architectural gaps.

- Long-term memory is injected into nearly every request as a fixed snippet instead of being retrieval-first
- The memory tool contract is inconsistent: the prompt layer refers to `read_memory`, the runtime declares `memory_search`, and tool results are not consistently fed back into the model within the same turn
- Short-term conversation context still depends heavily on raw transcript replay, while the `contextSummary` pipeline exists but is not actually used to compact history over time
- Artifact state, transcript state, summary state, and long-term memory each exist, but their responsibilities are not yet clearly separated

These issues do not block basic operation, but they do limit scalability, increase prompt noise, and keep the assistant below current best practices for agent memory and context engineering.

## What Changes
- Standardize the memory tool contract so on-demand memory retrieval is explicit, correctly named, and part of the same-turn tool-result loop
- Move long-term memory from mostly fixed prompt injection to a layered model: lightweight always-on memory plus on-demand retrieval for detailed preferences and prior decisions
- Activate rolling conversation summarization so older transcript content can be compacted into a maintained project summary instead of replaying the full raw chat forever
- Clarify the runtime boundaries between transcript history, artifact/job state, short-term summary state, and long-term memory state
- Keep compatibility with existing locally stored projects, current memory documents, and current chat behavior during the transition

## Impact
- Affected specs: `image-agent-memory-context-runtime`
- Affected code: `services/geminiService.ts`, `services/memoryService.ts`, `services/agentRuntime.ts`, `services/agentService.ts`, `App.tsx`, related tests

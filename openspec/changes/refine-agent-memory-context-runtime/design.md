## Context
The completed `refactor-image-agent-runtime` change established an artifact-driven image-job runtime. Generated outputs, references, and search context now persist outside the transcript, and the system can complete multi-step image jobs within a single runtime loop.

However, memory and text context management still lag behind that runtime foundation. The codebase already contains useful primitives:
- global and project memory documents
- daily memory logs and background consolidation
- a `memory_search` implementation
- a `contextSummary` state channel
- image-history compaction that keeps only a small number of inline images

But those primitives are not yet combined into a coherent memory/context architecture. Long-term memory is still mostly stuffed into `systemInstruction`, memory retrieval is not consistently routed through the model as a same-turn tool-result loop, and rolling conversation summary is not actually doing any compaction work.

## Goals / Non-Goals
- Goals:
- Make long-term memory retrieval explicit, tool-based, and same-turn
- Reduce prompt bloat by replacing broad fixed memory injection with layered memory access
- Compact older conversation context into a durable summary instead of replaying unbounded raw transcript history
- Define clear responsibilities for transcript, artifacts, summary state, and long-term memory
- Preserve current user-facing chat behavior while improving internal context quality

- Non-Goals:
- Do not redesign the image-agent critic/planning flow in this change
- Do not introduce backend vector databases or server-side memory as a requirement
- Do not remove compatibility adapters for existing projects during the first implementation pass
- Do not change unrelated video workflows unless they reuse the same context primitives naturally

## Decisions
- Decision: Standardize on one memory retrieval tool contract
  - The runtime should not refer to both `read_memory` and `memory_search` for similar behavior.
  - A single tool contract should represent on-demand memory retrieval, and the prompt layer, function declarations, and execution layer must agree on the same name and schema.
  - The result of that retrieval must be sent back into the model inside the same interaction loop so the model can use the retrieved memory before producing its next action or answer.

- Decision: Use layered memory access
  - A very small always-on memory layer may still be injected to preserve durable guardrails and stable defaults.
  - Detailed preferences, historical project decisions, and prior creative patterns should be loaded on demand rather than injected wholesale into every request.
  - Global memory and project memory remain separate namespaces.

- Decision: Turn `contextSummary` into a real rolling short-term summary
  - The app should maintain a compact summary of older conversation state and use it to replace raw transcript replay when the conversation grows.
  - Recent turns stay verbatim; older turns can be summarized.
  - The summary should be stored with the project and updated incrementally rather than recomputed from scratch every time.

- Decision: Keep artifact truth separate from text memory
  - Artifacts remain the authoritative store for images, references, and retrieved search outputs.
  - Transcript remains a user-facing conversation log.
  - Summary state captures compressed short-term context.
  - Long-term memory stores durable user/project preferences and prior decisions.
  - The runtime should not treat these as interchangeable sources of truth.

- Decision: Preserve current memory write-back model for phase 1
  - Explicit memory writes through tool calls and passive logging/consolidation remain valid.
  - The initial implementation should focus on read-path correctness and context layering before changing the write-path architecture again.

## Alternatives Considered
- Keep injecting the full memory snippet into every request
  - Rejected because it scales poorly, dilutes relevance, and does not match current retrieval-first agent guidance.

- Replace all memory logic with embeddings or a vector store immediately
  - Rejected because the product can improve materially with a better layered local memory design before introducing heavier infrastructure.

- Delete transcript history aggressively instead of maintaining rolling summaries
  - Rejected because users still need recent verbatim context and auditability in the chat log.

## Risks / Trade-offs
- Same-turn memory tool loops add orchestration complexity
  - Mitigation: keep the initial tool contract simple and only support the retrieval paths needed by the runtime today

- Over-aggressive summarization could erase nuance needed for creative continuity
  - Mitigation: retain recent verbatim turns and only summarize older spans with explicit cursor tracking

- Retrieval-first memory can under-inject useful defaults if the always-on layer becomes too small
  - Mitigation: keep a minimal durable default snippet for guardrails and stable preferences, and move only detailed context to on-demand retrieval

- Compatibility behavior can become messy if transcript and summary boundaries are not explicit
  - Mitigation: define source-of-truth rules clearly and add tests for migration behavior

## Rollout Plan
1. Unify the memory retrieval tool contract and close the same-turn tool-result loop.
2. Split long-term memory into always-on lightweight snippet vs on-demand retrieval payloads.
3. Activate incremental conversation summary updates and integrate them into request building.
4. Define and enforce the source-of-truth boundaries between transcript, summary, artifact runtime, and long-term memory.
5. Add verification for memory retrieval, summary compaction, and compatibility fallback behavior.

## Open Questions
- Should detailed memory retrieval results be stored as transient tool responses only, or also persisted as summary/runtime metadata for later auditing?
- Which sections of global/project memory belong in the always-on layer by default, and which should only be loaded on demand?
- What should trigger summary refresh: message count, token estimate, or explicit artifact/job milestones?

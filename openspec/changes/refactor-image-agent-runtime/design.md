## Context
The current image-generation path runs through `ChatInterface -> streamChatResponse -> handleAgentToolCall -> generateImage`. It already supports streaming thought text, search progress, prompt routing, tool calls, and reference images. However, the runtime still treats chat history as the main execution state. Generated images and system feedback are written back into the transcript, while the agent state machine resolves success before the underlying generation job actually finishes.

The repository also already contains partial foundations for a more explicit runtime, including `AgentJob`-style types in `types.ts` and prior architecture notes under `docs/`. This change should build on those foundations rather than replace the product workflow wholesale.

## Goals / Non-Goals
- Goals:
- Create a real closed-loop image agent runtime where tool execution returns structured results tied to actual completion
- Make artifacts, search outputs, and review outputs addressable by stable IDs instead of only existing inside chat messages
- Support multi-step image jobs that can plan, generate, review, revise, and wait for user action
- Preserve the existing chat UX while reducing architecture risk through phased migration

- Non-Goals:
- Do not redesign the visual chat interface in this change
- Do not introduce a multi-agent swarm architecture
- Do not rewrite unrelated video-generation paths unless they share runtime primitives naturally

## Decisions
- Decision: Introduce an artifact-driven runtime for image jobs
  - The system will maintain explicit job and artifact records for generated images, user references, search facts, and review outputs.
  - Chat messages become a presentation layer that references artifacts instead of being the sole runtime truth.

- Decision: Standardize tool execution around structured tool results
  - `generate_image` execution must return a structured result that includes job status, artifact refs, task metadata, and retryable error information.
  - The agent state machine must transition from actual execution results, not optimistic dispatch.
  - The orchestrator must consume that tool result inside the same job so it can decide whether to finalize, review, revise, or request human input.

- Decision: Support one job with multiple steps
  - A single image agent job may include planning, retrieval, generation, review, and revision substeps.
  - Human-in-the-loop pauses are represented as job states such as `requires_action`, not implicit UI waits.

- Decision: Treat search as retrievable context, not only prompt text
  - Search facts, sources, and synthesized prompt notes will be stored with the job and may still be injected into prompts when needed.
  - Later steps must be able to reference retrieved context without reparsing prior assistant prose.

- Decision: Migrate in compatibility layers
  - Existing chat history, persisted projects, and current `generateImage` behavior should continue to work during the migration.
  - New runtime storage and references should be introduced alongside compatibility adapters before older transcript-derived behavior is removed.

- Decision: Scope async recovery to what the current frontend architecture can actually guarantee
  - The app can persist authoritative job records and restore the last known state after UI churn.
  - Without a background worker or server-side execution layer, an in-flight browser request cannot be guaranteed to continue after refresh or tab close.
  - Interrupted jobs must therefore resume from explicit retry or be marked as interrupted/failed, rather than pretending generation continued in the background.

## Alternatives Considered
- Keep the existing chat-history-centric runtime and only patch retries
  - Rejected because it would not solve artifact lineage, multi-step revision, or long-running job recovery.

- Introduce many specialized agents immediately
  - Rejected because orchestration complexity would outpace current product needs. A single orchestrator with explicit job phases is the lower-risk path.

- Move all orchestration into UI components
  - Rejected because runtime truth needs persistence and recoverability beyond one render tree.

## Risks / Trade-offs
- More explicit runtime types and persistence will increase near-term code complexity
  - Mitigation: phase the migration and keep compatibility adapters until tests cover the new path

- Artifact persistence may require storage schema changes
  - Mitigation: version the schema and keep transcript fallback during migration

- Closed-loop tool execution can change perceived responsiveness
  - Mitigation: keep streaming UI updates and expose job progress states to users

- Browser refresh interrupts direct BYOK requests
  - Mitigation: persist last known job state, mark interrupted work explicitly, and defer true background resumability until a backend execution layer exists

## Migration Plan
1. Define runtime contracts for jobs, artifacts, tool calls, and tool results.
2. Persist job and artifact metadata separately from chat messages.
3. Route image tool execution through the new runtime while keeping current UI rendering.
4. Feed structured tool results back into the orchestrator for review/revision loops.
5. Remove transcript-derived fallback logic after runtime tests prove parity.

## Open Questions
- Which runtime service should own orchestration long term: a new dedicated image-agent runtime service or an expanded `agentService.ts`?
- How much of the current `thoughtSignature` and inline image handling can be preserved as-is versus normalized into artifact metadata?
- Should search facts be stored inside the same artifact collection as images, or as a separate retriever/result store linked to the job?

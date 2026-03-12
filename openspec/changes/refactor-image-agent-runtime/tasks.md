## 1. Runtime Contracts
- [x] 1.1 Define explicit job, artifact, tool call, and tool result contracts for image-agent execution
- [x] 1.2 Decide how runtime records are persisted and versioned alongside existing project storage

## 2. Orchestration Refactor
- [x] 2.1 Move image tool execution off optimistic UI dispatch and bind agent state transitions to actual task completion
- [x] 2.2 Introduce job phases for planning, execution, review, revision, completion, failure, and requires-action pauses
- [x] 2.3 Ensure retries and cancellation use real execution outcomes instead of synthetic success

## 3. Artifact and Context Handling
- [x] 3.1 Store generated images, user references, search outputs, and review outputs as stable runtime artifacts
- [x] 3.2 Replace transcript-only reference selection with artifact references and lineage metadata
- [x] 3.3 Keep compatibility adapters so existing chat history and saved projects still render correctly during migration
- [x] 3.4 Define how interrupted in-flight browser jobs are recorded and surfaced after refresh or tab close

## 4. Closed-Loop Agent Flow
- [x] 4.1 Return structured tool results from image generation back into the orchestrator
- [x] 4.2 Support at least one generate -> review -> revise path within a single image agent job
- [x] 4.3 Expose user-visible job progress and human-in-the-loop pauses without losing current chat UX
- [x] 4.4 Ensure the orchestrator consumes tool results within the same job before terminal completion is emitted

## 5. Verification
- [x] 5.1 Add tests for chat -> tool -> generation -> tool result -> runtime state transitions
- [x] 5.2 Add tests for artifact persistence and reference reuse across multi-step image jobs
- [x] 5.3 Validate migration behavior for existing projects, chat history, and reference images

## Current Focus
- Remaining work is concentrated in artifact-first reference handling, migration validation, and broader end-to-end coverage.
- The dev-only `/debug action-card` preview remains intentionally enabled while interaction design is still being reviewed, and should be removed during release cleanup.

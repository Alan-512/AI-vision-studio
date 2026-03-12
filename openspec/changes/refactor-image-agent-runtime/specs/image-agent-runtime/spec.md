## ADDED Requirements

### Requirement: Closed-loop image tool execution
The system SHALL execute image-generation tool calls through a runtime that waits for actual task completion and returns a structured result to the agent orchestrator.

#### Scenario: successful generation returns a structured tool result
- **WHEN** the agent issues a `generate_image` action
- **THEN** the runtime waits until the image task completes or fails
- **AND** returns a structured result that includes the job ID, status, produced artifact references, and any execution metadata needed by later steps
- **AND** the agent runtime updates its state from that execution result rather than from optimistic dispatch

#### Scenario: tool results are consumed inside the same job
- **WHEN** a `generate_image` action finishes successfully
- **THEN** the orchestrator consumes the returned tool result within the same image job
- **AND** decides whether to finalize, review, revise, or pause for human input before emitting terminal job completion
- **AND** terminal completion reflects the final reviewed artifact state rather than mere dispatch success

#### Scenario: retries depend on actual execution failures
- **WHEN** image generation fails with a retryable error
- **THEN** retry behavior is triggered from the actual execution response
- **AND** the runtime does not mark the action successful before the image task has completed

### Requirement: Artifact-driven context management
The system SHALL store generated images, user references, search outputs, and review outputs as stable artifacts separate from the chat transcript.

#### Scenario: multi-step workflows use stable artifact references
- **WHEN** an image job spans planning, generation, review, and revision
- **THEN** each step references stable artifact IDs and lineage metadata
- **AND** chat messages may summarize or preview those artifacts without becoming the only runtime source of truth

#### Scenario: historical references remain addressable outside inline model limits
- **WHEN** model-specific inline image limits prevent all historical images from being sent in one request
- **THEN** the runtime keeps full artifact records and selection metadata for those references
- **AND** the orchestrator can explicitly choose which artifacts to rehydrate for the next model call

### Requirement: Multi-step image agent jobs
The system SHALL support a single image agent job that can plan, generate, inspect, revise, and finalize output.

#### Scenario: generate and revise within one job
- **WHEN** the orchestrator decides the first generated image does not satisfy the active constraints
- **THEN** it can inspect the generated artifact, execute a revision step, and create a new artifact within the same job
- **AND** the user can observe job progress across planning, generation, review, and finalization

#### Scenario: job pauses for human input
- **WHEN** the orchestrator needs user confirmation or missing input before continuing
- **THEN** the job enters a `requires_action` state
- **AND** the runtime exposes the pending action needed to resume execution

### Requirement: Search outputs are first-class retrieved context
The system SHALL persist search-phase outputs as structured retrieved context that later agent steps can reuse.

#### Scenario: retrieved facts are reused by later steps
- **WHEN** a request performs an external search before generation
- **THEN** retrieved facts, sources, and synthesized prompt notes are stored with the job
- **AND** later generation or review steps can reference those results without reparsing free-form transcript text

### Requirement: Async job lifecycle survives UI churn
The system SHALL maintain authoritative job state for long-running image tasks independent of a single UI render cycle.

#### Scenario: project switches do not silently lose execution state
- **WHEN** a long-running image job is active and the user switches views, reloads the app, or changes the active project tab
- **THEN** persisted job state remains recoverable from storage as the last known authoritative state
- **AND** the UI restores that last known state from runtime records rather than assuming success or silently losing the job

#### Scenario: interrupted browser requests are marked explicitly
- **WHEN** a browser refresh, tab close, or navigation interrupts an in-flight direct generation request
- **THEN** the runtime marks the affected job as interrupted or failed based on the last known execution state
- **AND** the system requires explicit retry or resume logic before attempting the generation again

### Requirement: Backward-compatible migration
The system SHALL preserve existing local projects, transcript-backed references, and current rendering behavior during migration to the new runtime.

#### Scenario: existing projects remain usable after runtime migration
- **WHEN** a user opens a project created before the new runtime is introduced
- **THEN** existing chat history, generated assets, and reference images still render correctly
- **AND** compatibility adapters map older transcript-derived context into the new runtime without destructive data loss

#### Scenario: legacy transcript references still resolve during migration
- **WHEN** a job depends on references that were previously only discoverable from chat history
- **THEN** the runtime can resolve those references through compatibility logic until explicit artifact records exist
- **AND** the migration path does not require users to recreate those references manually

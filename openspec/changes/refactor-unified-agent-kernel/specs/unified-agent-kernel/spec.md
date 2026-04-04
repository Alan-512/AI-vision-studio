## ADDED Requirements

### Requirement: Unified Agent Kernel Owns Chat And Generation Execution
The system SHALL expose a single agent kernel that owns chat turn progression, tool-call execution progression, tool-result reinjection, `TurnRuntimeState`, and `AgentJob` mutation for the AI image-generation workspace.

#### Scenario: A chat request triggers image generation
- **WHEN** the user submits a prompt in the AI chat image-generation surface
- **THEN** the surface submits a kernel command rather than directly starting a generation flow
- **AND** the kernel decides the resulting tool calls and `AgentJob` transition

#### Scenario: Review and requires-action stay in the same execution graph
- **WHEN** a generated asset must be reviewed or requires user confirmation
- **THEN** the kernel progresses the same execution graph through review and resolution states
- **AND** the surface does not start a separate runtime pipeline for those states

### Requirement: Execution Truth Is Split Between Turn State And Persisted Jobs
The system SHALL distinguish ephemeral turn execution from persisted recoverable execution so that not every chat turn becomes a job, but every recoverable generation lifecycle still has one persisted truth source.

#### Scenario: A text-only assistant turn completes without starting generation
- **WHEN** the assistant answers without creating recoverable work
- **THEN** the kernel updates `TurnRuntimeState`
- **AND** no new `AgentJob` is required

#### Scenario: A generation or review lifecycle becomes recoverable
- **WHEN** a turn enters long-running generation, review, requires-action wait, cancel, retry, or resume semantics
- **THEN** the kernel creates or advances a persisted `AgentJob`
- **AND** that job is the recovery truth for the lifecycle

### Requirement: Toolbox Execution Is Normalized Through One Dispatcher
The system SHALL execute callable capabilities through one toolbox dispatcher contract so that chat tools, memory tools, generation tools, and review-related tools share one normalized execution boundary.

#### Scenario: A tool call is emitted by the model
- **WHEN** the planner/model emits one or more tool calls
- **THEN** the toolbox validates and dispatches those calls through a normalized registry
- **AND** the kernel receives normalized tool results regardless of the underlying provider

#### Scenario: Internal and external tools coexist
- **WHEN** the system mixes local tools such as memory updates with provider-backed tools such as image generation
- **THEN** both kinds of tools pass through the same dispatcher boundary
- **AND** write-model mutation remains kernel-owned

#### Scenario: Tool classes have different execution semantics
- **WHEN** the dispatcher handles `interactive_tool`, `job_tool`, and `kernel_step` entries
- **THEN** it preserves distinct execution semantics for each class
- **AND** only `interactive_tool` results are blindly reinjected as same-turn tool responses
- **AND** `job_tool` and `kernel_step` outcomes are normalized into kernel-owned transition results

### Requirement: Sequence Generation Uses Distinct Single-Image Tool Calls
The system SHALL treat multi-frame or storyboard generation as a sequence of distinct tool executions rather than one repeated multi-image request shape.

#### Scenario: User requests four continuous frames
- **WHEN** the user asks for four continuous but distinct frames based on shared references
- **THEN** the kernel/toolbox path produces four distinct generation executions
- **AND** each execution uses `numberOfImages = 1`
- **AND** prompt or frame instructions differ across the four executions

#### Scenario: User requests simple variations of the same frame
- **WHEN** the user asks for multiple variations of the exact same composition
- **THEN** the toolbox may allow a single tool call with `numberOfImages > 1`
- **AND** this is not treated as a storyboard or sequence workflow

### Requirement: Surface Layers Are Adapter-Only
The system SHALL keep `App.tsx`, `ChatInterface.tsx`, and similar UI layers limited to command submission, projection subscription, and local display-only state.

#### Scenario: Surface reacts to runtime progress
- **WHEN** jobs advance through queued, running, review, requires-action, completed, or failed states
- **THEN** the surface updates from kernel-owned projections
- **AND** the surface does not reconstruct lifecycle mutation logic locally

#### Scenario: User cancels or resumes work
- **WHEN** the user cancels a job, resumes a blocked job, or dismisses a task view
- **THEN** the surface emits an explicit command or projection intent
- **AND** the kernel or projection layer decides the outcome according to ownership rules

### Requirement: Recovery Rebuilds Projections From Write Models
The system SHALL rebuild recoverable read models from kernel-owned write models during startup and refresh recovery.

#### Scenario: The app reloads while jobs exist
- **WHEN** the app starts and persisted jobs or assets already exist
- **THEN** the kernel repairs interrupted jobs according to recovery rules
- **AND** task views and asset visibility projections are rebuilt from the repaired write model state
- **AND** any persisted projection cache is treated only as an optimization

#### Scenario: Transcript and task cleanup stay outside execution truth
- **WHEN** the user dismisses a completed task view or clears read-only surface state
- **THEN** the projection layer handles the cleanup without mutating execution truth
- **AND** the kernel command set remains limited to domain mutations

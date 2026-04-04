# Unified Agent Kernel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current split chat-generation runtime stack with one unified agent kernel that owns turn execution, tool dispatch semantics, recoverable job mutation, and projection rebuilding for the AI image-generation workspace.

**Architecture:** Introduce a kernel-centered execution model with two write models: ephemeral `TurnRuntimeState` for chat turns and durable `AgentJob` for recoverable generation/review lifecycles. Route all model-emitted capabilities through one normalized toolbox contract with explicit tool classes, then rebuild transcript/task/asset projections from write models instead of letting UI or projection caches drive lifecycle state.

**Tech Stack:** React, TypeScript, Gemini/Veo provider adapters, OpenSpec, Vitest

---

## File Structure

### New or Expanded Runtime Units
- Create or expand: `services/agentKernel.ts`
  - Unified kernel entrypoint and command dispatcher.
- Create or expand: `services/agentKernelTypes.ts`
  - Canonical command/result/event/tool contracts.
- Create or expand: `services/toolboxRuntime.ts`
  - Unified tool registry, classification, validation, execution policy.
- Create or expand: `services/turnRuntimeState.ts`
  - Ephemeral write-model contract and helpers.
- Create or expand: `services/jobTransitionRuntime.ts`
  - Durable `AgentJob` transition helpers moved out of page/runtime fragments.
- Create or expand: `services/projectionRecoveryRuntime.ts`
  - Rebuild task/asset/transcript projections from write models on startup/recovery.
- Create or expand: `services/toolPermissionRuntime.ts`
  - Central policy checks for capability execution and deny paths.

### Existing Files To Migrate Behind The Kernel
- Modify: `services/chatAgentRuntime.ts`
- Modify: `services/chatSendRuntime.ts`
- Modify: `services/chatStreamingRuntime.ts`
- Modify: `services/chatResponseRuntime.ts`
- Modify: `services/chatDeferredToolRuntime.ts`
- Modify: `services/chatInstructionRuntime.ts`
- Modify: `services/generationTaskFlowRuntime.ts`
- Modify: `services/generationTaskSessionRuntime.ts`
- Modify: `services/generationTaskLaunchController.ts`
- Modify: `services/generationExecutionRuntime.ts`
- Modify: `services/generationReviewRuntime.ts`
- Modify: `services/generationResolutionRuntime.ts`
- Modify: `services/generationFailureRuntime.ts`
- Modify: `services/generationAutoRevisionRuntime.ts`
- Modify: `services/generationTaskRuntime.ts`
- Modify: `services/agentRuntime.ts`
- Modify: `services/geminiService.ts`
- Modify: `services/geminiMediaRuntime.ts`
- Modify: `services/internalToolRuntime.ts`
- Modify: `services/searchFactsRuntime.ts`
- Modify: `services/searchPhaseRuntime.ts`
- Modify: `services/taskReadModel.ts`
- Modify: `services/taskProjectionPersistence.ts`
- Modify: `services/appGenerationRuntime.ts`
- Modify: `services/appGenerationRequestRuntime.ts`
- Modify: `services/appGenerationPreflightRuntime.ts`
- Modify: `services/appGenerationTaskFlowDepsRuntime.ts`
- Modify: `services/appInitializationRuntime.ts`
- Modify: `services/appRequiresActionRuntime.ts`
- Modify: `services/appTaskViewRuntime.ts`

### Surface Adapters That Should End Up Thin
- Modify: `App.tsx`
- Modify: `components/ChatInterface.tsx`
- Modify: `components/TaskCenter.tsx`

### Persistence / State Contracts
- Modify: `types.ts`
- Modify: `services/agentJobPersistence.ts`
- Modify: `services/storageService.ts`

### Spec / Architecture Docs
- Modify: `openspec/changes/refactor-unified-agent-kernel/tasks.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/unified-agent-kernel-diagram.html`

### Tests
- Create or expand:
  - `tests/agentKernel.test.ts`
  - `tests/toolboxRuntime.test.ts`
  - `tests/turnRuntimeState.test.ts`
  - `tests/jobTransitionRuntime.test.ts`
  - `tests/projectionRecoveryRuntime.test.ts`
  - `tests/toolPermissionRuntime.test.ts`
- Modify:
  - `tests/chatSendRuntime.test.ts`
  - `tests/chatAgentRuntime.test.ts`
  - `tests/chatStreamingRuntime.test.ts`
  - `tests/generationTaskFlowRuntime.test.ts`
  - `tests/generationExecutionRuntime.test.ts`
  - `tests/generationReviewRuntime.test.ts`
  - `tests/generationResolutionRuntime.test.ts`
  - `tests/generationFailureRuntime.test.ts`
  - `tests/generationAutoRevisionRuntime.test.ts`
  - `tests/appGenerationRuntime.test.ts`
  - `tests/appGenerationRequestRuntime.test.ts`
  - `tests/appInitializationRuntime.test.ts`
  - `tests/appRequiresActionRuntime.test.ts`
  - `tests/taskReadModel.test.ts`
  - `tests/taskProjectionPersistence.test.ts`
  - `tests/geminiService.test.ts`

## Task 1: Define Canonical Kernel Contracts

**Files:**
- Create: `services/agentKernelTypes.ts`
- Create: `services/turnRuntimeState.ts`
- Modify: `types.ts`
- Test: `tests/turnRuntimeState.test.ts`

- [ ] **Step 1: Write failing tests for turn write-model semantics**

Cover:
- text-only turn remains in `TurnRuntimeState`
- recoverable generation creates `AgentJob`
- `TurnRuntimeState.activeJobId` references but does not replace durable job truth

Run: `npm run test:run -- tests/turnRuntimeState.test.ts`
Expected: FAIL because the new contracts do not exist yet.

- [ ] **Step 2: Define canonical contracts**

Add explicit TypeScript contracts for:
- `KernelCommand`
- `KernelToolCall`
- `KernelToolResultRaw`
- `KernelToolResultNormalized`
- `KernelTransitionEvent`
- `TurnRuntimeState`
- `ToolClass`
- `ApprovalRequest` / `ApprovalResolution`

Keep `DismissTaskView` and `ClearCompletedTaskViews` out of kernel commands.

- [ ] **Step 3: Implement minimal turn-state helpers**

Implement helpers for:
- creating a new turn
- attaching planned tool calls
- recording tool-result reinjection state
- marking a turn complete or failed without creating a job

- [ ] **Step 4: Run targeted tests**

Run: `npm run test:run -- tests/turnRuntimeState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agentKernelTypes.ts services/turnRuntimeState.ts types.ts tests/turnRuntimeState.test.ts
git commit -m "refactor: define unified kernel contracts"
```

## Task 2: Introduce AgentKernel And Toolbox Runtime

**Files:**
- Create: `services/agentKernel.ts`
- Create: `services/toolboxRuntime.ts`
- Create: `services/toolPermissionRuntime.ts`
- Modify: `services/internalToolRuntime.ts`
- Modify: `services/geminiMediaRuntime.ts`
- Modify: `services/geminiService.ts`
- Test: `tests/agentKernel.test.ts`
- Test: `tests/toolboxRuntime.test.ts`
- Test: `tests/toolPermissionRuntime.test.ts`

- [ ] **Step 1: Write failing tests for kernel loop and tool classes**

Cover:
- `interactive_tool` is reinjected into the same turn
- `job_tool` returns a normalized `JobTransitionResult`
- `kernel_step` is not treated as a generic user-visible tool
- permission deny does not bypass the kernel

Run:
- `npm run test:run -- tests/agentKernel.test.ts`
- `npm run test:run -- tests/toolboxRuntime.test.ts`
- `npm run test:run -- tests/toolPermissionRuntime.test.ts`

Expected: FAIL

- [ ] **Step 2: Implement toolbox registry and classification**

Registry responsibilities only:
- tool catalog
- class lookup
- validation
- dispatch

Do not put write-model mutation inside the toolbox.

- [ ] **Step 3: Implement permission policy runtime**

Define one evaluation path for:
- capability allow
- deny
- timeout
- unavailable

Return normalized deny/error results for kernel handling.

- [ ] **Step 4: Implement kernel loop skeleton**

Support:
- `SubmitUserTurn`
- `ExecuteToolCalls`
- normalized tool result handling
- event emission

The kernel should decide:
- reinject
- create/advance job
- raise approval
- complete turn

- [ ] **Step 5: Route existing runtimes through the toolbox boundary**

Use compatibility adapters so current Gemini and internal tool runtimes can be invoked without rewriting providers yet.

- [ ] **Step 6: Run targeted tests**

Run:
- `npm run test:run -- tests/agentKernel.test.ts tests/toolboxRuntime.test.ts tests/toolPermissionRuntime.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/agentKernel.ts services/toolboxRuntime.ts services/toolPermissionRuntime.ts services/internalToolRuntime.ts services/geminiMediaRuntime.ts services/geminiService.ts tests/agentKernel.test.ts tests/toolboxRuntime.test.ts tests/toolPermissionRuntime.test.ts
git commit -m "refactor: add unified kernel and toolbox runtime"
```

## Task 3: Move Durable Job Mutation Behind Kernel-Owned Transitions

**Files:**
- Create: `services/jobTransitionRuntime.ts`
- Modify: `services/agentRuntime.ts`
- Modify: `services/generationExecutionRuntime.ts`
- Modify: `services/generationReviewRuntime.ts`
- Modify: `services/generationResolutionRuntime.ts`
- Modify: `services/generationFailureRuntime.ts`
- Modify: `services/generationAutoRevisionRuntime.ts`
- Modify: `services/generationTaskRuntime.ts`
- Test: `tests/jobTransitionRuntime.test.ts`
- Test: `tests/generationExecutionRuntime.test.ts`
- Test: `tests/generationReviewRuntime.test.ts`
- Test: `tests/generationResolutionRuntime.test.ts`
- Test: `tests/generationFailureRuntime.test.ts`
- Test: `tests/generationAutoRevisionRuntime.test.ts`

- [ ] **Step 1: Write failing tests for kernel-owned job mutation**

Cover:
- generation queued -> running -> reviewing -> completed
- requires-action and keep-current
- auto-revise second-review path
- cancel / retry / resume

Expected: current code still mutates through layered controllers and helpers.

- [ ] **Step 2: Move transition ownership into `jobTransitionRuntime`**

This unit should own:
- snapshot construction
- legal transition validation
- partial success rules
- failure classification for durable jobs

It should not own:
- provider calls
- UI projections

- [ ] **Step 3: Refactor generation runtimes to consume transition results**

Change these files so they produce or consume:
- `JobTransitionResult`
- `KernelTransitionEvent`

They should stop constructing final `AgentJob` snapshots directly.

- [ ] **Step 4: Make `generationTaskRuntime` a projection/persistence adapter only**

Its role should reduce to:
- persist job snapshot decided by kernel
- persist assets
- update/dismiss derived task views

- [ ] **Step 5: Run targeted tests**

Run:
- `npm run test:run -- tests/jobTransitionRuntime.test.ts tests/generationExecutionRuntime.test.ts tests/generationReviewRuntime.test.ts tests/generationResolutionRuntime.test.ts tests/generationFailureRuntime.test.ts tests/generationAutoRevisionRuntime.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/jobTransitionRuntime.ts services/agentRuntime.ts services/generationExecutionRuntime.ts services/generationReviewRuntime.ts services/generationResolutionRuntime.ts services/generationFailureRuntime.ts services/generationAutoRevisionRuntime.ts services/generationTaskRuntime.ts tests/jobTransitionRuntime.test.ts tests/generationExecutionRuntime.test.ts tests/generationReviewRuntime.test.ts tests/generationResolutionRuntime.test.ts tests/generationFailureRuntime.test.ts tests/generationAutoRevisionRuntime.test.ts
git commit -m "refactor: move durable job transitions into kernel runtime"
```

## Task 4: Rebuild Recovery And Projections From Write Models

**Files:**
- Create: `services/projectionRecoveryRuntime.ts`
- Modify: `services/taskReadModel.ts`
- Modify: `services/taskProjectionPersistence.ts`
- Modify: `services/appInitializationRuntime.ts`
- Modify: `services/storageService.ts`
- Modify: `services/agentJobPersistence.ts`
- Test: `tests/projectionRecoveryRuntime.test.ts`
- Test: `tests/taskReadModel.test.ts`
- Test: `tests/taskProjectionPersistence.test.ts`
- Test: `tests/appInitializationRuntime.test.ts`

- [ ] **Step 1: Write failing tests for startup recovery**

Cover:
- interrupted job repair on startup
- task views rebuilt from job snapshots
- stale projection cache ignored or reconciled as optimization only
- transcript preserved without driving lifecycle mutation

- [ ] **Step 2: Implement projection recovery runtime**

Explicit startup order:
1. load jobs/assets/transcript
2. repair interrupted jobs
3. rebuild task/asset projections
4. reconcile optional projection cache

- [ ] **Step 3: Remove any remaining projection-led lifecycle assumptions**

Ensure:
- projection deletion is harmless
- projection persistence never decides transition outcome
- storage remains passive

- [ ] **Step 4: Run targeted tests**

Run:
- `npm run test:run -- tests/projectionRecoveryRuntime.test.ts tests/taskReadModel.test.ts tests/taskProjectionPersistence.test.ts tests/appInitializationRuntime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/projectionRecoveryRuntime.ts services/taskReadModel.ts services/taskProjectionPersistence.ts services/appInitializationRuntime.ts services/storageService.ts services/agentJobPersistence.ts tests/projectionRecoveryRuntime.test.ts tests/taskReadModel.test.ts tests/taskProjectionPersistence.test.ts tests/appInitializationRuntime.test.ts
git commit -m "refactor: rebuild projections from write models"
```

## Task 5: Make Sequence Generation A First-Class Tool Workflow

**Files:**
- Modify: `services/toolboxRuntime.ts`
- Modify: `services/appGenerationRequestRuntime.ts`
- Modify: `services/chatToolCallRuntime.ts`
- Modify: `services/chatSendRuntime.ts`
- Modify: `services/generationTaskFlowRuntime.ts`
- Test: `tests/toolboxRuntime.test.ts`
- Test: `tests/appGenerationRequestRuntime.test.ts`
- Test: `tests/chatToolCallRuntime.test.ts`
- Test: `tests/generationTaskFlowRuntime.test.ts`

- [ ] **Step 1: Write failing tests for sequence validation**

Cover:
- four-frame sequence produces four distinct tool calls
- each call has `numberOfImages = 1`
- prompts differ per frame beat
- simple variation requests may still use `numberOfImages > 1`

- [ ] **Step 2: Add sequence/storyboard validation in toolbox**

Validation rules:
- reject or rewrite invalid multi-frame job-tool requests
- shared references may repeat
- frame prompts must not collapse to the same generic prompt

- [ ] **Step 3: Route chat-generated sequence requests through the unified contract**

Ensure the chat surface and generation request path no longer independently fan out semantics outside the kernel/toolbox boundary.

- [ ] **Step 4: Run targeted tests**

Run:
- `npm run test:run -- tests/toolboxRuntime.test.ts tests/appGenerationRequestRuntime.test.ts tests/chatToolCallRuntime.test.ts tests/generationTaskFlowRuntime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/toolboxRuntime.ts services/appGenerationRequestRuntime.ts services/chatToolCallRuntime.ts services/chatSendRuntime.ts services/generationTaskFlowRuntime.ts tests/toolboxRuntime.test.ts tests/appGenerationRequestRuntime.test.ts tests/chatToolCallRuntime.test.ts tests/generationTaskFlowRuntime.test.ts
git commit -m "refactor: enforce sequence generation through toolbox"
```

## Task 6: Demote App And Chat Surfaces To Thin Adapters

**Files:**
- Modify: `App.tsx`
- Modify: `components/ChatInterface.tsx`
- Modify: `components/TaskCenter.tsx`
- Modify: `services/appGenerationRuntime.ts`
- Modify: `services/appGenerationPreflightRuntime.ts`
- Modify: `services/appGenerationRequestRuntime.ts`
- Modify: `services/appGenerationTaskFlowDepsRuntime.ts`
- Modify: `services/appRequiresActionRuntime.ts`
- Modify: `services/appTaskViewRuntime.ts`
- Modify: `services/chatSendRuntime.ts`
- Modify: `services/chatSurfaceController.ts`
- Modify: `services/chatAgentRuntime.ts`
- Test: `tests/appGenerationRuntime.test.ts`
- Test: `tests/appRequiresActionRuntime.test.ts`
- Test: `tests/appTaskViewRuntime.test.ts`
- Test: `tests/chatSendRuntime.test.ts`
- Test: `tests/chatAgentRuntime.test.ts`
- Test: `tests/chatSurfaceController.test.ts`

- [ ] **Step 1: Write failing tests that assert adapter-only behavior**

Cover:
- `App.tsx` submits commands and subscribes to projections, but does not reconstruct lifecycle transitions
- `ChatInterface.tsx` submits chat commands and renders runtime output, but does not own execution state machine logic
- `TaskCenter` only emits projection intents

- [ ] **Step 2: Move remaining page-level orchestration behind app/chat runtimes**

Specific targets:
- `handleGenerate`
- `handleKeepCurrentAction`
- chat send / stop / action-card apply-dismiss flows

- [ ] **Step 3: Remove direct page ownership of lifecycle branching**

The surface layer should not:
- call provider runtimes directly
- decide retry/cancel/review transitions
- mutate job snapshots

- [ ] **Step 4: Run targeted tests**

Run:
- `npm run test:run -- tests/appGenerationRuntime.test.ts tests/appRequiresActionRuntime.test.ts tests/appTaskViewRuntime.test.ts tests/chatSendRuntime.test.ts tests/chatAgentRuntime.test.ts tests/chatSurfaceController.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App.tsx components/ChatInterface.tsx components/TaskCenter.tsx services/appGenerationRuntime.ts services/appGenerationPreflightRuntime.ts services/appGenerationRequestRuntime.ts services/appGenerationTaskFlowDepsRuntime.ts services/appRequiresActionRuntime.ts services/appTaskViewRuntime.ts services/chatSendRuntime.ts services/chatSurfaceController.ts services/chatAgentRuntime.ts tests/appGenerationRuntime.test.ts tests/appRequiresActionRuntime.test.ts tests/appTaskViewRuntime.test.ts tests/chatSendRuntime.test.ts tests/chatAgentRuntime.test.ts tests/chatSurfaceController.test.ts
git commit -m "refactor: demote app and chat surfaces to adapters"
```

## Task 7: Verification, Docs, And Cutover Closure

**Files:**
- Modify: `openspec/changes/refactor-unified-agent-kernel/tasks.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/unified-agent-kernel-diagram.html`

- [ ] **Step 1: Update architecture docs and OpenSpec checklist**

Document:
- final kernel/toolbox/provider boundaries
- state table
- failure paths
- permission table
- cutover and rollback notes discovered during implementation

- [ ] **Step 2: Run focused kernel migration suite**

Run:
- `npm run test:run -- tests/agentKernel.test.ts tests/toolboxRuntime.test.ts tests/jobTransitionRuntime.test.ts tests/projectionRecoveryRuntime.test.ts tests/turnRuntimeState.test.ts`

Expected: PASS

- [ ] **Step 3: Run full repository test suite**

Run:
- `npm run test:run`

Expected: PASS

- [ ] **Step 4: Run build and OpenSpec validation**

Run:
- `npm run build`
- `openspec validate refactor-unified-agent-kernel --strict`

Expected:
- build passes
- OpenSpec passes
- only known non-blocking warnings remain, if any

- [ ] **Step 5: Commit**

```bash
git add openspec/changes/refactor-unified-agent-kernel/tasks.md docs/architecture/README.md docs/architecture/unified-agent-kernel-diagram.html
git commit -m "docs: finalize unified agent kernel migration"
```

## Cutover Rules

- Phase 1 cutover:
  - Kernel façade handles chat send path
  - Rollback: restore current V3 controller wiring
- Phase 2 cutover:
  - All model-emitted tool calls go through unified toolbox
  - Rollback: restore deferred tool dispatch + existing generation adapters
- Phase 3 cutover:
  - `AgentJob` mutation originates only from kernel transition runtime
  - Rollback: keep compatibility wrappers around V3 generation services until parity is proven
- Phase 4 cutover:
  - `App.tsx` and `ChatInterface.tsx` become adapter-only
  - Rollback: revert composition-root wiring, not storage schema

## Out Of Scope

- multi-agent / subagent orchestration
- new UI redesign
- event sourcing
- full provider replacement beyond adapter boundaries

## Success Criteria

- One kernel owns turn execution and recoverable job mutation.
- One toolbox contract owns tool classification and dispatch.
- Sequence generation semantics are enforced before provider execution.
- Projections are rebuildable from write models.
- `App.tsx` and `ChatInterface.tsx` no longer own lifecycle branching.
- Full tests, build, and OpenSpec validation pass.

## 1. Kernel Contract
- [ ] 1.1 Define the unified `AgentKernel` command contract for user turns, generation, review, requires-action resolution, resume, and cancel
- [ ] 1.2 Define the split write-model contract between `TurnRuntimeState` and persisted `AgentJob`
- [ ] 1.3 Define the kernel result/event contract, including tool-call planning, tool completion, job transition, and projection updates
- [ ] 1.4 Define the normalized toolbox contract and tool classes (`interactive_tool`, `job_tool`, `kernel_step`)

## 2. Runtime Ownership Migration
- [ ] 2.1 Move `AgentJob` mutation ownership behind the unified kernel instead of page/controller-level flow services
- [ ] 2.2 Recast generation, review, auto-revision, and requires-action paths as kernel-owned transitions or tool results
- [ ] 2.3 Move retry, cancel, and resume semantics into kernel-owned command handling

## 3. Toolbox Unification
- [ ] 3.1 Normalize chat tools, memory tools, generation tools, and critic/review tools under one dispatcher
- [ ] 3.2 Ensure tool-result reinjection follows one shared loop contract rather than separate chat and generation harnesses
- [ ] 3.3 Add validation that sequence/storyboard requests produce multiple distinct tool calls with `numberOfImages = 1`

## 4. Surface Simplification
- [ ] 4.1 Reduce `ChatInterface.tsx` to a surface adapter over kernel state and surface-only UI state
- [ ] 4.2 Reduce `App.tsx` to composition, command submission, and projection subscription
- [ ] 4.3 Preserve `BackgroundTaskView`, asset lists, and transcript as derived projections only
- [ ] 4.4 Keep `DismissTaskView` and `ClearCompletedTaskViews` in the projection layer rather than the kernel command set

## 5. Migration Safety
- [ ] 5.1 Add compatibility adapters so existing persisted jobs/projects remain readable during migration
- [ ] 5.2 Fix the read-model recovery strategy so startup rebuilds projections from write models rather than trusting projection caches
- [ ] 5.3 Define cutover and rollback boundaries between the current V3 runtime slices and the unified kernel
- [ ] 5.4 Update OpenSpec/runtime docs so future work targets the unified kernel rather than the old split runtime model

## 6. Verification
- [ ] 6.1 Add kernel-level tests for user turn -> tool call -> tool result reinjection -> job transition flows
- [ ] 6.2 Add sequence-generation tests that prove four-frame requests emit four distinct single-image tool executions
- [ ] 6.3 Run full test/build/openspec validation before closing the migration

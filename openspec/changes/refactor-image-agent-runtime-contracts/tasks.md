## 1. Runtime Contract Skeleton
- [x] 1.1 Add shared command and transition-result types for image-agent runtime control flow
- [x] 1.2 Keep persistence helpers scoped to save/query responsibilities only

## 2. Task Read Model
- [x] 2.1 Introduce `BackgroundTaskView` semantics and helpers for deriving task-view behavior from runtime state
- [x] 2.2 Add explicit task-center intents that distinguish `CancelJob` from `DismissTaskView`
- [x] 2.3 Preserve current UI behavior through compatibility aliases until later phases remove dual-write paths

## 3. Surface Integration
- [x] 3.1 Update `TaskCenter` to emit explicit intents rather than a single overloaded remove callback
- [x] 3.2 Update `App.tsx` to route cancel and dismiss paths separately without reintroducing hidden lifecycle ownership

## 4. Projection And Persistence Adapters
- [x] 4.1 Add task-view projection planners and persistence adapters so task state is derived from `AgentJob`
- [x] 4.2 Route task-view dismissal, clear-completed, and visible-complete flows through explicit projection controllers
- [x] 4.3 Add `AgentJob` snapshot persistence adapters so page code no longer writes `saveAgentJob(...)` directly

## 5. Generation Runtime Decomposition
- [x] 5.1 Extract generation launch/session/runtime/controller layers from `App.tsx`
- [x] 5.2 Extract generation execution, primary review, auto-revision, resolution, and failure runtimes
- [x] 5.3 Move the bulk of `launchTask` flow wiring out of `App.tsx` into reusable runtime services
- [x] 5.4 Move app-specific generation flow dependency construction into a dedicated runtime builder

## 6. Chat Surface Runtime Decomposition
- [x] 6.1 Extract chat agent machine/controller/store helpers from `ChatInterface.tsx`
- [x] 6.2 Add a hook-based runtime controller so the component no longer owns machine reset/execution details directly
- [x] 6.3 Extract chat streaming turn orchestration from `ChatInterface.tsx` into dedicated chat runtime helpers
- [x] 6.4 Remove any remaining duplicate runtime ownership between `ChatInterface.tsx` and shared chat runtimes

## 7. Gemini Service Decomposition
- [x] 7.1 Extract critic context/review helpers out of `geminiService.ts`
- [x] 7.2 Extract search facts, search phase, internal tool loop, chat content conversion, and tool declarations into dedicated runtimes
- [x] 7.3 Extract stream loop, deferred tool execution, rolling summary updates, and instruction/config assembly into dedicated chat runtimes
- [x] 7.4 Reduce `geminiService.ts` to a thin facade over provider execution and public API entrypoints

## 8. Ownership Finalization
- [x] 8.1 Make the runtime kernel the single owner of `AgentJob` mutation decisions across image generation flows
- [x] 8.2 Remove any remaining page-level orchestration that still reconstructs runtime ownership in `App.tsx`

## 9. Verification
- [x] 9.1 Add unit tests for task read-model derivation and task-center intent classification
- [x] 9.2 Add unit tests for new generation/chat/gemini runtime services introduced during the refactor
- [x] 9.3 Run targeted runtime/task/chat/gemini test suites during the refactor
- [x] 9.4 Run the project build against the current implementation slices
- [x] 9.5 Run final full validation after the remaining ownership tasks are completed

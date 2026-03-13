## 1. Critic Taxonomy
- [x] 1.1 Define shared types for critic issues, severity, confidence, auto-fix eligibility, and referenced constraints
- [x] 1.2 Choose the initial issue taxonomy used by the runtime, keeping it intentionally small and action-relevant
- [x] 1.3 Decide how critic output is persisted on jobs and/or artifacts without breaking the current runtime schema

## 2. Revision Planning
- [x] 2.1 Define a first-class `RevisionPlan` / `FollowUpPlan` model linked to the active job and artifact
- [x] 2.2 Record preserve targets, adjust targets, hard constraints, preferred continuity signals, and execution mode in the plan
- [x] 2.3 Route review outcomes through the new plan model before any auto-revise or requires-action path executes

## 3. Guided User Actions
- [ ] 3.1 Expand `requires_action` into richer typed actions tied to the active plan, job, and artifact
- [ ] 3.2 Update action-card rendering so it can present different action sets without exposing raw prompts
- [ ] 3.3 Keep the chat-first UX by only surfacing user actions when the runtime actually needs a decision or missing input

## 4. Consistency and Constraint Handling
- [x] 4.1 Define a consistency profile for follow-up image jobs, covering subject, composition, lighting, style, and other continuity signals
- [x] 4.2 Persist search facts and reference-derived requirements as explicit runtime constraints that critic and planner can inspect
- [x] 4.3 Use the consistency profile and constraints when producing follow-up revision plans for multi-turn image edits

## 5. Verification
- [x] 5.1 Add tests for critic issue classification and structured revision-plan generation
- [x] 5.2 Add tests for plan-driven `requires_action` states and richer action selection paths
- [ ] 5.3 Add tests for consistency-aware follow-up edits and constraint preservation across multi-step jobs

## 6. Observability
- [x] 6.1 Persist internal review traces with critic decision, normalized decision, primary issue, and chosen action type
- [x] 6.2 Use traces to explain why `requires_action` was chosen over `auto_revise`

## Current Focus
- Start with critic taxonomy and revision-plan primitives before adding new user-facing actions.
- Keep later UX work small and plan-driven so the chat experience stays lightweight.

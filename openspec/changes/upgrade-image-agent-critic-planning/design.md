## Context
The completed `refactor-image-agent-runtime` change established the runtime foundation for image-agent execution: jobs, artifacts, structured tool results, review/revise loops, human-in-the-loop pauses, artifact-first reference selection, and compatibility layers. The system can now run a single image job across multiple steps without relying purely on transcript reconstruction.

What remains limited is the quality of the agent's decisions after generation. Review output is still relatively shallow. The runtime can decide whether to accept, auto-revise, or pause for user input, but it does not yet maintain a rich internal model of what is wrong, what should stay fixed, what should change first, and when the user needs to make a directional choice rather than confirm a generic continuation.

## Goals / Non-Goals
- Goals:
- Introduce structured critic output that categorizes result quality issues in a way the planner can consume directly
- Represent revision strategy as explicit runtime data rather than implicit prompt rewriting behavior
- Let human-in-the-loop pauses present meaningful actions that reflect the current plan, not generic confirmation
- Improve multi-turn image refinement by preserving subject, style, composition, and fact constraints intentionally
- Keep the existing chat-first UX while increasing decision quality behind the scenes

- Non-Goals:
- Do not redesign the overall chat layout or convert the product into a workflow builder
- Do not introduce a multi-agent swarm or separate planner / critic services in this change
- Do not require backend execution or server-side memory for normal BYOK use
- Do not attempt to solve video-planning quality in the same change

## Decisions
- Decision: Add a first-class critic taxonomy
  - Review output should no longer be limited to broad status buckets.
  - The runtime will produce structured issue records, for example `subject_mismatch`, `brand_incorrect`, `material_weak`, `needs_reference`, `composition_good_but_subject_wrong`, or `constraint_conflict`.
  - Each issue should include severity, confidence, whether it is auto-fixable, and which artifact or constraint it refers to.

- Decision: Add explicit revision planning
  - After review, the runtime should produce a `RevisionPlan` or `FollowUpPlan` linked to the active job and current artifact.
  - A plan should state what to preserve, what to adjust, how aggressive the change should be, what constraints must remain fixed, and whether the next step can be executed automatically.
  - `requires_action` should reference this plan rather than asking the user to interpret internal prompt text.

- Decision: Expand human-in-the-loop actions into typed workflow moves
  - Instead of only generic continue/dismiss patterns, the runtime should support actions such as:
    - continue focused refinement
    - keep current result
    - preserve composition only
    - tighten brand / subject match
    - choose between generated directions
    - upload or replace reference
    - clarify stylistic intent
  - Actions must be attached to a specific job, artifact, and plan so the user is continuing an existing task rather than starting over.

- Decision: Track consistency as an explicit profile
  - Multi-turn image work needs stronger continuity than a plain prompt loop can provide.
  - The runtime should maintain a consistency profile that captures what should remain stable across revisions, such as subject identity, product silhouette, composition, camera distance, lighting mood, typography treatment, or broader style cues.
  - Revision planning can then reference that profile when deciding what to preserve and what to change.

- Decision: Promote search and references into enforceable constraints
  - Search facts and user references should not only help with the next prompt; they should shape the critic and planner as persistent constraints.
  - The planner should be able to mark some constraints as hard requirements and others as stylistic preferences.
  - When a revision conflicts with a known brand, product, or reference constraint, the critic should surface that conflict explicitly.

- Decision: Roll out in capability phases
  - Phase 1: critic taxonomy and revision-plan data model
  - Phase 2: richer `requires_action` types and UI affordances
  - Phase 3: consistency profile and constraint-aware follow-up refinement
  - This keeps the next implementation steps incremental and testable.

## Alternatives Considered
- Continue enhancing the current review prompts without adding new runtime objects
  - Rejected because the improvement would remain implicit and hard to test, inspect, or resume across jobs.

- Build a fully separate planner agent and critic agent
  - Rejected for now because the current product can get most of the value from better structured state inside the existing runtime.

- Expose raw revised prompts directly to users as the main follow-up interface
  - Rejected because the product is intentionally chat-first and should optimize around user intent, not prompt engineering.

## Risks / Trade-offs
- More review structure means more runtime schema complexity
  - Mitigation: add only the fields needed by planner and UI decisions, and keep backward-compatible defaults

- Critic taxonomy can become too ambitious and hard to maintain
  - Mitigation: start with a constrained set of issue classes that directly influence planning and user actions

- Richer action types can create UI clutter if exposed too eagerly
  - Mitigation: keep the default UX chat-first and show only the small subset of actions justified by the active plan

- Consistency control can over-constrain creativity if treated as a hard lock everywhere
  - Mitigation: distinguish hard constraints from preferred continuity signals inside the plan

## Rollout Plan
1. Define critic issue types, revision plan types, and consistency profile types in the shared runtime model.
2. Update review generation so it emits structured critic output and a linked revision plan.
3. Teach the runtime to branch on the plan: auto-run safe refinements, or pause with typed user actions when direction is ambiguous.
4. Add richer action rendering in chat while preserving the current lightweight action-card footprint.
5. Persist consistency profiles and reuse them during follow-up image edits.
6. Expand tests to cover issue classification, plan generation, plan-driven pause states, and consistency-aware follow-up revisions.

## Open Questions
- Should revision plans be versioned as standalone artifacts, or embedded directly in job state with artifact references?
- Which consistency dimensions should be explicit in phase 1 versus deferred until real usage data appears?
- How much of the critic output should be shown to users verbatim versus summarized into product language?

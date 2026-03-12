# Change: Upgrade image agent critic, planning, and guided follow-up refinement

## Why
The current image-agent runtime now supports closed-loop generation, review, revision, artifact persistence, and human-in-the-loop pauses. That makes the system operationally sound, but it still behaves like a lightweight revision loop rather than a more capable creative agent. Review outcomes are narrow, revision planning is not yet a first-class runtime object, and follow-up user guidance is limited to a small set of generic actions.

The next capability jump should therefore focus on decision quality rather than more raw workflow plumbing. The image agent needs to understand what is wrong with the current result, decide how to fix it, preserve what is already good, and ask the user for focused decisions only when necessary.

## What Changes
- Introduce a structured critic taxonomy for image review, including issue types, severity, confidence, and auto-fix eligibility
- Add a first-class `RevisionPlan` / `FollowUpPlan` runtime object so review results lead to explicit planned edits instead of generic prompt rewrites
- Expand `requires_action` into richer action types that are tied to the active job and artifact, such as continuing a focused refinement, choosing between directions, preserving composition, or requesting a new reference
- Add consistency profiles for follow-up image edits so the agent can intentionally preserve subject identity, composition, lighting, and style across multi-turn image jobs
- Promote search and reference outputs from passive context to explicit runtime constraints that the critic and planner can honor during later revisions
- Roll the work out in phases so critic/planning primitives land first, then richer actions, then consistency and constraint-aware refinement

## Impact
- Affected specs: `image-agent-critic-planning`
- Affected code: `types.ts`, `App.tsx`, `components/ChatInterface.tsx`, `services/agentService.ts`, `services/geminiService.ts`, `services/agentRuntime.ts`, related tests

## ADDED Requirements

### Requirement: Structured critic output for image review
The system SHALL produce structured critic output after image review so the runtime can reason about what is wrong, what is acceptable, and what can be fixed automatically.

#### Scenario: critic identifies actionable issue types
- **WHEN** an image artifact is reviewed after generation or revision
- **THEN** the runtime records one or more structured issues with explicit types, severity, confidence, and auto-fix eligibility
- **AND** each issue references the relevant artifact, constraint, or follow-up dimension it applies to

#### Scenario: critic distinguishes fixable issues from directional ambiguity
- **WHEN** the review finds a problem that can be safely corrected without changing user intent
- **THEN** the critic marks the issue as compatible with automatic refinement
- **AND** the planner may continue without asking the user for a new decision
- **BUT WHEN** the review finds ambiguity about creative direction, missing references, or conflicting constraints
- **THEN** the critic marks the issue as requiring user guidance rather than silent auto-revision

### Requirement: Explicit revision plans drive follow-up work
The system SHALL produce an explicit revision plan from review output before auto-refining an image or pausing for user input.

#### Scenario: revision plan preserves what already works
- **WHEN** the critic determines that only part of the current result should change
- **THEN** the revision plan records preserve targets that should remain stable in the next iteration
- **AND** separately records adjust targets that should be improved or corrected
- **AND** the next execution step follows that plan rather than treating the entire image as an unconstrained retry

#### Scenario: revision plan captures execution mode
- **WHEN** the runtime creates a revision plan
- **THEN** the plan records whether the next step can be auto-executed, should pause for user choice, or requires additional reference material
- **AND** any `requires_action` state references that plan directly

### Requirement: Guided follow-up actions are plan-driven
The system SHALL expose human-in-the-loop actions that reflect the active revision plan and current artifact state.

#### Scenario: action card offers a focused continuation
- **WHEN** the revision plan can continue in a specific direction but requires user approval or choice
- **THEN** the action card presents plan-driven actions linked to the active job and artifact
- **AND** those actions describe the intended continuation in product language rather than exposing raw prompt text

#### Scenario: different plans yield different actions
- **WHEN** the planner determines that the next step depends on the kind of issue found
- **THEN** the runtime can offer different action sets such as preserving composition, tightening brand match, choosing between directions, or providing a reference
- **AND** the UI only surfaces actions justified by the active plan

### Requirement: Consistency-aware follow-up image refinement
The system SHALL preserve explicit continuity signals across multi-turn image jobs when the user intends iterative refinement rather than a fresh concept.

#### Scenario: follow-up edit preserves continuity profile
- **WHEN** the user asks to keep the current composition, subject, or visual identity while refining the image
- **THEN** the runtime records a consistency profile for the job or artifact lineage
- **AND** later revision plans can treat those continuity signals as preserve targets or hard constraints

#### Scenario: planner can change one dimension without drifting others
- **WHEN** the active plan only calls for a narrow adjustment such as brand match, material fidelity, or typography cleanup
- **THEN** the planner uses the consistency profile to avoid unnecessary drift in composition, lighting, and style

### Requirement: Search and reference constraints inform critic and planner
The system SHALL treat retrieved facts and user references as explicit runtime constraints that can influence review and follow-up planning.

#### Scenario: constraint conflicts are surfaced explicitly
- **WHEN** the generated image conflicts with persisted search facts, brand constraints, or user-provided reference requirements
- **THEN** the critic records that conflict as a structured issue
- **AND** the revision plan identifies whether the conflict is auto-fixable or requires user guidance

#### Scenario: persisted constraints carry into later revisions
- **WHEN** a job continues across multiple review and revision steps
- **THEN** search facts, reference-derived requirements, and continuity constraints remain available to later critic and planner steps
- **AND** the runtime does not rely on reparsing transcript prose to rediscover them

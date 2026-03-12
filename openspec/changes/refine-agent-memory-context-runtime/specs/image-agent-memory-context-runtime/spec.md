## ADDED Requirements

### Requirement: Consistent memory retrieval tool contract
The system SHALL expose a single, consistent tool contract for on-demand memory retrieval and use it coherently across prompts, function declarations, runtime execution, and tool-result handling.

#### Scenario: prompt layer and runtime use the same retrieval tool
- **WHEN** the model is instructed to load relevant long-term memory on demand
- **THEN** the prompt layer, declared tools, and runtime executor reference the same tool name and input schema
- **AND** the system does not rely on stale aliases or mismatched tool names for the same retrieval behavior

#### Scenario: retrieved memory is consumed in the same turn
- **WHEN** the model issues a memory retrieval tool call during a chat turn
- **THEN** the runtime executes the retrieval and returns the retrieved memory payload to the model within the same interaction loop
- **AND** the model can use that retrieved memory before deciding its next answer or action

### Requirement: Layered long-term memory access
The system SHALL separate lightweight always-on memory from detailed on-demand memory retrieval.

#### Scenario: lightweight durable memory is always available
- **WHEN** a new request is prepared for the model
- **THEN** the runtime may inject a small durable memory layer containing stable guardrails and high-value defaults
- **AND** that always-on layer remains constrained enough to avoid unnecessary prompt bloat

#### Scenario: detailed memory is loaded only when needed
- **WHEN** the model needs detailed prior preferences, project decisions, or historical creative patterns
- **THEN** the runtime retrieves that information through the explicit memory tool contract
- **AND** the system does not require every detailed memory item to be injected into every request by default

### Requirement: Rolling conversation summary for compacted short-term context
The system SHALL maintain a rolling summary of older conversation context so short-term context can be compacted without replaying the entire raw transcript.

#### Scenario: older turns are summarized while recent turns stay verbatim
- **WHEN** a conversation grows beyond the preferred direct replay window
- **THEN** the runtime preserves recent turns verbatim
- **AND** represents older relevant context through a maintained summary linked to a cursor or equivalent boundary

#### Scenario: summary updates are incremental
- **WHEN** new conversation turns are added after an existing summary has already been stored
- **THEN** the system updates the rolling summary incrementally rather than recomputing the entire conversation from scratch for every request

### Requirement: Clear source-of-truth boundaries for context layers
The system SHALL maintain explicit boundaries between transcript history, runtime artifacts, rolling summary state, and long-term memory.

#### Scenario: image/runtime truth remains outside the transcript
- **WHEN** the agent needs references, generated images, or retrieved search outputs for later reasoning
- **THEN** the runtime uses artifact/job records as the authoritative source
- **AND** transcript messages may summarize or preview those items without becoming their only source of truth

#### Scenario: memory and summary are not treated as the same layer
- **WHEN** the runtime builds a new model request
- **THEN** rolling summary text represents compressed short-term conversation state
- **AND** long-term memory represents durable user or project preferences
- **AND** the system avoids duplicating the same context across both layers unless a specific reason is recorded

### Requirement: Backward-compatible context migration
The system SHALL preserve existing projects, chat history, and stored memory documents while transitioning to the refined layered context runtime.

#### Scenario: existing memory docs remain usable
- **WHEN** a user opens an older project with existing global/project memory documents
- **THEN** those memory documents continue to load and participate in retrieval
- **AND** the new layered access strategy does not require users to recreate memory manually

#### Scenario: transcript-derived fallback remains available during migration
- **WHEN** required context is not yet available through summary or runtime artifact layers for an existing project
- **THEN** the runtime may fall back to transcript-derived behavior during migration
- **AND** the compatibility path remains explicit rather than silently overriding the layered design

## 1. Memory Tool Contract
- [x] 1.1 Standardize the on-demand memory retrieval tool name, schema, and runtime execution path
- [x] 1.2 Ensure retrieved memory results are fed back into the model within the same turn before final completion
- [x] 1.3 Remove prompt/runtime references to stale or mismatched memory tool names

## 2. Layered Long-Term Memory
- [x] 2.1 Define which memory fields remain in the lightweight always-on snippet
- [x] 2.2 Move detailed preference/history retrieval to explicit on-demand memory reads
- [x] 2.3 Keep global and project memory scoped separately while sharing a consistent retrieval interface

## 3. Rolling Short-Term Context
- [x] 3.1 Turn `contextSummary` into an actively maintained rolling summary with cursor tracking
- [x] 3.2 Use recent verbatim turns plus summarized older context when building model requests
- [ ] 3.3 Ensure image-history compaction, transcript compaction, and summary injection work together without losing key references

## 4. Source-of-Truth Boundaries
- [ ] 4.1 Document and enforce clear roles for transcript history, runtime artifacts, rolling summary state, and long-term memory
- [ ] 4.2 Keep compatibility fallbacks for existing projects while preferring the new layered context strategy
- [ ] 4.3 Avoid duplicating the same context across transcript replay, summary text, and memory snippets unless intentionally required

## 5. Verification
- [ ] 5.1 Add tests for memory retrieval tool execution and same-turn consumption
- [x] 5.2 Add tests for rolling summary updates and compacted request building
- [ ] 5.3 Validate compatibility behavior for existing projects, memory docs, and transcript-derived context

## Current Focus
- The memory retrieval contract, same-turn loop, always-on memory layer, and rolling-summary request compaction are now in place.
- Remaining work is focused on deeper verification plus explicit source-of-truth and compatibility hardening.

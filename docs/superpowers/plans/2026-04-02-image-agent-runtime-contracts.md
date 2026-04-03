# Image Agent Runtime Contracts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the first executable slice of the V3 runtime contract refactor by adding explicit runtime command/read-model contracts and splitting task-center cancel versus dismiss intent handling.

**Architecture:** Add shared contract types in `types.ts`, a focused helper layer for task read-model derivation and task-center intent classification, then wire `TaskCenter` and `App.tsx` to explicit intents without rewriting the whole generation runtime. Preserve compatibility by keeping the current task data shape available while moving semantics toward read-model naming.

**Tech Stack:** React 18, TypeScript, Vitest

---

### Task 1: Add failing tests for task read-model and explicit intents

**Files:**
- Create: `tests/taskReadModel.test.ts`
- Modify: `tests/requiresActionRuntime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('emits cancel intent for active task views and dismiss intent for terminal task views', () => {
  // expectations target the new helper layer
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/taskReadModel.test.ts`
Expected: FAIL because helper module/types do not exist yet

### Task 2: Add shared runtime contract and task read-model helpers

**Files:**
- Modify: `types.ts`
- Create: `services/taskReadModel.ts`

- [ ] **Step 1: Add command/read-model types**
- [ ] **Step 2: Implement minimal task read-model helpers**
- [ ] **Step 3: Run focused tests**

Run: `npm run test:run -- tests/taskReadModel.test.ts tests/requiresActionRuntime.test.ts`
Expected: PASS

### Task 3: Wire explicit task-center intents into the UI shell

**Files:**
- Modify: `components/TaskCenter.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Replace overloaded remove callback with explicit task intent callback**
- [ ] **Step 2: Route cancel and dismiss paths separately in `App.tsx`**
- [ ] **Step 3: Run focused tests and build**

Run: `npm run test:run -- tests/taskReadModel.test.ts tests/requiresActionRuntime.test.ts tests/storageService.test.ts`
Expected: PASS

Run: `npm run build`
Expected: exit 0

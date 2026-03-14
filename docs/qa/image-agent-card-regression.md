# Image Agent Card Regression Guide

## Purpose
This document is the handoff guide for browser-based QA of the image-agent action card flow in `ai-vision-studio`.

It is written for a second AI assistant or human tester who will operate the browser and verify whether the current image-agent review system behaves correctly.

The goal is not to test generic image generation quality. The goal is to validate whether the runtime makes good decisions about:

- when to accept a result directly
- when to auto-revise without bothering the user
- when to pause and show an action card
- whether the action card explanation matches the actual problem

## Background
The current image-agent flow is no longer a simple "generate once and show result" flow.

After an image is generated, the system now performs:

1. A structured AI critic review
2. A second calibration pass that specifically judges whether the user should be interrupted
3. Runtime normalization that decides one of:
   - `accept`
   - `auto_revise`
   - `requires_action`

If the result enters `requires_action`, the chat UI shows an inline action card.

The user-facing action surface intentionally remains simple:

- `继续优化` / `Continue`
- `保留当前结果` / `Keep Current`

The intelligence is in the decision logic behind the card, not in adding more visible buttons.

## What Has Already Been Implemented
The current system includes:

- structured critic issues such as `brand_incorrect`, `composition_weak`, `material_weak`, `needs_reference`, `constraint_conflict`
- revision plans with preserve targets and adjust targets
- revision strength:
  - `light`
  - `targeted`
  - `aggressive`
- quality signals:
  - `intentAlignment`
  - `compositionStrength`
  - `lightingQuality`
  - `materialFidelity`
  - `brandAccuracy`
  - `aestheticFinish`
  - `commercialReadiness`
- issue evidence and fix scope:
  - `local`
  - `subject`
  - `layout`
  - `global`
- action-card copy that can adapt to issue type without adding more buttons

## Important Testing Principle
Do not judge success only by "did a card appear".

A correct result may be:

- no card, because the image was accepted
- no card, because the system correctly auto-revised on its own
- a card, because the runtime correctly decided that the user truly needs to confirm direction

The key question is:

`Was the interruption justified?`

## Environment
Use a development build so review traces can be inspected.

Recommended setup:

```bash
npm run dev
```

Open the local app in the browser and use the image-generation assistant flow.

## Dev-Only Debug Help
In development, when an action card appears, there is a collapsible `Review Trace (Debug)` panel under the card.

Use it to inspect:

- `rawDecision`
- `finalDecision`
- `calibratedDecision`
- `actionType`
- `revisionStrength`
- `primaryIssue`
- `quality signals`
- `preserve / adjust`
- `issueTypes`

This panel should be used during QA to explain why the runtime made its decision.

## Pass / Fail Philosophy
The current target state is:

- do not interrupt the user for minor polish-only issues
- do not silently keep going when the next step would materially change direction
- do not over-revise already polished results
- do not accept results that still contain major subject / brand / layout problems

## Test Cases

### Case 1: High-Quality First Result
Purpose:
Verify that obviously good results do not trigger unnecessary cards or endless extra passes.

Suggested prompt:

```text
Create a premium minimalist product photo of a matte white perfume bottle on a white stone pedestal, soft window light, clean luxury background.
```

Expected behavior:

- generation succeeds
- no action card appears
- result should usually land on `accept`

What to verify:

- the system does not auto-revise just because of tiny imperfections
- `commercialReadiness` and `aestheticFinish` should be relatively high if trace is available

Failure examples:

- card appears with a weak reason
- system keeps revising a result that already looks production-ready

### Case 2: Brand Replacement While Preserving Composition
Purpose:
Verify that brand corrections are treated as sensitive and direction-aware.

Suggested flow:

1. Generate a clean product shot
2. Follow with:

```text
Keep the current composition, but change the product to a Red Bull can.
```

Expected behavior:

- if the correction is clear and safe, the system may `auto_revise`
- if the next step would materially affect brand direction, a card may appear

What to verify:

- if a card appears, the reason should be brand-specific
- card title/message should feel like confirming brand direction, not a generic continuation
- the system should not unnecessarily destroy composition

Failure examples:

- generic card text that does not mention brand direction
- large composition drift when only brand/product identity should change

### Case 3: Subject Wrong, Style Right
Purpose:
Verify that subject mismatch leads to stronger auto-correction, not random restart.

Suggested prompt:

```text
Create a premium studio shot of a white ceramic bottle with elegant soft light.
```

Then ask:

```text
Keep everything else, but the main object should be a slim aluminum can instead of a bottle.
```

Expected behavior:

- should usually go through `auto_revise`
- revision strength should be `aggressive` or strong enough to actually change subject identity

What to verify:

- the system fixes subject identity while preserving lighting/style
- it does not unnecessarily ask the user unless direction is genuinely ambiguous

Failure examples:

- repeated weak revisions that do not change the subject enough
- early `requires_action` even though the desired subject change is clear

### Case 4: Composition Weakness
Purpose:
Verify that layout problems are treated as layout problems, not as generic quality complaints.

Suggested prompt:

```text
Create a luxury poster-style product visual with strong negative space and clean composition.
```

Expected behavior:

- if the result is cramped, cropped too tight, or badly balanced, the critic should identify composition weakness
- if layout change is modest, the system may auto-revise
- if layout change is larger or affects composition scope, a card may appear

What to verify:

- `primaryIssue.type` should align with `composition_weak`
- `fixScope` should lean toward `layout`
- if a card appears, wording should reflect composition scope rather than generic optimization

Failure examples:

- composition issue misread as material issue
- system over-focuses on small polish instead of layout hierarchy

### Case 5: Material / Finish Weakness
Purpose:
Verify that material refinement is treated as a light or targeted improvement, not a full directional interruption.

Suggested prompt:

```text
Create a high-end product shot of a metallic can with crisp reflections and premium surface finish.
```

Expected behavior:

- if the can surface looks soft, flat, or low-fidelity, the critic should identify `material_weak`
- system should usually prefer `auto_revise`
- revision strength should often be `light` or `targeted`

What to verify:

- no unnecessary card unless the refinement would cause broader change
- revision prompt should focus on finish, clarity, reflections, and surface definition

Failure examples:

- action card appears for a simple polish issue
- system changes composition dramatically while only trying to improve finish

### Case 6: Missing Reference Required
Purpose:
Verify that the user is only interrupted when missing guidance truly blocks safe continuation.

Suggested prompt:

```text
Create the same product from a new angle but keep the exact identity and packaging from the reference.
```

Run this without giving a sufficient reference image.

Expected behavior:

- should land in `requires_action`
- card should clearly imply that a reference or clearer direction is needed

What to verify:

- interruption feels justified
- system does not invent missing identity details

Failure examples:

- system keeps auto-revising based on guesses
- card wording is too generic to explain why it stopped

### Case 7: Already Good Enough
Purpose:
Verify that the system does not over-optimize polished results.

Suggested prompt:

Use a prompt likely to generate a strong product result, then if the result already looks very good, observe whether the system stops cleanly.

Expected behavior:

- should end at `accept`
- no action card
- no unnecessary `auto_revise`

What to verify:

- if trace is available, `commercialReadiness` and `aestheticFinish` should be high
- no high-severity issue should remain

Failure examples:

- the system keeps revising a result that is already commercially usable

### Case 8: Hard Failure / Incomplete Output
Purpose:
Verify the runtime boundary between deterministic failure handling and AI quality judgment.

This case may require reproducing a broken generation payload or using an existing known failure path.

Expected behavior:

- hard payload failures should still use runtime fallback
- this is correct and intentional
- such cases are not evidence that the card system is "not intelligent"

What to verify:

- deterministic failure is handled as recovery logic
- it is not mislabeled as an aesthetic critique

Failure examples:

- incomplete output gets treated like a normal artistic quality issue

## Per-Case Recording Template
Use this template for every test case.

```markdown
### Case X
- Prompt:
- Result summary:
- Final runtime decision: accept / auto_revise / requires_action
- Did action card appear: yes / no
- If card appeared, was the interruption justified:
- Primary issue shown in trace:
- Revision strength:
- Did the system preserve what should have stayed stable:
- Did it over-revise:
- Notes:
```

## Review Trace Checklist
When a trace is available, inspect these fields:

- `rawDecision`
- `finalDecision`
- `calibratedDecision`
- `primaryIssue.type`
- `primaryIssue.fixScope`
- `primaryIssue.evidence`
- `revisionStrength`
- `quality.intentAlignment`
- `quality.compositionStrength`
- `quality.materialFidelity`
- `quality.brandAccuracy`
- `quality.aestheticFinish`
- `quality.commercialReadiness`

## Success Criteria
The current implementation should be considered healthy if most test cases show:

- no interruption for minor polish-only issues
- no silent acceptance when severe subject/brand/layout issues remain
- cards appear mainly for direction-sensitive or missing-guidance cases
- card wording roughly matches the actual problem type
- auto-revise preserves the parts that should remain stable
- already strong results do not get over-optimized

## Current Limitations to Keep in Mind
These are known constraints of the current design and should not be treated as failures by default:

- the UI still intentionally uses only two user-facing actions
- deterministic payload failures still use runtime fallback rather than aesthetic critique
- the system is smarter than before, but it is not a fully autonomous creative director

## Recommendation After Testing
After executing the cases above, summarize findings into three buckets:

1. `Correct interruptions`
2. `Unnecessary interruptions`
3. `Missed interruptions`

That summary is the best input for deciding whether the next step should be:

- more threshold tuning
- stronger critic prompt guidance
- or no further change

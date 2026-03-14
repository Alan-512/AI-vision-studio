# March 2026 Release: Image Agent Runtime and Chat UX

## Summary

This release upgrades the image agent from a simple chat-triggered generator to a job-based runtime with post-generation review, auto-revision, and user handoff when needed. It also fixes several chat UX regressions introduced while adding critic and review flows.

## User-visible changes

- Images generated from the AI assistant now appear in chat immediately when the first result is ready.
- The task center now uses clearer states and no longer treats `requires_action` as a failed generation.
- Action cards now appear after the generated image instead of awkwardly appearing before the visual result.
- Success sounds play when the image is actually ready; failure sounds still only play for real failures.
- Leaked tool-planning JSON is removed from chat responses.
- Action-card copy now has safer Chinese/English fallback behavior.

## Agent behavior changes

- Added structured image critic review with:
  - issue typing
  - quality signals
  - revision strength
  - review traces for development
- Reduced unnecessary interruptions by preferring `auto_revise` for low-risk, fixable issues.
- Expanded cases that should pause for confirmation, especially:
  - vague aesthetic/global requests
  - broad composition changes
  - ambiguous direction shifts
- Added calibration so the agent is less likely to over-edit already strong results.

## Internal/runtime changes

- Image generation now uses a more explicit split between:
  - user-visible completion
  - background critic/review processing
- Job and task states were refined to better distinguish:
  - generating
  - reviewing
  - action required
  - completed
  - failed

## QA

- Regression checklist for action-card behavior is documented in:
  - [docs/qa/image-agent-card-regression.md](/mnt/d/project/ai-vision-studio/docs/qa/image-agent-card-regression.md)


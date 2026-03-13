import { ConsistencyProfile, CriticDecision, CriticIssue, CriticIssueType, RevisionPlan, ReviewTrace, StructuredCriticReview } from '../types';

export type CriticNormalizationContext = {
  consistencyProfile?: ConsistencyProfile;
  hardConstraints?: string[];
  preferredContinuity?: string[];
};

export type NormalizedCriticReview = StructuredCriticReview & {
  warnings: string[];
  normalizedDecisionReason?: string;
  primaryIssue?: CriticIssue;
  normalizedActionType?: string;
  reviewTrace: ReviewTrace;
};

const GUIDED_ISSUE_TYPES = new Set<CriticIssueType>(['needs_reference', 'constraint_conflict']);
const AGGRESSIVE_AUTO_REVISE_ISSUES = new Set<CriticIssueType>([
  'subject_mismatch',
  'brand_incorrect',
  'material_weak',
  'text_artifact'
]);
const LIGHT_REVISION_ISSUES = new Set<CriticIssueType>([
  'lighting_mismatch',
  'material_weak',
  'text_artifact'
]);
const TARGETED_REVISION_ISSUES = new Set<CriticIssueType>([
  'brand_incorrect',
  'render_incomplete',
  'other'
]);

const dedupeStrings = (values: Array<string | undefined | null>, limit = 10): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
};

const ISSUE_PROMPT_HINTS: Record<CriticIssueType, string> = {
  subject_mismatch: 'Correct the main subject identity so it matches the user request more precisely.',
  brand_incorrect: 'Tighten brand, logo, or label accuracy while preserving the successful parts of the shot.',
  composition_weak: 'Improve framing and layout clarity without changing the overall concept.',
  lighting_mismatch: 'Adjust lighting direction, contrast, or exposure to better match the intended look.',
  material_weak: 'Improve material rendering and product surface definition.',
  text_artifact: 'Reduce text or logo artifacts and keep typography legible if text is required.',
  constraint_conflict: 'Resolve conflicts with the known constraints while preserving as much of the approved direction as possible.',
  needs_reference: 'Do not guess missing reference-dependent details; keep the current direction conservative.',
  render_incomplete: 'Ensure the next result returns a complete and renderable image.',
  other: 'Apply a focused refinement while preserving the current strengths of the image.'
};

const revisionStrengthInstruction = (strength: NonNullable<RevisionPlan['revisionStrength']>): string => {
  switch (strength) {
    case 'light':
      return 'Apply a light-touch correction only. Preserve the current composition, framing, and overall mood unless a minimal local fix requires otherwise.';
    case 'aggressive':
      return 'Prioritize fixing the main mismatch decisively. Stronger subject or layout corrections are allowed, but keep hard constraints and the approved direction intact.';
    default:
      return 'Apply a focused correction to the identified issue while preserving the successful composition, lighting, and continuity cues whenever possible.';
  }
};

const inferRevisionStrength = (
  primaryIssue: CriticIssue | undefined,
  decision: CriticDecision
): NonNullable<RevisionPlan['revisionStrength']> => {
  if (!primaryIssue) {
    return decision === 'requires_action' ? 'targeted' : 'light';
  }
  if (GUIDED_ISSUE_TYPES.has(primaryIssue.type)) {
    return 'targeted';
  }
  if (
    primaryIssue.type === 'subject_mismatch' ||
    primaryIssue.type === 'composition_weak' ||
    (primaryIssue.type === 'brand_incorrect' && primaryIssue.severity === 'high' && primaryIssue.confidence !== 'low')
  ) {
    return 'aggressive';
  }
  if (
    LIGHT_REVISION_ISSUES.has(primaryIssue.type) &&
    !(primaryIssue.severity === 'high' && primaryIssue.confidence === 'high')
  ) {
    return 'light';
  }
  if (TARGETED_REVISION_ISSUES.has(primaryIssue.type)) {
    return 'targeted';
  }
  return primaryIssue.severity === 'low' ? 'light' : 'targeted';
};

const applyExecutionMode = (
  plan: RevisionPlan,
  decision: CriticDecision,
  revisionStrength: NonNullable<RevisionPlan['revisionStrength']>
): RevisionPlan => ({
  ...plan,
  executionMode: decision === 'requires_action' ? 'guided' : 'auto',
  revisionStrength
});

const issuePriority = (issue: CriticIssue): number => {
  const severityScore = issue.severity === 'high' ? 30 : issue.severity === 'medium' ? 20 : 10;
  const confidenceScore = issue.confidence === 'high' ? 3 : issue.confidence === 'medium' ? 2 : 1;
  const guidedBonus = GUIDED_ISSUE_TYPES.has(issue.type) ? 5 : 0;
  return severityScore + confidenceScore + guidedBonus;
};

const selectPrimaryIssue = (issues: CriticIssue[]): CriticIssue | undefined =>
  [...issues].sort((a, b) => issuePriority(b) - issuePriority(a))[0];

const recommendActionType = (decision: CriticDecision, primaryIssue?: CriticIssue): string | undefined => {
  if (!primaryIssue) {
    return decision === 'requires_action' ? 'review_output' : 'continue_optimization';
  }

  switch (primaryIssue.type) {
    case 'needs_reference':
      return 'upload_reference';
    case 'constraint_conflict':
      return 'clarify_constraints';
    case 'brand_incorrect':
      return decision === 'requires_action' ? 'confirm_brand_direction' : 'tighten_brand_match';
    case 'subject_mismatch':
      return decision === 'requires_action' ? 'confirm_subject_direction' : 'tighten_subject_match';
    case 'composition_weak':
      return 'preserve_composition';
    case 'lighting_mismatch':
      return 'refine_lighting';
    case 'material_weak':
      return 'improve_material_rendering';
    case 'text_artifact':
      return 'clean_text_artifacts';
    case 'render_incomplete':
      return 'inspect_generation_payload';
    default:
      return decision === 'requires_action' ? 'review_output' : 'continue_optimization';
  }
};

const buildDecisionReason = (decision: CriticDecision, primaryIssue: CriticIssue | undefined, fallback?: string): string | undefined => {
  if (fallback) return fallback;
  if (!primaryIssue) return undefined;

  switch (decision) {
    case 'auto_revise':
      return `The current result is close, and ${primaryIssue.title.toLowerCase()} can be corrected automatically without changing the user's intent.`;
    case 'requires_action':
      return `The next step depends on ${primaryIssue.title.toLowerCase()}, so the agent should pause for a focused user decision.`;
    default:
      return undefined;
  }
};

export const buildRevisionPromptFromPlan = (
  basePrompt: string,
  plan: RevisionPlan,
  issues: CriticIssue[],
  context?: CriticNormalizationContext
): string => {
  const preserve = dedupeStrings([
    ...plan.preserve,
    ...(context?.consistencyProfile?.preserveSignals || []),
    ...(context?.preferredContinuity || [])
  ]);
  const hardConstraints = dedupeStrings([
    ...(plan.hardConstraints || []),
    ...(context?.hardConstraints || []),
    ...(context?.consistencyProfile?.hardConstraints || [])
  ]);
  const issueHints = dedupeStrings(issues.map(issue => ISSUE_PROMPT_HINTS[issue.type]));
  const revisionStrength = plan.revisionStrength || inferRevisionStrength(
    selectPrimaryIssue(issues),
    plan.executionMode === 'guided' ? 'requires_action' : 'auto_revise'
  );

  const lines = [
    basePrompt.trim(),
    '',
    'Revision goals:',
    `- Strength: ${revisionStrength}`,
    `- Scope: ${revisionStrengthInstruction(revisionStrength)}`
  ];

  if (plan.summary) lines.push(`- ${plan.summary}`);
  preserve.forEach(item => lines.push(`- Keep: ${item}`));
  plan.adjust.forEach(item => lines.push(`- Improve: ${item}`));
  issueHints.forEach(item => lines.push(`- Focus: ${item}`));
  hardConstraints.forEach(item => lines.push(`- Constraint: ${item}`));

  return lines.join('\n').trim();
};

export const normalizeStructuredCriticReview = (
  prompt: string,
  critic: StructuredCriticReview,
  context?: CriticNormalizationContext
): NormalizedCriticReview => {
  const issues = critic.issues || [];
  const primaryIssue = selectPrimaryIssue(issues);
  const hasGuidedIssue = issues.some(issue => GUIDED_ISSUE_TYPES.has(issue.type));
  const hasCalibratedGuidance = critic.calibration?.calibratedDecision === 'requires_action' && critic.calibration?.confidence !== 'low';
  const allAutoFixable = issues.length > 0 && issues.every(issue => issue.autoFixable);
  const strongestAutoFixableIssue = issues.find(issue =>
    issue.autoFixable &&
    AGGRESSIVE_AUTO_REVISE_ISSUES.has(issue.type) &&
    (issue.severity === 'high' || (issue.severity === 'medium' && issue.confidence === 'high'))
  );

  let decision: CriticDecision = critic.decision;
  let normalizedDecisionReason = critic.reason;
  if (decision === 'requires_action' && !hasGuidedIssue && !hasCalibratedGuidance && allAutoFixable && critic.reviewPlan.executionMode !== 'guided') {
    decision = 'auto_revise';
    normalizedDecisionReason = normalizedDecisionReason || 'All identified issues are auto-fixable, so the runtime can continue without interrupting the user.';
  }
  if (decision === 'auto_revise' && (hasGuidedIssue || hasCalibratedGuidance)) {
    decision = 'requires_action';
    normalizedDecisionReason = normalizedDecisionReason || 'The review found a missing reference or conflicting constraint that needs user guidance.';
  }
  if (decision === 'accept' && !hasGuidedIssue && strongestAutoFixableIssue && critic.reviewPlan.adjust.length > 0) {
    decision = 'auto_revise';
    normalizedDecisionReason = normalizedDecisionReason || `The result is usable, but ${strongestAutoFixableIssue.title.toLowerCase()} should be corrected automatically before asking the user to judge it.`;
  }

  const revisionStrength = critic.reviewPlan.revisionStrength || inferRevisionStrength(primaryIssue, decision);
  const reviewPlan = applyExecutionMode(critic.reviewPlan, decision, revisionStrength);
  const normalizedActionType = critic.recommendedActionType || recommendActionType(decision, primaryIssue);
  normalizedDecisionReason = buildDecisionReason(decision, primaryIssue, normalizedDecisionReason);
  const revisedPrompt = decision === 'accept'
    ? undefined
    : (critic.revisedPrompt || buildRevisionPromptFromPlan(prompt, reviewPlan, issues, context));
  const warnings = issues
    .filter(issue => issue.severity !== 'low')
    .map(issue => issue.detail);
  const reviewTrace: ReviewTrace = {
    rawDecision: critic.calibration?.baseDecision || critic.decision,
    finalDecision: decision,
    calibratedDecision: critic.calibration?.calibratedDecision,
    calibrationConfidence: critic.calibration?.confidence,
    summary: critic.summary,
    reason: normalizedDecisionReason,
    quality: critic.quality,
    primaryIssue: primaryIssue
      ? {
          type: primaryIssue.type,
          severity: primaryIssue.severity,
          confidence: primaryIssue.confidence,
          title: primaryIssue.title
        }
      : undefined,
    actionType: normalizedActionType,
    revisionStrength,
    preserve: reviewPlan.preserve,
    adjust: reviewPlan.adjust,
    hardConstraints: reviewPlan.hardConstraints,
    preferredContinuity: reviewPlan.preferredContinuity,
    issueTypes: issues.map(issue => issue.type)
  };

  return {
    ...critic,
    decision,
    reviewPlan,
    revisedPrompt,
    warnings,
    normalizedDecisionReason,
    primaryIssue,
    normalizedActionType,
    reviewTrace
  };
};

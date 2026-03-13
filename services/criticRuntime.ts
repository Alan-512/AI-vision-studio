import { ConsistencyProfile, CriticDecision, CriticIssue, CriticIssueType, RevisionPlan, StructuredCriticReview } from '../types';

export type CriticNormalizationContext = {
  consistencyProfile?: ConsistencyProfile;
  hardConstraints?: string[];
  preferredContinuity?: string[];
};

export type NormalizedCriticReview = StructuredCriticReview & {
  warnings: string[];
  normalizedDecisionReason?: string;
};

const GUIDED_ISSUE_TYPES = new Set<CriticIssueType>(['needs_reference', 'constraint_conflict']);
const AGGRESSIVE_AUTO_REVISE_ISSUES = new Set<CriticIssueType>([
  'subject_mismatch',
  'brand_incorrect',
  'material_weak',
  'text_artifact'
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

const applyExecutionMode = (plan: RevisionPlan, decision: CriticDecision): RevisionPlan => ({
  ...plan,
  executionMode: decision === 'requires_action' ? 'guided' : 'auto'
});

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

  const lines = [
    basePrompt.trim(),
    '',
    'Revision goals:'
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
  const hasGuidedIssue = issues.some(issue => GUIDED_ISSUE_TYPES.has(issue.type));
  const allAutoFixable = issues.length > 0 && issues.every(issue => issue.autoFixable);
  const strongestAutoFixableIssue = issues.find(issue =>
    issue.autoFixable &&
    AGGRESSIVE_AUTO_REVISE_ISSUES.has(issue.type) &&
    (issue.severity === 'high' || (issue.severity === 'medium' && issue.confidence === 'high'))
  );

  let decision: CriticDecision = critic.decision;
  let normalizedDecisionReason = critic.reason;
  if (decision === 'requires_action' && !hasGuidedIssue && allAutoFixable && critic.reviewPlan.executionMode !== 'guided') {
    decision = 'auto_revise';
    normalizedDecisionReason = normalizedDecisionReason || 'All identified issues are auto-fixable, so the runtime can continue without interrupting the user.';
  }
  if (decision === 'auto_revise' && hasGuidedIssue) {
    decision = 'requires_action';
    normalizedDecisionReason = normalizedDecisionReason || 'The review found a missing reference or conflicting constraint that needs user guidance.';
  }
  if (decision === 'accept' && !hasGuidedIssue && strongestAutoFixableIssue && critic.reviewPlan.adjust.length > 0) {
    decision = 'auto_revise';
    normalizedDecisionReason = normalizedDecisionReason || `The result is usable, but ${strongestAutoFixableIssue.title.toLowerCase()} should be corrected automatically before asking the user to judge it.`;
  }

  const reviewPlan = applyExecutionMode(critic.reviewPlan, decision);
  const revisedPrompt = decision === 'accept'
    ? undefined
    : (critic.revisedPrompt || buildRevisionPromptFromPlan(prompt, reviewPlan, issues, context));
  const warnings = issues
    .filter(issue => issue.severity !== 'low')
    .map(issue => issue.detail);

  return {
    ...critic,
    decision,
    reviewPlan,
    revisedPrompt,
    warnings,
    normalizedDecisionReason
  };
};

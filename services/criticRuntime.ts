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

const ISSUE_CARD_COPY: Partial<Record<CriticIssueType, {
  zh: { title: string; message: string };
  en: { title: string; message: string };
}>> = {
  brand_incorrect: {
    zh: {
      title: '我建议先确认品牌呈现方向',
      message: '我已经找到继续优化的路径，但下一步会明显影响品牌或标签呈现，先由你确认会更稳妥。'
    },
    en: {
      title: 'I Recommend Confirming the Brand Direction',
      message: 'I have a clear refinement path, but the next step would materially affect the brand or label read, so it is better to confirm first.'
    }
  },
  composition_weak: {
    zh: {
      title: '我建议先确认这一版的构图调整范围',
      message: '我已经判断出构图还可以更好，但这一步可能会调整画面布局，先确认范围更合适。'
    },
    en: {
      title: 'I Recommend Confirming the Composition Scope',
      message: 'I can improve the composition, but the next pass may alter the layout or framing, so it is better to confirm the scope first.'
    }
  },
  material_weak: {
    zh: {
      title: '我建议继续提升这一版的质感表现',
      message: '我已经定位到材质和表面表现还可以更精细，如果你愿意，我可以继续优化这一版。'
    },
    en: {
      title: 'I Recommend Refining the Surface Finish',
      message: 'I have identified a clearer way to improve the material rendering and finish, and I can continue from here if you want.'
    }
  },
  subject_mismatch: {
    zh: {
      title: '我建议先确认主体修正方向',
      message: '我已经知道如何继续修正主体，但这一步会明显影响主体呈现，最好先确认方向。'
    },
    en: {
      title: 'I Recommend Confirming the Subject Direction',
      message: 'I know how to correct the subject, but the next step would noticeably change the current subject read, so it is better to confirm first.'
    }
  },
  needs_reference: {
    zh: {
      title: '我需要一张更明确的参考图再继续',
      message: '我已经把当前结果的问题整理清楚了，但缺少关键参考信息，继续猜测风险会比较高。'
    },
    en: {
      title: 'I Need a Clearer Reference Before Continuing',
      message: 'I understand the current gap, but a key reference is missing and continuing by guesswork would be too risky.'
    }
  },
  constraint_conflict: {
    zh: {
      title: '我建议先确认当前约束优先级',
      message: '当前结果和已有约束之间存在冲突，我可以继续，但最好先确定哪条要求更优先。'
    },
    en: {
      title: 'I Recommend Confirming the Constraint Priority',
      message: 'The current result conflicts with known constraints. I can continue, but it is better to confirm which requirement should dominate first.'
    }
  }
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
  if (primaryIssue.fixScope === 'layout' || primaryIssue.fixScope === 'global') {
    return primaryIssue.severity === 'low' ? 'targeted' : 'aggressive';
  }
  if (primaryIssue.fixScope === 'local') {
    return primaryIssue.severity === 'high' && primaryIssue.confidence === 'high' ? 'targeted' : 'light';
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
  const scopeBonus = issue.fixScope === 'global' ? 4 : issue.fixScope === 'layout' ? 3 : issue.fixScope === 'subject' ? 2 : 0;
  return severityScore + confidenceScore + guidedBonus + scopeBonus;
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
  const scopeHint = primaryIssue.fixScope ? ` The main fix scope is ${primaryIssue.fixScope}.` : '';

  switch (decision) {
    case 'auto_revise':
      return `The current result is close, and ${primaryIssue.title.toLowerCase()} can be corrected automatically without changing the user's intent.${scopeHint}`;
    case 'requires_action':
      return `The next step depends on ${primaryIssue.title.toLowerCase()}, so the agent should pause for a focused user decision.${scopeHint}`;
    default:
      return undefined;
  }
};

const averageQualityScore = (critic: StructuredCriticReview): number | null => {
  if (!critic.quality) return null;
  const scores = [
    critic.quality.intentAlignment,
    critic.quality.compositionStrength,
    critic.quality.lightingQuality,
    critic.quality.materialFidelity,
    critic.quality.brandAccuracy,
    critic.quality.aestheticFinish,
    critic.quality.commercialReadiness
  ].filter((value): value is number => typeof value === 'number');
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
};

const buildFallbackUserFacingCopy = (
  decision: CriticDecision,
  primaryIssue: CriticIssue | undefined,
  summary: string,
  reason: string | undefined,
  qualityNote?: string
): StructuredCriticReview['userFacing'] | undefined => {
  if (decision !== 'requires_action') return undefined;

  const preset = primaryIssue ? ISSUE_CARD_COPY[primaryIssue.type] : undefined;
  const reasonOrSummary = reason || summary;
  const evidence = primaryIssue?.evidence?.[0];
  const evidenceSentenceZh = evidence ? ` 我目前看到的关键问题是：${evidence}` : '';
  const evidenceSentenceEn = evidence ? ` The main signal I see right now is: ${evidence}` : '';
  const qualitySentenceZh = qualityNote ? ` ${qualityNote}` : '';
  const qualitySentenceEn = qualityNote ? ` ${qualityNote}` : '';

  if (preset) {
    return {
      zh: {
        title: preset.zh.title,
        message: `${preset.zh.message}${evidenceSentenceZh}${qualitySentenceZh}`.trim()
      },
      en: {
        title: preset.en.title,
        message: `${preset.en.message}${evidenceSentenceEn}${qualitySentenceEn}`.trim()
      }
    };
  }

  return {
    zh: {
      title: '我建议先确认下一步优化方向',
      message: `${reasonOrSummary}${evidenceSentenceZh}${qualitySentenceZh}`.trim()
    },
    en: {
      title: 'I Recommend Confirming the Next Refinement Step',
      message: `${reasonOrSummary}${evidenceSentenceEn}${qualitySentenceEn}`.trim()
    }
  };
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
  const issueEvidence = dedupeStrings(issues.flatMap(issue => issue.evidence || []), 6);
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
  issueEvidence.forEach(item => lines.push(`- Evidence: ${item}`));
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
  const highSeverityIssueCount = issues.filter(issue => issue.severity === 'high').length;
  const qualityAverage = averageQualityScore(critic);
  const isCommerciallyReady = !!critic.quality && critic.quality.commercialReadiness >= 4 && critic.quality.aestheticFinish >= 4;
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
  if (
    decision === 'auto_revise' &&
    !hasGuidedIssue &&
    !hasCalibratedGuidance &&
    highSeverityIssueCount === 0 &&
    isCommerciallyReady &&
    qualityAverage !== null &&
    qualityAverage >= 4
  ) {
    decision = 'accept';
    normalizedDecisionReason = normalizedDecisionReason || 'The result is already commercially polished enough that another revision is unlikely to improve it materially.';
  }

  const revisionStrength = critic.reviewPlan.revisionStrength || inferRevisionStrength(primaryIssue, decision);
  const reviewPlan = applyExecutionMode(critic.reviewPlan, decision, revisionStrength);
  const normalizedActionType = critic.recommendedActionType || recommendActionType(decision, primaryIssue);
  normalizedDecisionReason = buildDecisionReason(decision, primaryIssue, normalizedDecisionReason);
  const qualityNote = critic.quality?.note;
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
          title: primaryIssue.title,
          fixScope: primaryIssue.fixScope,
          evidence: primaryIssue.evidence
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
    userFacing: critic.userFacing?.zh || critic.userFacing?.en
      ? critic.userFacing
      : buildFallbackUserFacingCopy(decision, primaryIssue, critic.summary, normalizedDecisionReason, qualityNote),
    reviewTrace
  };
};

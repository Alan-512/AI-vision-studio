import {
  AssistantMode,
  ConsistencyProfile,
  StructuredCriticReview,
  TextModel,
  type AgentJob,
  type CriticDecision,
  type CriticIssue,
  type CriticIssueConfidence,
  type CriticIssueType,
  type CriticQualityAssessment,
  type LocalizedCriticCardCopy,
  type RevisionPlan
} from '../types';
import { getAIClient } from './geminiService';

export type ImageCriticContextInput = {
  assistantMode?: AssistantMode;
  searchFacts?: string[];
  referenceHints?: string[];
  hardConstraints?: string[];
  preferredContinuity?: string[];
  negativePrompt?: string;
  consistencyProfile?: ConsistencyProfile;
};

type ParsedCriticCalibration = {
  decision: CriticDecision;
  reason?: string;
  confidence?: CriticIssueConfidence;
  recommendedActionType?: string;
  executionMode?: 'auto' | 'guided';
  userFacing?: {
    zh?: LocalizedCriticCardCopy;
    en?: LocalizedCriticCardCopy;
  };
};

const VALID_CRITIC_DECISIONS = new Set<CriticDecision>(['accept', 'auto_revise', 'requires_action']);
const VALID_ISSUE_SEVERITIES = new Set(['low', 'medium', 'high']);
const VALID_ISSUE_TYPES = new Set<CriticIssueType>([
  'subject_mismatch',
  'brand_incorrect',
  'composition_weak',
  'lighting_mismatch',
  'material_weak',
  'text_artifact',
  'constraint_conflict',
  'needs_reference',
  'render_incomplete',
  'other'
]);

const dedupeStrings = (items: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  items.forEach(item => {
    if (!item) return;
    if (seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });

  return result;
};

const sanitizeStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()).slice(0, 8)
  : [];

const sanitizeCardCopy = (value: unknown): LocalizedCriticCardCopy | undefined => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim() : '';
  const message = typeof raw.message === 'string' && raw.message.trim().length > 0 ? raw.message.trim() : '';
  return title || message ? { title, message } : undefined;
};

const sanitizeQualityScore = (value: unknown, fallback = 3): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(5, Math.max(1, Math.round(value)));
};

const sanitizeQualityAssessment = (value: unknown): CriticQualityAssessment | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  return {
    intentAlignment: sanitizeQualityScore(raw.intentAlignment),
    compositionStrength: sanitizeQualityScore(raw.compositionStrength),
    lightingQuality: sanitizeQualityScore(raw.lightingQuality),
    materialFidelity: sanitizeQualityScore(raw.materialFidelity),
    brandAccuracy: sanitizeQualityScore(raw.brandAccuracy),
    aestheticFinish: sanitizeQualityScore(raw.aestheticFinish),
    commercialReadiness: sanitizeQualityScore(raw.commercialReadiness),
    note: typeof raw.note === 'string' && raw.note.trim().length > 0 ? raw.note.trim() : undefined
  };
};

const sanitizeRevisionPlan = (value: unknown): RevisionPlan => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const localizedRaw = raw.localized && typeof raw.localized === 'object' ? raw.localized as Record<string, unknown> : {};
  const sanitizeLocalized = (entry: unknown) => {
    const localizedEntry = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const summary = typeof localizedEntry.summary === 'string' && localizedEntry.summary.trim().length > 0
      ? localizedEntry.summary.trim()
      : '';
    const preserve = sanitizeStringArray(localizedEntry.preserve);
    const adjust = sanitizeStringArray(localizedEntry.adjust);
    return summary || preserve.length > 0 || adjust.length > 0
      ? { summary, preserve, adjust }
      : undefined;
  };

  return {
    summary: typeof raw.summary === 'string' && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : 'I can continue refining this result while preserving the strongest parts of the current image.',
    preserve: sanitizeStringArray(raw.preserve),
    adjust: sanitizeStringArray(raw.adjust),
    confidence: typeof raw.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(raw.confidence)
      ? raw.confidence as RevisionPlan['confidence']
      : 'medium',
    executionMode: raw.executionMode === 'guided' ? 'guided' : 'auto',
    issueTypes: sanitizeStringArray(raw.issueTypes).filter((type): type is CriticIssueType => VALID_ISSUE_TYPES.has(type as CriticIssueType)),
    hardConstraints: sanitizeStringArray(raw.hardConstraints),
    preferredContinuity: sanitizeStringArray(raw.preferredContinuity),
    localized: {
      zh: sanitizeLocalized(localizedRaw.zh),
      en: sanitizeLocalized(localizedRaw.en)
    }
  };
};

const sanitizeCriticIssue = (value: unknown): CriticIssue | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const type = typeof raw.type === 'string' && VALID_ISSUE_TYPES.has(raw.type as CriticIssueType)
    ? raw.type as CriticIssueType
    : 'other';
  const severity = typeof raw.severity === 'string' && VALID_ISSUE_SEVERITIES.has(raw.severity)
    ? raw.severity as CriticIssue['severity']
    : 'medium';
  const confidence = typeof raw.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(raw.confidence)
    ? raw.confidence as CriticIssue['confidence']
    : 'medium';
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0
    ? raw.title.trim()
    : type.replace(/_/g, ' ');
  const detail = typeof raw.detail === 'string' && raw.detail.trim().length > 0
    ? raw.detail.trim()
    : title;

  return {
    type,
    severity,
    confidence,
    autoFixable: raw.autoFixable !== false,
    title,
    detail,
    fixScope: raw.fixScope === 'local' || raw.fixScope === 'subject' || raw.fixScope === 'layout' || raw.fixScope === 'global'
      ? raw.fixScope
      : undefined,
    evidence: sanitizeStringArray(raw.evidence),
    relatedConstraint: typeof raw.relatedConstraint === 'string' && raw.relatedConstraint.trim().length > 0
      ? raw.relatedConstraint.trim()
      : undefined
  };
};

export const buildImageCriticContext = ({
  assistantMode,
  negativePrompt,
  selectedReferences,
  consistencyProfile,
  searchContext
}: {
  assistantMode?: AssistantMode;
  negativePrompt?: string;
  selectedReferences: Array<{ sourceRole?: string }>;
  consistencyProfile?: ConsistencyProfile;
  searchContext?: AgentJob['searchContext'];
}): ImageCriticContextInput => ({
  assistantMode: assistantMode || consistencyProfile?.assistantMode,
  searchFacts: dedupeStrings((searchContext?.facts || []).map(fact => fact.source ? `${fact.item} (${fact.source})` : fact.item)),
  referenceHints: dedupeStrings([
    selectedReferences.length > 0 ? `${selectedReferences.length} reference image(s) were used for this generation.` : undefined,
    ...selectedReferences.map(reference => reference.sourceRole === 'user'
      ? 'User-provided reference should influence subject, style, or composition continuity.'
      : 'Prior generated image should be treated as follow-up continuity context.')
  ]),
  hardConstraints: consistencyProfile?.hardConstraints || [],
  preferredContinuity: consistencyProfile?.preferredContinuity || [],
  negativePrompt,
  consistencyProfile
});

export const buildImageCriticContextText = (context?: ImageCriticContextInput): string => {
  if (!context) return '';

  const lines: string[] = [];
  if (context.assistantMode) {
    lines.push(`- assistant_mode: ${context.assistantMode}`);
  }

  const mergedHardConstraints = [
    ...(context.hardConstraints || []),
    ...(context.consistencyProfile?.hardConstraints || [])
  ];
  const mergedContinuity = [
    ...(context.preferredContinuity || []),
    ...(context.consistencyProfile?.preferredContinuity || [])
  ];
  const mergedPreserve = context.consistencyProfile?.preserveSignals || [];

  if (mergedHardConstraints.length > 0) {
    lines.push('- hard_constraints:');
    mergedHardConstraints.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
  }
  if (mergedContinuity.length > 0) {
    lines.push('- preferred_continuity:');
    mergedContinuity.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
  }
  if (mergedPreserve.length > 0) {
    lines.push('- preserve_signals:');
    mergedPreserve.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
  }
  if (context.referenceHints && context.referenceHints.length > 0) {
    lines.push('- reference_context:');
    context.referenceHints.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
  }
  if (context.searchFacts && context.searchFacts.length > 0) {
    lines.push('- search_facts:');
    context.searchFacts.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
  }
  if (typeof context.negativePrompt === 'string' && context.negativePrompt.trim().length > 0) {
    lines.push(`- negative_prompt_to_avoid: ${context.negativePrompt.trim()}`);
  }

  return lines.length > 0
    ? `\nAdditional runtime constraints:\n${lines.join('\n')}\n`
    : '';
};

export const parseImageCriticReview = (rawText: string): StructuredCriticReview | null => {
  if (!rawText.trim()) return null;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const decision = typeof parsed.decision === 'string' && VALID_CRITIC_DECISIONS.has(parsed.decision as CriticDecision)
      ? parsed.decision as CriticDecision
      : 'requires_action';
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(sanitizeCriticIssue).filter((issue): issue is CriticIssue => !!issue)
      : [];
    const reviewPlan = sanitizeRevisionPlan(parsed.reviewPlan);

    return {
      decision,
      summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : 'I reviewed the current image and prepared the next best action.',
      issues,
      quality: sanitizeQualityAssessment(parsed.quality),
      reviewPlan,
      revisedPrompt: typeof parsed.revisedPrompt === 'string' && parsed.revisedPrompt.trim().length > 0
        ? parsed.revisedPrompt.trim()
        : undefined,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : undefined,
      recommendedActionType: typeof parsed.recommendedActionType === 'string' && parsed.recommendedActionType.trim().length > 0
        ? parsed.recommendedActionType.trim()
        : undefined,
      userFacing: {
        zh: sanitizeCardCopy((parsed.userFacing as any)?.zh),
        en: sanitizeCardCopy((parsed.userFacing as any)?.en)
      }
    };
  } catch (error) {
    console.warn('[parseImageCriticReview] Failed to parse JSON review response', error);
    return null;
  }
};

export const parseImageCriticCalibration = (rawText: string): ParsedCriticCalibration | null => {
  if (!rawText.trim()) return null;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const decision = typeof parsed.decision === 'string' && VALID_CRITIC_DECISIONS.has(parsed.decision as CriticDecision)
      ? parsed.decision as CriticDecision
      : null;
    if (!decision) return null;

    return {
      decision,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : undefined,
      confidence: typeof parsed.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(parsed.confidence)
        ? parsed.confidence as CriticIssueConfidence
        : undefined,
      recommendedActionType: typeof parsed.recommendedActionType === 'string' && parsed.recommendedActionType.trim().length > 0
        ? parsed.recommendedActionType.trim()
        : undefined,
      executionMode: parsed.executionMode === 'guided' ? 'guided' : (parsed.executionMode === 'auto' ? 'auto' : undefined),
      userFacing: {
        zh: sanitizeCardCopy((parsed.userFacing as any)?.zh),
        en: sanitizeCardCopy((parsed.userFacing as any)?.en)
      }
    };
  } catch (error) {
    console.warn('[parseImageCriticCalibration] Failed to parse calibration JSON', error);
    return null;
  }
};

export const applyImageCriticCalibration = (
  review: StructuredCriticReview,
  calibration: ParsedCriticCalibration | null
): StructuredCriticReview => {
  if (!calibration) return review;

  return {
    ...review,
    decision: calibration.decision,
    reason: calibration.reason || review.reason,
    recommendedActionType: calibration.recommendedActionType || review.recommendedActionType,
    reviewPlan: {
      ...review.reviewPlan,
      executionMode: calibration.executionMode || review.reviewPlan.executionMode
    },
    userFacing: {
      zh: calibration.userFacing?.zh || review.userFacing?.zh,
      en: calibration.userFacing?.en || review.userFacing?.en
    },
    calibration: {
      baseDecision: review.decision,
      calibratedDecision: calibration.decision,
      confidence: calibration.confidence,
      reason: calibration.reason || review.reason
    }
  };
};

export const reviewGeneratedImageWithAI = async (
  prompt: string,
  imageBase64: string,
  mimeType: string,
  context?: ImageCriticContextInput,
  deps: {
    generateContent?: (request: {
      model: TextModel;
      contents: { parts: Array<Record<string, unknown>> };
      config: { responseMimeType: string };
    }) => Promise<{ text?: string | null }>;
  } = {}
): Promise<StructuredCriticReview> => {
  const ai = deps.generateContent
    ? null
    : getAIClient();
  const generateContent = deps.generateContent || ((request: {
    model: TextModel;
    contents: { parts: Array<Record<string, unknown>> };
    config: { responseMimeType: string };
  }) => ai!.models.generateContent(request));
  const criticContextText = buildImageCriticContextText(context);
  const response = await generateContent({
    model: TextModel.PRO,
    contents: {
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        {
          text: `You are the image critic for AI Vision Studio.

Review the generated image against the user's prompt. Your job is to decide whether the result should be accepted, automatically revised, or paused for user input.

Decision rules:
- choose "requires_action" (MANDATORY) if the user instruction is vague, subjective, or open to multiple interpretations (e.g. "make it pop", "more premium", "push it further", "give it a better vibe"). Even if you think you implemented it, you MUST let the user confirm your interpretation.
- choose "requires_action" (MANDATORY) if the revision involves a major directional shift in composition, density, or overall visual layout (e.g. from minimalist/clean to crowded/complex, or moving the main subject significantly). These large scope changes require user approval before finalizing.
- choose "auto_revise" ONLY for clear, objective fixes where the user's intent is unambiguous and the change is safely local (e.g. "remove this small artifact", "make the lighting slightly warmer").
- choose "accept" ONLY if the image matches the prompt and needs zero further refinement.
- If in doubt, ALWAYS prefer "requires_action". Never automatically "accept" a major directional change.

You must focus on practical refinement quality, not abstract art critique.
Prioritize:
1. subject / product correctness
2. composition and framing
3. lighting and material rendering
4. brand / text / artifact issues
5. consistency with a likely follow-up edit path
6. commercial finish, premium feel, and whether another revision would materially improve the result

Issue semantics:
- For "brand_incorrect", explain whether the mismatch is local label/logo fidelity, broader packaging identity, or overall brand direction drift.
- For "composition_weak", explain whether the weakness is framing, crop, balance, spacing, perspective, or layout hierarchy.
- For "material_weak", explain whether the weakness is texture realism, reflections, surface separation, edge clarity, or product finish.
- For vague or multi-interpretation requests, prefer "other" with a clear explanation of why the direction is ambiguous, and set "fixScope" to "global" if the likely change would affect the whole scene direction.
- Set "fixScope" to one of:
  - "local" for narrow fixes such as texture cleanup, lighting polish, or text cleanup
  - "subject" for subject/product identity fixes
  - "layout" for composition, crop, framing, or scene arrangement changes
  - "global" for broader direction or scene-wide shifts
- Add short "evidence" strings that describe what in the image supports your diagnosis.

Quality scoring guidance:
- 1 = clearly failing
- 3 = acceptable but not polished
- 5 = strong and production-ready
- "aestheticFinish" should reflect visual polish and premium execution within the requested style
- "commercialReadiness" should reflect whether the image is ready for real product/brand usage or still needs another meaningful pass

Return JSON only with this shape:
{
  "decision": "accept" | "auto_revise" | "requires_action",
  "summary": string,
  "reason": string,
  "recommendedActionType": string,
  "issues": [
    {
      "type": "subject_mismatch" | "brand_incorrect" | "composition_weak" | "lighting_mismatch" | "material_weak" | "text_artifact" | "constraint_conflict" | "needs_reference" | "render_incomplete" | "other",
      "severity": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high",
      "autoFixable": boolean,
      "title": string,
      "detail": string,
      "fixScope": "local" | "subject" | "layout" | "global",
      "evidence": string[],
      "relatedConstraint": string
    }
  ],
  "quality": {
    "intentAlignment": 1-5,
    "compositionStrength": 1-5,
    "lightingQuality": 1-5,
    "materialFidelity": 1-5,
    "brandAccuracy": 1-5,
    "aestheticFinish": 1-5,
    "commercialReadiness": 1-5,
    "note": string
  },
  "reviewPlan": {
    "summary": string,
    "preserve": string[],
    "adjust": string[],
    "confidence": "low" | "medium" | "high",
    "executionMode": "auto" | "guided",
    "issueTypes": string[],
    "hardConstraints": string[],
    "preferredContinuity": string[],
    "localized": {
      "zh": {
        "summary": string,
        "preserve": string[],
        "adjust": string[]
      },
      "en": {
        "summary": string,
        "preserve": string[],
        "adjust": string[]
      }
    }
  },
  "revisedPrompt": string
}

If you choose "requires_action", provide a strong plan but do not ask the user to rewrite prompts manually.

User prompt:
${prompt}${criticContextText}`
        }
      ]
    },
    config: {
      responseMimeType: 'application/json'
    }
  });

  const parsed = parseImageCriticReview((response.text ?? '').trim());
  if (!parsed) {
    throw new Error('Image critic returned invalid JSON');
  }

  try {
    const calibrationResponse = await generateContent({
      model: TextModel.PRO,
      contents: {
        parts: [
          {
            text: `You are the calibration layer for AI Vision Studio's image critic.

Your job is NOT to re-review the image from scratch. Your job is to decide whether the user should actually be interrupted.

You will receive:
1. the original user prompt
2. runtime constraints
3. the primary critic's structured review JSON

Calibration rules:
- choose "requires_action" (MANDATORY) if the revision involves a directional layout/composition shift, or responds to vague terms (pop/vibe/premium).
- forbid "auto_revise" for major changes. Use it ONLY for safe, objective, local refinements where the user intent is 100% specific.
- choose "requires_action" if the change materially alters scene density, framing, or visual direction.
- prioritize safe interruption over immediate generation.
- choose "accept" only when refinement is no longer possible.
- pay special attention to compositionStrength, materialFidelity, brandAccuracy, aestheticFinish, and commercialReadiness

Return JSON only with this shape:
{
  "decision": "accept" | "auto_revise" | "requires_action",
  "reason": string,
  "confidence": "low" | "medium" | "high",
  "recommendedActionType": string,
  "executionMode": "auto" | "guided",
  "userFacing": {
    "zh": { "title": string, "message": string },
    "en": { "title": string, "message": string }
  }
}

Use action types like:
- continue_optimization
- upload_reference
- confirm_subject_direction
- confirm_brand_direction
- clarify_style_direction
- preserve_composition
- confirm_refinement_scope
- clarify_constraints

User prompt:
${prompt}${criticContextText}

Primary critic review:
${JSON.stringify(parsed, null, 2)}`
          }
        ]
      },
      config: {
        responseMimeType: 'application/json'
      }
    });

    return applyImageCriticCalibration(parsed, parseImageCriticCalibration((calibrationResponse.text ?? '').trim()));
  } catch (error) {
    console.warn('[reviewGeneratedImageWithAI] Calibration pass failed, using primary critic review.', error);
    return parsed;
  }
};

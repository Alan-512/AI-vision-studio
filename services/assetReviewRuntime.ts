import type {
  AssetItem,
  CriticDecision,
  CriticIssue,
  RevisionPlan,
  ReviewTrace,
  StructuredCriticReview
} from '../types';
import { reviewGeneratedImageWithAI, type ImageCriticContextInput } from './imageCriticService';
import { normalizeImageUrlForChat } from './imageUtils';
import { normalizeStructuredCriticReview } from './criticRuntime';
import { buildOptimizationPlan, buildRequiresActionPayload } from './generationOrchestrator';

export type LocalReviewResult = {
  decision: CriticDecision;
  summary: string;
  warnings: string[];
  issues?: CriticIssue[];
  quality?: StructuredCriticReview['quality'];
  reviewTrace?: ReviewTrace;
  revisedPrompt?: string;
  revisionReason?: string;
  reviewPlan?: RevisionPlan;
  requiresAction?: {
    type: string;
    message: string;
    payload?: Record<string, unknown>;
  };
};

const dataUrlToInlineImage = (dataUrl: string): { mimeType: string; data: string } | null => {
  if (!dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2]
  };
};

const criticToLocalReview = (
  prompt: string,
  critic: StructuredCriticReview,
  fallbackActionType: string,
  context?: ImageCriticContextInput
): LocalReviewResult => {
  const normalized = normalizeStructuredCriticReview(prompt, critic, {
    consistencyProfile: context?.consistencyProfile,
    hardConstraints: context?.hardConstraints,
    preferredContinuity: context?.preferredContinuity
  });

  return {
    decision: normalized.decision,
    summary: normalized.summary,
    warnings: normalized.warnings,
    issues: normalized.issues,
    quality: normalized.quality,
    reviewTrace: normalized.reviewTrace,
    revisedPrompt: normalized.revisedPrompt,
    revisionReason: normalized.normalizedDecisionReason || normalized.reason || normalized.summary,
    reviewPlan: normalized.reviewPlan,
    requiresAction: normalized.decision === 'requires_action'
      ? {
        type: normalized.normalizedActionType || fallbackActionType,
        message: normalized.userFacing?.zh?.message || normalized.userFacing?.en?.message || normalized.normalizedDecisionReason || normalized.summary,
        payload: buildRequiresActionPayload(prompt, {
          summary: normalized.summary,
          warnings: normalized.issues.map(issue => issue.detail),
          quality: normalized.quality,
          revisedPrompt: normalized.revisedPrompt,
          reviewPlan: normalized.reviewPlan,
          reviewTrace: normalized.reviewTrace,
          issues: normalized.issues
        } as LocalReviewResult, {
          title: {
            zh: normalized.userFacing?.zh?.title || '我建议先确认下一步方向',
            en: normalized.userFacing?.en?.title || 'I Recommend Confirming the Next Step'
          },
          message: {
            zh: normalized.userFacing?.zh?.message || normalized.normalizedDecisionReason || normalized.summary,
            en: normalized.userFacing?.en?.message || normalized.normalizedDecisionReason || normalized.summary
          }
        })
      }
      : undefined
  };
};

export const reviewGeneratedAssetLocally = (asset: AssetItem, prompt: string): LocalReviewResult => {
  const warnings: string[] = [];

  if (!asset.url) {
    const issues: CriticIssue[] = [{
      type: 'render_incomplete',
      severity: 'high',
      confidence: asset.type === 'IMAGE' ? 'medium' : 'low',
      autoFixable: asset.type === 'IMAGE',
      title: 'Generated asset is incomplete',
      detail: 'The generated result is missing a renderable URL.',
      relatedConstraint: 'render_output'
    }];
    const reviewPlan = buildOptimizationPlan({
      summary: 'The render payload is incomplete. I can retry generation while preserving the current creative direction.',
      preserve: ['creative direction', 'composition intent'],
      adjust: ['render output validity'],
      confidence: asset.type === 'IMAGE' ? 'medium' : 'low',
      executionMode: asset.type === 'IMAGE' ? 'auto' : 'guided',
      issueTypes: ['render_incomplete'],
      hardConstraints: ['return a renderable asset'],
      preferredContinuity: ['creative direction', 'composition intent'],
      localized: {
        zh: {
          summary: '当前渲染结果不完整。我可以保留现有创意方向并重试生成。',
          preserve: ['创意方向', '构图意图'],
          adjust: ['渲染输出完整性']
        },
        en: {
          summary: 'The render payload is incomplete. I can retry generation while preserving the current creative direction.',
          preserve: ['creative direction', 'composition intent'],
          adjust: ['render output validity']
        }
      }
    });
    return {
      decision: asset.type === 'IMAGE' ? 'auto_revise' : 'requires_action',
      summary: 'Generated asset is missing a URL and cannot be finalized.',
      warnings,
      issues,
      quality: undefined,
      reviewTrace: {
        rawDecision: asset.type === 'IMAGE' ? 'auto_revise' : 'requires_action',
        finalDecision: asset.type === 'IMAGE' ? 'auto_revise' : 'requires_action',
        summary: 'Generated asset is missing a URL and cannot be finalized.',
        reason: 'The generated image payload did not contain a renderable URL.',
        primaryIssue: {
          type: 'render_incomplete',
          severity: 'high',
          confidence: asset.type === 'IMAGE' ? 'medium' : 'low',
          title: 'Generated asset is incomplete'
        },
        actionType: asset.type === 'IMAGE' ? 'continue_optimization' : 'inspect_generation_payload',
        preserve: reviewPlan.preserve,
        adjust: reviewPlan.adjust,
        hardConstraints: reviewPlan.hardConstraints,
        preferredContinuity: reviewPlan.preferredContinuity,
        issueTypes: issues.map(issue => issue.type)
      },
      revisionReason: 'The generated image payload did not contain a renderable URL.',
      revisedPrompt: `${prompt.trim()}\n\nRevision note: regenerate the same scene and ensure a valid renderable image output is returned.`,
      reviewPlan,
      requiresAction: asset.type === 'IMAGE'
        ? undefined
        : {
          type: 'inspect_generation_payload',
          message: 'This result is incomplete. I have a recovery path, and you can decide whether I should continue.',
          payload: buildRequiresActionPayload(prompt, {
            summary: 'The result payload is incomplete. I can keep the intended direction, but this case needs a manual decision before I continue.',
            warnings,
            revisedPrompt: undefined,
            reviewPlan
          }, {
            message: {
              zh: '这次结果输出不完整。我已经想好恢复方案，你决定是否让我继续即可。',
              en: 'This result is incomplete. I have a recovery path, and you can decide whether I should continue.'
            }
          }, {
            assetType: asset.type
          })
        }
    };
  }

  if (asset.type === 'VIDEO' && !asset.videoUri) {
    warnings.push('Generated video is missing a reusable videoUri for extension workflows.');
  }

  return {
    decision: 'accept',
    summary: warnings.length > 0
      ? 'Generated asset passed runtime review with warnings.'
      : 'Generated asset passed runtime review.',
    warnings,
    issues: warnings.length > 0 ? [{
      type: 'other',
      severity: 'low',
      confidence: 'medium',
      autoFixable: false,
      title: 'Follow-up extension metadata is incomplete',
      detail: warnings[0],
      relatedConstraint: 'video_extension'
    }] : [],
    quality: undefined,
    reviewTrace: {
      rawDecision: 'accept',
      finalDecision: 'accept',
      summary: warnings.length > 0
        ? 'Generated asset passed runtime review with warnings.'
        : 'Generated asset passed runtime review.',
      reason: warnings.length > 0 ? warnings[0] : 'No critical runtime issues detected.',
      actionType: warnings.length > 0 ? 'continue_optimization' : undefined,
      preserve: ['overall scene', 'visual direction'],
      adjust: warnings.length > 0 ? ['minor technical cleanup'] : ['none'],
      preferredContinuity: ['overall scene', 'visual direction'],
      issueTypes: warnings.length > 0 ? ['other'] : []
    },
    reviewPlan: buildOptimizationPlan({
      summary: warnings.length > 0
        ? 'The result is usable. I would preserve the overall scene and only make minor technical cleanups if you ask.'
        : 'The result is complete and does not need manual intervention.',
      adjust: warnings.length > 0 ? ['minor technical cleanup'] : ['none'],
      confidence: warnings.length > 0 ? 'medium' : 'high',
      executionMode: warnings.length > 0 ? 'guided' : 'auto',
      issueTypes: warnings.length > 0 ? ['other'] : [],
      preferredContinuity: ['overall scene', 'visual direction'],
      localized: {
        zh: {
          summary: warnings.length > 0
            ? '当前结果可以使用。如果你需要，我会保持整体场景不变，只做轻微技术优化。'
            : '当前结果已经完整，不需要额外人工介入。',
          preserve: ['整体场景', '视觉方向'],
          adjust: warnings.length > 0 ? ['轻微技术优化'] : ['无需额外调整']
        },
        en: {
          summary: warnings.length > 0
            ? 'The result is usable. I would preserve the overall scene and only make minor technical cleanups if you ask.'
            : 'The result is complete and does not need manual intervention.',
          preserve: ['overall scene', 'visual direction'],
          adjust: warnings.length > 0 ? ['minor technical cleanup'] : ['none']
        }
      }
    })
  };
};

export const reviewGeneratedAsset = async (
  asset: AssetItem,
  prompt: string,
  context?: ImageCriticContextInput,
  deps: {
    normalizeImageUrl?: (url: string) => Promise<string | null | undefined>;
    reviewGeneratedImage?: (
      prompt: string,
      data: string,
      mimeType: string,
      context?: ImageCriticContextInput
    ) => Promise<StructuredCriticReview>;
  } = {}
): Promise<LocalReviewResult> => {
  if (asset.type !== 'IMAGE' || !asset.url) {
    return reviewGeneratedAssetLocally(asset, prompt);
  }

  try {
    const normalizedUrl = await (deps.normalizeImageUrl || normalizeImageUrlForChat)(asset.url);
    if (!normalizedUrl) {
      return reviewGeneratedAssetLocally(asset, prompt);
    }
    const inlineImage = dataUrlToInlineImage(normalizedUrl);
    if (!inlineImage) {
      return reviewGeneratedAssetLocally(asset, prompt);
    }

    const critic = await (deps.reviewGeneratedImage || reviewGeneratedImageWithAI)(
      prompt,
      inlineImage.data,
      inlineImage.mimeType,
      context
    );
    return criticToLocalReview(prompt, critic, 'review_output', context);
  } catch (error) {
    console.warn('[assetReviewRuntime] AI critic review failed, falling back to local review.', error);
    return reviewGeneratedAssetLocally(asset, prompt);
  }
};

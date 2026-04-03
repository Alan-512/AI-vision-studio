import { describe, expect, it } from 'vitest';
import { AssistantMode } from '../types';
import {
  buildImageCriticContext,
  applyImageCriticCalibration,
  buildImageCriticContextText,
  parseImageCriticCalibration,
  parseImageCriticReview,
  reviewGeneratedImageWithAI
} from '../services/imageCriticService';

describe('imageCriticService', () => {
  it('builds critic context text from runtime constraints', () => {
    const text = buildImageCriticContextText({
      assistantMode: AssistantMode.PRODUCT_SHOT,
      searchFacts: ['Brand: Red Bull Energy Drink'],
      referenceHints: ['1 reference image was used for product identity'],
      hardConstraints: ['keep the product commercially recognizable'],
      preferredContinuity: ['composition', 'lighting'],
      negativePrompt: 'blurry, logo distortion'
    });

    expect(text).toContain('assistant_mode: PRODUCT_SHOT');
    expect(text).toContain('Brand: Red Bull Energy Drink');
    expect(text).toContain('keep the product commercially recognizable');
    expect(text).toContain('negative_prompt_to_avoid: blurry, logo distortion');
  });

  it('builds critic context input from references, search facts, and consistency profile', () => {
    const context = buildImageCriticContext({
      assistantMode: AssistantMode.PRODUCT_SHOT,
      negativePrompt: 'blurry',
      selectedReferences: [
        { sourceRole: 'user' },
        { sourceRole: 'generated' }
      ],
      consistencyProfile: {
        assistantMode: AssistantMode.POSTER,
        hardConstraints: ['keep logo readable'],
        preferredContinuity: ['composition'],
        preserveSignals: ['brand silhouette'],
        updatedAt: 1710000000000,
        referenceCount: 2
      },
      searchContext: {
        facts: [
          { item: 'Brand color is red', source: 'brand guide' },
          { item: 'Can shape is slim' }
        ]
      }
    });

    expect(context.assistantMode).toBe(AssistantMode.PRODUCT_SHOT);
    expect(context.negativePrompt).toBe('blurry');
    expect(context.referenceHints).toEqual([
      '2 reference image(s) were used for this generation.',
      'User-provided reference should influence subject, style, or composition continuity.',
      'Prior generated image should be treated as follow-up continuity context.'
    ]);
    expect(context.searchFacts).toEqual([
      'Brand color is red (brand guide)',
      'Can shape is slim'
    ]);
    expect(context.hardConstraints).toEqual(['keep logo readable']);
    expect(context.preferredContinuity).toEqual(['composition']);
    expect(context.consistencyProfile?.preserveSignals).toEqual(['brand silhouette']);
  });

  it('applies calibration guidance on top of the primary critic review', async () => {
    const responses = [
      {
        text: JSON.stringify({
          decision: 'auto_revise',
          summary: 'Base review',
          reason: 'Initial review',
          recommendedActionType: 'continue_optimization',
          issues: [],
          quality: {
            intentAlignment: 4,
            compositionStrength: 4,
            lightingQuality: 4,
            materialFidelity: 4,
            brandAccuracy: 4,
            aestheticFinish: 4,
            commercialReadiness: 4,
            note: 'Strong'
          },
          reviewPlan: {
            summary: 'Improve polish',
            preserve: ['composition'],
            adjust: ['finish'],
            confidence: 'medium',
            executionMode: 'auto',
            issueTypes: [],
            hardConstraints: [],
            preferredContinuity: [],
            localized: {
              zh: { summary: '优化质感', preserve: ['构图'], adjust: ['质感'] },
              en: { summary: 'Improve polish', preserve: ['composition'], adjust: ['finish'] }
            }
          },
          revisedPrompt: 'refined prompt'
        })
      },
      {
        text: JSON.stringify({
          decision: 'requires_action',
          reason: 'Needs confirmation',
          confidence: 'high',
          recommendedActionType: 'confirm_refinement_scope',
          executionMode: 'guided',
          userFacing: {
            zh: { title: '先确认范围', message: '这一步会明显影响构图。' },
            en: { title: 'Confirm scope', message: 'This will materially affect composition.' }
          }
        })
      }
    ];

    const review = await reviewGeneratedImageWithAI(
      'poster prompt',
      'abc123',
      'image/png',
      undefined,
      {
        generateContent: async () => responses.shift() ?? { text: '' }
      }
    );

    expect(review.decision).toBe('requires_action');
    expect(review.recommendedActionType).toBe('confirm_refinement_scope');
    expect(review.reviewPlan.executionMode).toBe('guided');
    expect(review.calibration?.confidence).toBe('high');
  });

  it('parses and applies critic calibration helpers from the critic module', () => {
    const parsedReview = parseImageCriticReview(JSON.stringify({
      decision: 'auto_revise',
      summary: 'Base review',
      issues: [],
      reviewPlan: {
        preserve: ['composition']
      }
    }));
    const parsedCalibration = parseImageCriticCalibration(JSON.stringify({
      decision: 'requires_action',
      confidence: 'high',
      recommendedActionType: 'confirm_refinement_scope',
      executionMode: 'guided',
      userFacing: {
        zh: { title: '先确认范围', message: '这一步会明显影响构图。' },
        en: { title: 'Confirm scope', message: 'This will materially affect composition.' }
      }
    }));

    expect(parsedReview).toBeTruthy();
    expect(parsedCalibration?.decision).toBe('requires_action');

    const merged = applyImageCriticCalibration(parsedReview!, parsedCalibration);
    expect(merged.decision).toBe('requires_action');
    expect(merged.reviewPlan.executionMode).toBe('guided');
  });
});

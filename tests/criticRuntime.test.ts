import { describe, expect, it } from 'vitest';
import { normalizeStructuredCriticReview, buildRevisionPromptFromPlan } from '../services/criticRuntime';
import { AssistantMode, StructuredCriticReview } from '../types';

describe('criticRuntime', () => {
    it('should downgrade unnecessary requires_action decisions to auto_revise when issues are safely fixable', () => {
        const critic: StructuredCriticReview = {
            decision: 'requires_action',
            summary: 'The label is weak but the composition is already good.',
            reason: 'The brand read needs another pass.',
            issues: [
                {
                    type: 'brand_incorrect',
                    severity: 'medium',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Brand read is weak',
                    detail: 'The label needs better fidelity.'
                }
            ],
            reviewPlan: {
                summary: 'Keep the composition and improve the product label.',
                preserve: ['composition'],
                adjust: ['label fidelity'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['brand_incorrect'],
                localized: {}
            },
            recommendedActionType: 'tighten_subject_match'
        };

        const normalized = normalizeStructuredCriticReview('Product shot prompt', critic);

        expect(normalized.decision).toBe('auto_revise');
        expect(normalized.reviewPlan.executionMode).toBe('auto');
        expect(normalized.revisedPrompt).toContain('Keep: composition');
    });

    it('should keep requires_action when issues need user guidance', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'A new reference is needed to continue safely.',
            reason: 'The intended subject variant is under-specified.',
            issues: [
                {
                    type: 'needs_reference',
                    severity: 'high',
                    confidence: 'medium',
                    autoFixable: false,
                    title: 'Needs reference',
                    detail: 'The requested subject variation needs a guiding reference.'
                }
            ],
            reviewPlan: {
                summary: 'Pause and request clearer direction before changing the subject.',
                preserve: ['current composition'],
                adjust: ['subject direction'],
                confidence: 'medium',
                executionMode: 'guided',
                issueTypes: ['needs_reference'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Poster prompt', critic);

        expect(normalized.decision).toBe('requires_action');
        expect(normalized.reviewPlan.executionMode).toBe('guided');
        expect(normalized.normalizedActionType).toBe('upload_reference');
    });

    it('should upgrade accept to auto_revise for strong auto-fixable quality issues', () => {
        const critic: StructuredCriticReview = {
            decision: 'accept',
            summary: 'The image is usable but the product label is still not accurate enough.',
            reason: 'The current output is close, but the product label should be corrected before final acceptance.',
            issues: [
                {
                    type: 'brand_incorrect',
                    severity: 'high',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Brand label mismatch',
                    detail: 'The label text and logo need stronger fidelity.'
                }
            ],
            reviewPlan: {
                summary: 'Keep the product shot and tighten the label fidelity.',
                preserve: ['composition', 'lighting'],
                adjust: ['label fidelity'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['brand_incorrect'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Premium product shot prompt', critic);

        expect(normalized.decision).toBe('auto_revise');
        expect(normalized.normalizedDecisionReason).toContain('product label');
        expect(normalized.normalizedActionType).toBe('tighten_brand_match');
    });

    it('should recommend a focused action type for guided constraint conflicts', () => {
        const critic: StructuredCriticReview = {
            decision: 'requires_action',
            summary: 'The generated result conflicts with the known product constraints.',
            issues: [
                {
                    type: 'constraint_conflict',
                    severity: 'high',
                    confidence: 'high',
                    autoFixable: false,
                    title: 'Constraint conflict',
                    detail: 'The current image contradicts the known product packaging constraints.'
                }
            ],
            reviewPlan: {
                summary: 'Pause and confirm which constraint should dominate before another revision.',
                preserve: ['current composition'],
                adjust: ['constraint priority'],
                confidence: 'high',
                executionMode: 'guided',
                issueTypes: ['constraint_conflict'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Product poster prompt', critic);

        expect(normalized.decision).toBe('requires_action');
        expect(normalized.normalizedActionType).toBe('clarify_constraints');
        expect(normalized.normalizedDecisionReason).toContain('constraint conflict');
    });

    it('should build revision prompts that preserve continuity constraints', () => {
        const prompt = buildRevisionPromptFromPlan(
            'Generate a premium product shot',
            {
                summary: 'Preserve the current shot and improve material fidelity.',
                preserve: ['current composition'],
                adjust: ['material rendering'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['material_weak'],
                localized: {}
            },
            [
                {
                    type: 'material_weak',
                    severity: 'medium',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Material rendering is weak',
                    detail: 'The bottle surface needs clearer material definition.'
                }
            ],
            {
                consistencyProfile: {
                    preserveSignals: ['product silhouette'],
                    hardConstraints: ['keep the product commercially recognizable'],
                    preferredContinuity: ['lighting direction'],
                    updatedAt: Date.now(),
                    assistantMode: AssistantMode.PRODUCT_SHOT
                }
            }
        );

        expect(prompt).toContain('Keep: current composition');
        expect(prompt).toContain('Keep: product silhouette');
        expect(prompt).toContain('Constraint: keep the product commercially recognizable');
        expect(prompt).toContain('Focus: Improve material rendering and product surface definition.');
    });
});

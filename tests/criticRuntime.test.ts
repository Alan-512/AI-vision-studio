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
        expect(normalized.reviewPlan.revisionStrength).toBe('targeted');
        expect(normalized.revisedPrompt).toContain('Keep: composition');
        expect(normalized.reviewTrace.rawDecision).toBe('requires_action');
        expect(normalized.reviewTrace.finalDecision).toBe('auto_revise');
        expect(normalized.reviewTrace.revisionStrength).toBe('targeted');
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
        expect(normalized.reviewPlan.revisionStrength).toBe('targeted');
        expect(normalized.normalizedActionType).toBe('upload_reference');
        expect(normalized.reviewTrace.primaryIssue?.type).toBe('needs_reference');
    });

    it('should respect calibrated requires_action decisions even when the issue is auto-fixable', () => {
        const critic: StructuredCriticReview = {
            decision: 'requires_action',
            summary: 'A stronger correction is possible, but it would change the brand direction materially.',
            reason: 'The next revision should be confirmed before it changes the current brand read.',
            issues: [
                {
                    type: 'brand_incorrect',
                    severity: 'medium',
                    confidence: 'medium',
                    autoFixable: true,
                    title: 'Brand direction may drift',
                    detail: 'A stronger correction would materially change the current label direction.'
                }
            ],
            reviewPlan: {
                summary: 'Keep the composition and confirm whether the brand direction should change.',
                preserve: ['current composition'],
                adjust: ['brand direction'],
                confidence: 'high',
                executionMode: 'guided',
                issueTypes: ['brand_incorrect'],
                localized: {}
            },
            calibration: {
                baseDecision: 'auto_revise',
                calibratedDecision: 'requires_action',
                confidence: 'high',
                reason: 'This stronger change should be confirmed with the user first.'
            }
        };

        const normalized = normalizeStructuredCriticReview('Poster prompt', critic);

        expect(normalized.decision).toBe('requires_action');
        expect(normalized.reviewTrace.rawDecision).toBe('auto_revise');
        expect(normalized.reviewTrace.calibratedDecision).toBe('requires_action');
        expect(normalized.reviewTrace.calibrationConfidence).toBe('high');
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
        expect(normalized.reviewPlan.revisionStrength).toBe('aggressive');
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
        expect(normalized.reviewTrace.actionType).toBe('clarify_constraints');
        expect(normalized.reviewTrace.revisionStrength).toBe('targeted');
    });

    it('should generate issue-aware fallback card copy for brand direction cases', () => {
        const critic: StructuredCriticReview = {
            decision: 'requires_action',
            summary: 'The overall shot works, but the next correction would materially change the brand direction.',
            issues: [
                {
                    type: 'brand_incorrect',
                    severity: 'high',
                    confidence: 'high',
                    autoFixable: false,
                    title: 'Brand direction may drift',
                    detail: 'The label system is off-brand enough that the next pass should be confirmed.',
                    fixScope: 'subject',
                    evidence: ['The silhouette is correct, but the label block still reads like a different brand.']
                }
            ],
            reviewPlan: {
                summary: 'Keep the shot and confirm the intended brand correction direction.',
                preserve: ['composition', 'lighting'],
                adjust: ['brand direction'],
                confidence: 'high',
                executionMode: 'guided',
                issueTypes: ['brand_incorrect'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Luxury can poster', critic);

        expect(normalized.userFacing?.zh?.title).toContain('品牌');
        expect(normalized.userFacing?.en?.title).toContain('Brand');
        expect(normalized.userFacing?.zh?.message).toContain('标签');
        expect(normalized.userFacing?.en?.message).toContain('label block');
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
        expect(prompt).toContain('Strength: light');
        expect(prompt).toContain('Scope: Apply a light-touch correction only.');
    });

    it('should keep material cleanup lightweight when the issue is surface-level', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'The product surface needs a cleaner finish.',
            issues: [
                {
                    type: 'material_weak',
                    severity: 'medium',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Material rendering is weak',
                    detail: 'The bottle material lacks crisp surface definition.'
                }
            ],
            reviewPlan: {
                summary: 'Keep the shot and improve surface rendering.',
                preserve: ['current composition', 'lighting direction'],
                adjust: ['surface definition'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['material_weak'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Studio product shot', critic);

        expect(normalized.reviewPlan.revisionStrength).toBe('light');
        expect(normalized.revisedPrompt).toContain('Strength: light');
        expect(normalized.revisedPrompt).toContain('Scope: Apply a light-touch correction only.');
    });

    it('should allow stronger correction for high-confidence subject mismatches', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'The overall style is correct, but the subject identity is wrong.',
            issues: [
                {
                    type: 'subject_mismatch',
                    severity: 'high',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Subject identity mismatch',
                    detail: 'The generated subject does not match the requested product identity.'
                }
            ],
            reviewPlan: {
                summary: 'Preserve the atmosphere and correct the subject identity.',
                preserve: ['lighting mood', 'camera distance'],
                adjust: ['subject identity'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['subject_mismatch'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('High-end hero product image', critic);

        expect(normalized.reviewPlan.revisionStrength).toBe('aggressive');
        expect(normalized.reviewTrace.revisionStrength).toBe('aggressive');
        expect(normalized.revisedPrompt).toContain('Strength: aggressive');
        expect(normalized.revisedPrompt).toContain('Scope: Prioritize fixing the main mismatch decisively.');
    });

    it('should use issue evidence and layout scope to drive stronger composition revisions', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'The composition feels cramped and the product has lost hierarchy.',
            issues: [
                {
                    type: 'composition_weak',
                    severity: 'medium',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Composition hierarchy is weak',
                    detail: 'The crop is too tight and the product lacks breathing room.',
                    fixScope: 'layout',
                    evidence: ['The product touches the frame edge.', 'Negative space is too limited for a premium poster feel.']
                }
            ],
            reviewPlan: {
                summary: 'Open up the layout while keeping the existing visual direction.',
                preserve: ['lighting mood', 'product identity'],
                adjust: ['layout hierarchy', 'negative space'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['composition_weak'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Luxury poster prompt', critic);

        expect(normalized.reviewPlan.revisionStrength).toBe('aggressive');
        expect(normalized.reviewTrace.primaryIssue?.fixScope).toBe('layout');
        expect(normalized.reviewTrace.primaryIssue?.evidence?.[0]).toContain('frame edge');
        expect(normalized.revisedPrompt).toContain('Evidence: The product touches the frame edge.');
        expect(normalized.revisedPrompt).toContain('Evidence: Negative space is too limited for a premium poster feel.');
    });

    it('should accept commercially polished results instead of over-revising minor issues', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'The image is strong, with only minor surface cleanup remaining.',
            issues: [
                {
                    type: 'material_weak',
                    severity: 'low',
                    confidence: 'medium',
                    autoFixable: true,
                    title: 'Minor surface cleanup',
                    detail: 'A small amount of extra crispness could still help the finish.',
                    fixScope: 'local'
                }
            ],
            quality: {
                intentAlignment: 5,
                compositionStrength: 5,
                lightingQuality: 4,
                materialFidelity: 4,
                brandAccuracy: 5,
                aestheticFinish: 4,
                commercialReadiness: 5
            },
            reviewPlan: {
                summary: 'Keep the image and only polish the surface slightly.',
                preserve: ['composition', 'lighting', 'brand read'],
                adjust: ['minor surface polish'],
                confidence: 'medium',
                executionMode: 'auto',
                issueTypes: ['material_weak'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Premium hero product shot', critic);

        expect(normalized.decision).toBe('accept');
        expect(normalized.revisedPrompt).toBeUndefined();
    });

    it('should not accept results that still contain high-severity issues even with good quality scores', () => {
        const critic: StructuredCriticReview = {
            decision: 'auto_revise',
            summary: 'The shot is attractive, but the brand label is still wrong.',
            issues: [
                {
                    type: 'brand_incorrect',
                    severity: 'high',
                    confidence: 'high',
                    autoFixable: true,
                    title: 'Brand label mismatch',
                    detail: 'The overall shot looks polished, but the label still reads incorrectly.',
                    fixScope: 'subject'
                }
            ],
            quality: {
                intentAlignment: 4,
                compositionStrength: 5,
                lightingQuality: 5,
                materialFidelity: 4,
                brandAccuracy: 2,
                aestheticFinish: 4,
                commercialReadiness: 4
            },
            reviewPlan: {
                summary: 'Preserve the shot and correct the label fidelity.',
                preserve: ['composition', 'lighting'],
                adjust: ['label fidelity'],
                confidence: 'high',
                executionMode: 'auto',
                issueTypes: ['brand_incorrect'],
                localized: {}
            }
        };

        const normalized = normalizeStructuredCriticReview('Commercial can shot', critic);

        expect(normalized.decision).toBe('auto_revise');
    });
});

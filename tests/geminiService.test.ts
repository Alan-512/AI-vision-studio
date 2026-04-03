import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    saveUserApiKey,
    getUserApiKey,
    removeUserApiKey,
    stripVisibleToolPlanningText
} from '../services/geminiService';
import { applyImageCriticCalibration, buildImageCriticContextText, parseImageCriticCalibration, parseImageCriticReview } from '../services/imageCriticService';
import { AssistantMode } from '../types';

describe('GeminiService', () => {

    describe('API Key Management', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        afterEach(() => {
            localStorage.clear();
        });

        it('should save API key to localStorage', () => {
            saveUserApiKey('test-api-key-123');
            expect(localStorage.getItem('user_gemini_api_key')).toBe('test-api-key-123');
        });

        it('should retrieve saved API key', () => {
            localStorage.setItem('user_gemini_api_key', 'my-secret-key');
            expect(getUserApiKey()).toBe('my-secret-key');
        });

        it('should return null for missing API key', () => {
            expect(getUserApiKey()).toBeFalsy();
        });

        it('should remove API key from localStorage', () => {
            localStorage.setItem('user_gemini_api_key', 'key-to-remove');
            removeUserApiKey();
            expect(localStorage.getItem('user_gemini_api_key')).toBeFalsy();
        });
    });

    describe('stripVisibleToolPlanningText', () => {
        it('should remove leaked generate_image planning JSON from visible assistant text', () => {
            const raw = `This direction looks strong overall.\n\n{\n  "action": "generate_image",\n  "parameters": {\n    "prompt": "A premium metallic can on a matte surface",\n    "model": "gemini-3.1-flash-image-preview"\n  }\n}`;

            expect(stripVisibleToolPlanningText(raw)).toBe('This direction looks strong overall.');
        });
    });

    describe('parseImageCriticReview', () => {
        it('should parse a structured critic response', () => {
            const review = parseImageCriticReview(JSON.stringify({
                decision: 'auto_revise',
                summary: 'The bottle shape is correct but the brand read is weak.',
                reason: 'The label is not distinct enough.',
                recommendedActionType: 'tighten_subject_match',
                issues: [
                    {
                        type: 'brand_incorrect',
                        severity: 'medium',
                        confidence: 'high',
                        autoFixable: true,
                        title: 'Brand match is weak',
                        detail: 'The product silhouette is right, but the label is not convincing.',
                        fixScope: 'subject',
                        evidence: ['The bottle silhouette matches, but the label block is soft and off-brand.']
                    }
                ],
                quality: {
                    intentAlignment: 4,
                    compositionStrength: 5,
                    lightingQuality: 4,
                    materialFidelity: 3,
                    brandAccuracy: 2,
                    aestheticFinish: 4,
                    commercialReadiness: 3,
                    note: 'Strong composition, but the product branding still feels under-resolved.'
                },
                reviewPlan: {
                    summary: 'Keep the composition and improve the label fidelity.',
                    preserve: ['composition', 'lighting'],
                    adjust: ['label fidelity'],
                    confidence: 'high',
                    executionMode: 'auto',
                    issueTypes: ['brand_incorrect'],
                    hardConstraints: ['preserve current composition'],
                    preferredContinuity: ['lighting'],
                    localized: {
                        zh: {
                            summary: '保持构图不变，提升标签还原度。',
                            preserve: ['构图'],
                            adjust: ['标签还原度']
                        },
                        en: {
                            summary: 'Keep the composition and improve the label fidelity.',
                            preserve: ['composition'],
                            adjust: ['label fidelity']
                        }
                    }
                },
                revisedPrompt: 'Refine the same product shot with a more accurate label.'
            }));

            expect(review?.decision).toBe('auto_revise');
            expect(review?.issues).toHaveLength(1);
            expect(review?.issues[0].type).toBe('brand_incorrect');
            expect(review?.issues[0].fixScope).toBe('subject');
            expect(review?.issues[0].evidence?.[0]).toContain('label block');
            expect(review?.quality?.brandAccuracy).toBe(2);
            expect(review?.quality?.compositionStrength).toBe(5);
            expect(review?.reviewPlan.executionMode).toBe('auto');
            expect(review?.reviewPlan.localized?.zh?.summary).toContain('构图');
        });

        it('should sanitize invalid critic response values', () => {
            const review = parseImageCriticReview(JSON.stringify({
                decision: 'invalid',
                issues: [{ type: 'not_real', severity: 'extreme', confidence: 'sure', title: '', detail: '' }],
                reviewPlan: { preserve: ['composition'] }
            }));

            expect(review?.decision).toBe('requires_action');
            expect(review?.issues[0].type).toBe('other');
            expect(review?.issues[0].severity).toBe('medium');
            expect(review?.reviewPlan.summary.length).toBeGreaterThan(0);
        });
    });

    describe('buildImageCriticContextText', () => {
        it('should include runtime constraints for critic evaluation', () => {
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
    });

    describe('parseImageCriticCalibration', () => {
        it('should parse a structured calibration response', () => {
            const calibration = parseImageCriticCalibration(JSON.stringify({
                decision: 'requires_action',
                reason: 'Changing the brand direction would be a stronger intervention than the user explicitly asked for.',
                confidence: 'high',
                recommendedActionType: 'confirm_brand_direction',
                executionMode: 'guided',
                userFacing: {
                    zh: {
                        title: '我建议先确认品牌方向',
                        message: '我已经整理好了可行的优化方向，但这一步会明显改变品牌呈现，最好先由你确认。'
                    },
                    en: {
                        title: 'I Recommend Confirming the Brand Direction',
                        message: 'I have a clear refinement path, but this change would materially alter the brand read, so it is better to confirm first.'
                    }
                }
            }));

            expect(calibration?.decision).toBe('requires_action');
            expect(calibration?.confidence).toBe('high');
            expect(calibration?.recommendedActionType).toBe('confirm_brand_direction');
            expect(calibration?.userFacing?.zh?.title).toContain('品牌方向');
        });
    });

    describe('applyImageCriticCalibration', () => {
        it('should merge calibrated interruption guidance into the critic review', () => {
            const merged = applyImageCriticCalibration({
                decision: 'auto_revise',
                summary: 'The composition is strong but the brand read may drift.',
                issues: [
                    {
                        type: 'brand_incorrect',
                        severity: 'medium',
                        confidence: 'medium',
                        autoFixable: true,
                        title: 'Brand direction may drift',
                        detail: 'A stronger revision could change the intended label direction.'
                    }
                ],
                quality: {
                    intentAlignment: 4,
                    compositionStrength: 5,
                    lightingQuality: 4,
                    materialFidelity: 4,
                    brandAccuracy: 2,
                    aestheticFinish: 4,
                    commercialReadiness: 3,
                    note: 'Brand fidelity still lags behind the overall shot quality.'
                },
                reviewPlan: {
                    summary: 'Keep the composition and improve the brand read.',
                    preserve: ['composition'],
                    adjust: ['brand direction'],
                    confidence: 'medium',
                    executionMode: 'auto',
                    localized: {}
                },
                recommendedActionType: 'tighten_brand_match'
            }, {
                decision: 'requires_action',
                reason: 'A stronger brand correction should be confirmed before continuing.',
                confidence: 'high',
                recommendedActionType: 'confirm_brand_direction',
                executionMode: 'guided',
                userFacing: {
                    zh: {
                        title: '我建议先确认品牌方向',
                        message: '这一步会明显改变品牌呈现，最好先确认。'
                    }
                }
            });

            expect(merged.decision).toBe('requires_action');
            expect(merged.reviewPlan.executionMode).toBe('guided');
            expect(merged.recommendedActionType).toBe('confirm_brand_direction');
            expect(merged.calibration?.baseDecision).toBe('auto_revise');
            expect(merged.calibration?.calibratedDecision).toBe('requires_action');
            expect(merged.userFacing?.zh?.title).toContain('品牌方向');
            expect(merged.quality?.brandAccuracy).toBe(2);
            expect(merged.quality?.compositionStrength).toBe(5);
        });
    });
});

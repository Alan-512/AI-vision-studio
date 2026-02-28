import { describe, it, expect } from 'vitest';
import {
    SKILLS,
    getSkill,
    getPromptOptimizerContent,
    getRoleInstruction,
    getAllSkills
} from '../services/skills/index';
import { buildSystemInstruction, validateSkills } from '../services/skills/promptRouter';
import { AppMode, SmartAssetRole, ImageModel, AspectRatio, GenerationParams } from '../types';

describe('Skill System', () => {

    describe('SKILLS Registry', () => {
        it('should have CORE_IDENTITY skill', () => {
            expect(SKILLS.CORE_IDENTITY).toBeDefined();
            expect(SKILLS.CORE_IDENTITY.id).toBe('core-identity');
            expect(SKILLS.CORE_IDENTITY.triggerType).toBe('always');
        });

        it('should have WORKFLOW skill', () => {
            expect(SKILLS.WORKFLOW).toBeDefined();
            expect(SKILLS.WORKFLOW.content).toContain('UNDERSTAND');
        });

        it('should have CRITICAL_RULES skill', () => {
            expect(SKILLS.CRITICAL_RULES).toBeDefined();
        });

        it('should have PROTOCOL_IMAGE_GEN skill', () => {
            expect(SKILLS.PROTOCOL_IMAGE_GEN).toBeDefined();
            expect(SKILLS.PROTOCOL_IMAGE_GEN.triggerType).toBe('mode');
        });

        it('should have PROMPT_OPTIMIZER_IMAGE skill', () => {
            expect(SKILLS.PROMPT_OPTIMIZER_IMAGE).toBeDefined();
            expect(SKILLS.PROMPT_OPTIMIZER_IMAGE.content).toContain('CRITICAL RULES');
        });

        it('should have PROMPT_OPTIMIZER_VIDEO skill', () => {
            expect(SKILLS.PROMPT_OPTIMIZER_VIDEO).toBeDefined();
            expect(SKILLS.PROMPT_OPTIMIZER_VIDEO.content).toContain('Veo');
        });

        it('should have CONTEXT_OPTIMIZATION skill', () => {
            expect(SKILLS.CONTEXT_OPTIMIZATION).toBeDefined();
            expect(SKILLS.CONTEXT_OPTIMIZATION.triggerType).toBe('keyword');
            expect(SKILLS.CONTEXT_OPTIMIZATION.keywords).toContain('?');
        });
    });

    describe('getSkill', () => {
        it('should return skill by id', () => {
            const skill = getSkill('CORE_IDENTITY');
            expect(skill).toBeDefined();
            expect(skill?.name).toBe('Core Identity');
        });

        it('should return undefined for unknown id', () => {
            const skill = getSkill('unknown-skill');
            expect(skill).toBeUndefined();
        });
    });

    describe('getPromptOptimizerContent', () => {
        it('should return image optimizer for IMAGE mode', () => {
            const content = getPromptOptimizerContent(AppMode.IMAGE);
            expect(content).toContain('Gemini Image');
            expect(content).toContain('NARRATIVE DESCRIPTION');
        });

        it('should return video optimizer for VIDEO mode', () => {
            const content = getPromptOptimizerContent(AppMode.VIDEO);
            expect(content).toContain('Veo');
            expect(content).toContain('camera movement');
        });
    });

    describe('getRoleInstruction', () => {
        it('should return STYLE instruction', () => {
            const instruction = getRoleInstruction(SmartAssetRole.STYLE, 0);
            expect(instruction).toContain('Image 1');
            expect(instruction).toContain('STYLE reference');
        });

        it('should return SUBJECT instruction', () => {
            const instruction = getRoleInstruction(SmartAssetRole.SUBJECT, 1);
            expect(instruction).toContain('Image 2');
            expect(instruction).toContain('SUBJECT reference');
        });

        it('should return COMPOSITION instruction', () => {
            const instruction = getRoleInstruction(SmartAssetRole.COMPOSITION, 2);
            expect(instruction).toContain('Image 3');
            expect(instruction).toContain('COMPOSITION reference');
        });

        it('should return EDIT_BASE instruction', () => {
            const instruction = getRoleInstruction(SmartAssetRole.EDIT_BASE, 0);
            expect(instruction).toContain('EDIT BASE');
        });
    });

    describe('getAllSkills', () => {
        it('should return all skills as array', () => {
            const skills = getAllSkills();
            expect(skills.length).toBeGreaterThan(8);
            expect(skills.every(s => s.id && s.name && s.content)).toBe(true);
        });
    });

    describe('validateSkills', () => {
        it('should return valid for healthy configuration', () => {
            const result = validateSkills();
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should include always-on skills in validation', () => {
            const result = validateSkills();
            // Should not have any errors
            expect(result.errors.length).toBe(0);
        });
    });

    describe('Dynamic Skill Router (Phase 3)', () => {

        it('should load core identity for any mode', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                userMessage: 'Generate a cat'
            });

            expect(result.systemInstruction).toContain('AI Vision Studio');
            expect(result.skills.some(s => s.id === 'core-identity')).toBe(true);
        });

        it('should load always-on skills', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                userMessage: 'Generate a cat'
            });

            expect(result.skills.some(s => s.id === 'workflow')).toBe(true);
            expect(result.skills.some(s => s.id === 'critical-rules')).toBe(true);
        });

        it('should load image protocol for IMAGE mode', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                userMessage: 'Generate a cat'
            });

            expect(result.skills.some(s => s.id === 'protocol-image-gen')).toBe(true);
        });

        it('should NOT load image protocol for VIDEO mode', () => {
            const result = buildSystemInstruction({
                mode: AppMode.VIDEO,
                userMessage: 'Generate a video'
            });

            expect(result.skills.some(s => s.id === 'protocol-image-gen')).toBe(false);
        });

        it('should trigger keyword skills based on message content', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                userMessage: 'What is this?'
            });

            expect(result.skills.some(s => s.id === 'context-optimization')).toBe(true);
        });

        it('should limit keyword skills to max 2', () => {
            // Message with many keyword triggers
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                userMessage: 'What is this? How does it work? Where is it?'
            });

            const keywordSkills = result.skills.filter(s =>
                s.triggerType === 'keyword'
            );
            expect(keywordSkills.length).toBeLessThanOrEqual(2);
        });

        it('should include generation defaults in output', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                params: { imageModel: ImageModel.FLASH_3_1, aspectRatio: AspectRatio.LANDSCAPE } as GenerationParams
            });

            expect(result.systemInstruction).toContain('GENERATION DEFAULTS');
            expect(result.systemInstruction).toContain(ImageModel.FLASH_3_1);
        });

        it('should include search policy in output', () => {
            const result = buildSystemInstruction({
                mode: AppMode.IMAGE,
                useSearch: true,
                useGrounding: true
            });

            expect(result.systemInstruction).toContain('SEARCH POLICY');
        });
    });
});

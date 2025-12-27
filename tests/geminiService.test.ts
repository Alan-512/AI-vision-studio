import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    saveUserApiKey,
    getUserApiKey,
    removeUserApiKey,
    parseFactsFromLLM,
    buildPromptWithFacts,
    StructuredFact
} from '../services/geminiService';

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

    describe('parseFactsFromLLM', () => {
        it('should parse valid JSON with facts and promptDraft', () => {
            const input = JSON.stringify({
                facts: [
                    { item: 'Eiffel Tower', source: 'Located in Paris, France' },
                    { item: 'Built in 1889' }
                ],
                promptDraft: 'A photo of the Eiffel Tower'
            });

            const result = parseFactsFromLLM(input);

            expect(result.facts).toHaveLength(2);
            expect(result.facts[0].item).toBe('Eiffel Tower');
            expect(result.facts[0].source).toBe('Located in Paris, France');
            expect(result.facts[1].item).toBe('Built in 1889');
            expect(result.promptDraft).toBe('A photo of the Eiffel Tower');
        });

        it('should return empty facts for invalid JSON', () => {
            const result = parseFactsFromLLM('not valid json');

            expect(result.facts).toEqual([]);
            expect(result.promptDraft).toBe('');
        });

        it('should handle JSON without facts array', () => {
            const result = parseFactsFromLLM('{"other": "data"}');

            expect(result.facts).toEqual([]);
        });

        it('should handle empty string input', () => {
            const result = parseFactsFromLLM('');

            expect(result.facts).toEqual([]);
            expect(result.promptDraft).toBe('');
        });
    });

    describe('buildPromptWithFacts', () => {
        it('should return raw prompt when no facts provided', () => {
            const result = buildPromptWithFacts('Generate a cat', []);
            expect(result).toBe('Generate a cat');
        });

        it('should append facts to prompt', () => {
            const facts: StructuredFact[] = [
                { item: 'Cat breeds', source: 'Persian, Siamese, Maine Coon' }
            ];

            const result = buildPromptWithFacts('Generate a cat', facts);

            expect(result).toContain('Generate a cat');
            expect(result).toContain('Reference Notes:');
            expect(result).toContain('Cat breeds: Persian, Siamese, Maine Coon');
        });

        it('should handle facts without source', () => {
            const facts: StructuredFact[] = [
                { item: 'Orange tabby cat' }
            ];

            const result = buildPromptWithFacts('A cute cat', facts);

            expect(result).toContain('- Orange tabby cat');
        });

        it('should format multiple facts correctly', () => {
            const facts: StructuredFact[] = [
                { item: 'Sunset colors', source: 'Orange, pink, purple' },
                { item: 'Beach location', source: 'Malibu, California' },
                { item: 'Golden hour' }
            ];

            const result = buildPromptWithFacts('Beach sunset', facts);

            expect(result).toContain('- Sunset colors: Orange, pink, purple');
            expect(result).toContain('- Beach location: Malibu, California');
            expect(result).toContain('- Golden hour');
        });

        it('should trim whitespace from prompt', () => {
            const result = buildPromptWithFacts('  spaced prompt  ', []);
            expect(result).toBe('spaced prompt');
        });
    });
});

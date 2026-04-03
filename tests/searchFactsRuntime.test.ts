import { describe, expect, it } from 'vitest';
import {
  buildPromptWithFacts,
  parseFactsFromLLM,
  type StructuredFact
} from '../services/searchFactsRuntime';

describe('searchFactsRuntime', () => {
  describe('parseFactsFromLLM', () => {
    it('parses valid JSON with facts and promptDraft', () => {
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

    it('returns empty facts for invalid JSON', () => {
      const result = parseFactsFromLLM('not valid json');

      expect(result.facts).toEqual([]);
      expect(result.promptDraft).toBe('');
    });

    it('handles JSON without facts array', () => {
      const result = parseFactsFromLLM('{"other": "data"}');

      expect(result.facts).toEqual([]);
    });

    it('handles empty string input', () => {
      const result = parseFactsFromLLM('');

      expect(result.facts).toEqual([]);
      expect(result.promptDraft).toBe('');
    });
  });

  describe('buildPromptWithFacts', () => {
    it('returns raw prompt when no facts provided', () => {
      const result = buildPromptWithFacts('Generate a cat', []);
      expect(result).toBe('Generate a cat');
    });

    it('appends facts to prompt', () => {
      const facts: StructuredFact[] = [
        { item: 'Cat breeds', source: 'Persian, Siamese, Maine Coon' }
      ];

      const result = buildPromptWithFacts('Generate a cat', facts);

      expect(result).toContain('Generate a cat');
      expect(result).toContain('Reference Notes:');
      expect(result).toContain('Cat breeds: Persian, Siamese, Maine Coon');
    });

    it('handles facts without source', () => {
      const facts: StructuredFact[] = [
        { item: 'Orange tabby cat' }
      ];

      const result = buildPromptWithFacts('A cute cat', facts);

      expect(result).toContain('- Orange tabby cat');
    });

    it('formats multiple facts correctly', () => {
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

    it('trims whitespace from prompt', () => {
      const result = buildPromptWithFacts('  spaced prompt  ', []);
      expect(result).toBe('spaced prompt');
    });
  });
});

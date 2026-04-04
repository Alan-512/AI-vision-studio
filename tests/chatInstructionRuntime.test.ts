import { describe, expect, it } from 'vitest';
import { buildChatResponseConfig, buildRetrievedContextSection, mergeChatSystemInstruction } from '../services/chatInstructionRuntime';

describe('chatInstructionRuntime', () => {
  it('builds retrieved context section from search facts and prompt draft', () => {
    const section = buildRetrievedContextSection({
      searchFacts: [{ item: 'Brand', source: 'Blue can' }],
      searchPromptDraft: 'Blue can poster'
    });

    expect(section).toContain('RETRIEVED CONTEXT FROM SEARCH');
    expect(section).toContain('Brand: Blue can');
    expect(section).toContain('Blue can poster');
  });

  it('merges context, retrieved facts, and memory into system instruction', () => {
    const result = mergeChatSystemInstruction({
      builtInstruction: '[PROJECT CONTEXT]\nBase',
      contextPart: '\n[CONVERSATION CONTEXT]\nprior',
      retrievedContextSection: 'retrieved',
      memorySnippet: 'memory'
    });

    expect(result).toContain('prior');
    expect(result).toContain('retrieved');
    expect(result).toContain('memory');
  });

  it('builds response config for image mode with thinking config', () => {
    const config = buildChatResponseConfig({
      systemInstruction: 'system',
      isImageMode: true,
      allowSearch: false,
      isReasoning: true,
      imageTools: [{ functionDeclarations: [{ name: 'generate_image' }] }],
      searchTools: [{ googleSearch: {} }]
    });

    expect(config.systemInstruction).toBe('system');
    expect(config.tools).toEqual([{ functionDeclarations: [{ name: 'generate_image' }] }]);
    expect(config.thinkingConfig).toMatchObject({
      thinkingBudget: 4096,
      includeThoughts: true
    });
  });
});

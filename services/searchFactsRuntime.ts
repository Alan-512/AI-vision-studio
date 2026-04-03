export interface StructuredFact {
  item: string;
  source?: string;
}

export const parseFactsFromLLM = (llmOutput: string): { facts: StructuredFact[]; promptDraft: string } => {
  try {
    const data = JSON.parse(llmOutput);
    const facts = Array.isArray(data?.facts) ? data.facts : [];
    const promptDraft = typeof data?.promptDraft === 'string' ? data.promptDraft : '';
    return { facts, promptDraft };
  } catch {
    console.warn('[parseFactsFromLLM] Could not parse structured facts, using empty');
    return { facts: [], promptDraft: '' };
  }
};

export const buildPromptWithFacts = (rawPrompt: string, factsBlock: StructuredFact[]): string => {
  if (!factsBlock || factsBlock.length === 0) return rawPrompt.trim();

  const factsText = factsBlock.map(fact => {
    if (fact.source) {
      return `- ${fact.item}: ${fact.source} `;
    }
    return `- ${fact.item} `;
  }).join('\n');

  return [
    rawPrompt.trim(),
    '',
    '---',
    'Reference Notes:',
    factsText
  ].join('\n');
};

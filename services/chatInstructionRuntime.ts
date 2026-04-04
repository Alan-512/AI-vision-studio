import type { StructuredFact } from './searchFactsRuntime';

export const buildRetrievedContextSection = ({
  searchFacts,
  searchPromptDraft
}: {
  searchFacts: StructuredFact[];
  searchPromptDraft: string;
}) => {
  if (searchFacts.length === 0 && !searchPromptDraft) {
    return '';
  }

  const factsText = searchFacts.map(fact =>
    fact.source ? `• ${fact.item}: ${fact.source}` : `• ${fact.item}`
  ).join('\n');

  return `
    [RETRIEVED CONTEXT FROM SEARCH]
    The following information was retrieved from web search. Use this as your primary source of truth when responding to the user's query:
    
    ${factsText}
    ${searchPromptDraft ? `\n    Suggested visual description: ${searchPromptDraft}` : ''}
    
    IMPORTANT: When generating images, incorporate the visual details from the retrieved context above. Reference specific facts (names, appearances, colors, settings) from this search result.
    `;
};

export const mergeChatSystemInstruction = ({
  builtInstruction,
  contextPart,
  retrievedContextSection,
  memorySnippet
}: {
  builtInstruction: string;
  contextPart?: string;
  retrievedContextSection?: string;
  memorySnippet?: string;
}) => {
  let systemInstruction = builtInstruction;

  if (contextPart) {
    systemInstruction = systemInstruction.replace(
      '[PROJECT CONTEXT]',
      `[PROJECT CONTEXT]\n${contextPart}`
    );
  }

  if (retrievedContextSection) {
    systemInstruction += `\n\n${retrievedContextSection}`;
  }

  if (memorySnippet) {
    systemInstruction += `\n\n${memorySnippet}`;
  }

  return systemInstruction;
};

export const buildChatResponseConfig = ({
  systemInstruction,
  isImageMode,
  allowSearch,
  isReasoning,
  imageTools,
  searchTools
}: {
  systemInstruction: string;
  isImageMode: boolean;
  allowSearch: boolean;
  isReasoning: boolean;
  imageTools: any[];
  searchTools: any[];
}) => {
  const config: any = {
    systemInstruction,
    tools: isImageMode ? imageTools : (allowSearch ? searchTools : undefined)
  };

  if (isReasoning) {
    config.thinkingConfig = {
      thinkingBudget: 4096,
      includeThoughts: true
    };
  }

  return config;
};

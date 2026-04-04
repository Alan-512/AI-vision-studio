import { parseFactsFromLLM, type StructuredFact } from './searchFactsRuntime';

export type SearchSource = { title: string; url: string };
export type SearchProgressResultItem = { label: string; value: string };
export type SearchCompletionProgress = {
  status: 'complete';
  title: string;
  queries: string[];
  results?: SearchProgressResultItem[];
  sources: SearchSource[];
};

export const SEARCH_PHASE_TIMEOUT_MS = 15000;

export const executeSearchPhase = async ({
  ai,
  searchModelName,
  searchContents,
  searchInstruction,
  signal,
  searchTools,
  onSearchProgress,
  language,
  searchTimeoutMs = SEARCH_PHASE_TIMEOUT_MS
}: {
  ai: { models: { generateContentStream: (input: any) => Promise<AsyncIterable<any>> | AsyncIterable<any> } };
  searchModelName: string;
  searchContents: any[];
  searchInstruction: string;
  signal: AbortSignal;
  searchTools: any[];
  onSearchProgress?: (progress: {
    status: 'searching' | 'complete';
    title: string;
    queries: string[];
    results?: SearchProgressResultItem[];
    sources: SearchSource[];
  }) => void;
  language: string;
  searchTimeoutMs?: number;
}) => {
  let searchFullText = '';
  let collectedQueries: string[] = [];
  let hasNotifiedSearchStart = false;
  let collectedSources: SearchSource[] = [];
  let searchTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const searchTimeout = new Promise<never>((_, reject) => {
      searchTimeoutId = setTimeout(() => {
        reject(new Error(`Search phase timed out after ${searchTimeoutMs}ms`));
      }, searchTimeoutMs);
    });
    const searchResult = await Promise.race([
      ai.models.generateContentStream({
        model: searchModelName,
        contents: searchContents,
        config: {
          systemInstruction: searchInstruction,
          tools: searchTools,
          abortSignal: signal
        }
      }),
      searchTimeout
    ]);
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
    }

    for await (const chunk of searchResult) {
      if (signal.aborted) throw new Error('Cancelled');

      const chunkText = chunk.text ?? '';
      if (chunkText) {
        searchFullText += chunkText;
      }

      const candidates = (chunk as any).candidates;
      if (candidates && candidates[0]?.groundingMetadata) {
        const groundingMetadata = candidates[0].groundingMetadata;

        if (!hasNotifiedSearchStart && onSearchProgress) {
          hasNotifiedSearchStart = true;
          onSearchProgress({
            status: 'searching',
            title: language === 'zh' ? '正在搜索中...' : 'Searching...',
            queries: [],
            sources: []
          });
        }

        if (groundingMetadata.webSearchQueries && groundingMetadata.webSearchQueries.length > 0) {
          collectedQueries = [...new Set([...collectedQueries, ...groundingMetadata.webSearchQueries])];
        }

        if (groundingMetadata.groundingChunks) {
          for (const groundingChunk of groundingMetadata.groundingChunks) {
            if (groundingChunk.web?.uri && groundingChunk.web?.title) {
              const exists = collectedSources.some(source => source.url === groundingChunk.web.uri);
              if (!exists) {
                collectedSources.push({ title: groundingChunk.web.title, url: groundingChunk.web.uri });
              }
            }
          }
        }

        if (onSearchProgress && (collectedQueries.length > 0 || collectedSources.length > 0)) {
          onSearchProgress({
            status: 'searching',
            title: language === 'zh' ? '收集关键信息' : 'Gathering key information',
            queries: collectedQueries,
            sources: collectedSources.slice(0, 5)
          });
        }
      }
    }
  } catch (error: any) {
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
    }
    if (signal.aborted || error?.message === 'Cancelled' || error?.name === 'AbortError') {
      throw error;
    }
    console.warn('[Search] Search phase failed, continuing without search context.', error);
    searchFullText = '';
    collectedQueries = [];
    collectedSources = [];
  }

  return {
    searchFullText,
    collectedQueries,
    collectedSources
  };
};

export const buildSearchPhaseInstruction = ({
  contextPart,
  dateStr,
  dateStrEn,
  monthYearEn
}: {
  contextPart: string;
  dateStr: string;
  dateStrEn: string;
  monthYearEn: string;
}) => `You are in SEARCH PHASE for image generation.
    ${contextPart}
    
    [CURRENT DATE]
    Today is ${dateStr} (${dateStrEn}). Use this when searching for recent/current information.
    When user asks for "recent", "this week", "latest" news, search for content from ${monthYearEn}.

    [OUTPUT FORMAT]
First, output a brief narrative in the USER'S LANGUAGE describing:
1. What you are searching for
2. Key findings from your search(visual details, character features, etc.)

Then, at the very end, output a JSON block wrapped in \`\`\`json ... \`\`\` containing:
{
  "facts": [{ "item": "label", "source": "detailed description" }],
  "promptDraft": "synthesized prompt in user's language"
}

\`\`\`json
{"facts": [...], "promptDraft": "..."}
\`\`\`

Rules:
- Use googleSearch when external facts are needed.
- Output narrative FIRST for user visibility, JSON LAST for parsing.
- If you cannot produce valid JSON, output {"facts": [], "promptDraft": ""} as fallback.
- Keep your response concise (under 400 words for narrative, 5-8 facts max).
`;

const extractSearchJsonText = (searchFullText: string): { searchText: string; parsedOk: boolean } => {
  let searchText = searchFullText.trim();
  const jsonBlockMatch = searchText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    searchText = jsonBlockMatch[1].trim();
  }

  let parsedOk = true;
  try {
    JSON.parse(searchText);
  } catch {
    parsedOk = false;
  }

  return { searchText, parsedOk };
};

export const finalizeSearchPhaseResult = ({
  searchFullText,
  collectedQueries,
  collectedSources,
  completeTitle = 'Gathering key information'
}: {
  searchFullText: string;
  collectedQueries: string[];
  collectedSources: SearchSource[];
  completeTitle?: string;
}): {
  searchFacts: StructuredFact[];
  searchPromptDraft: string;
  completionProgress?: SearchCompletionProgress;
} => {
  const resultItems: SearchProgressResultItem[] = [];
  const jsonMatch = searchFullText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.facts && Array.isArray(parsed.facts)) {
        for (const fact of parsed.facts.slice(0, 4)) {
          resultItems.push({ label: fact.item, value: fact.source || '' });
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  const { searchText, parsedOk } = extractSearchJsonText(searchFullText);
  if (!parsedOk) {
    console.warn('[Search] Could not parse search output as JSON, continuing without facts');
  }

  const parsed = parsedOk ? parseFactsFromLLM(searchText) : { facts: [], promptDraft: '' };

  return {
    searchFacts: parsed.facts,
    searchPromptDraft: parsed.promptDraft,
    completionProgress: collectedQueries.length > 0 ? {
      status: 'complete',
      title: completeTitle,
      queries: collectedQueries,
      results: resultItems.length > 0 ? resultItems : undefined,
      sources: collectedSources.slice(0, 5)
    } : undefined
  };
};

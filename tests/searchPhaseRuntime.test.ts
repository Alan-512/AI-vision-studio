import { describe, expect, it, vi } from 'vitest';
import { buildSearchPhaseInstruction, executeSearchPhase, finalizeSearchPhaseResult } from '../services/searchPhaseRuntime';

describe('searchPhaseRuntime', () => {
  it('builds a search phase instruction with date and context', () => {
    const instruction = buildSearchPhaseInstruction({
      contextPart: '\n[CONVERSATION CONTEXT]\nprior context\n',
      dateStr: '2026年4月3日',
      dateStrEn: 'April 3, 2026',
      monthYearEn: 'April 2026'
    });

    expect(instruction).toContain('SEARCH PHASE');
    expect(instruction).toContain('2026年4月3日');
    expect(instruction).toContain('April 2026');
    expect(instruction).toContain('prior context');
  });

  it('finalizes parsed search results and completion payload', () => {
    const result = finalizeSearchPhaseResult({
      searchFullText: '```json {"facts":[{"item":"Brand","source":"Blue can"}],"promptDraft":"Blue can poster"} ```',
      collectedQueries: ['blue can brand'],
      collectedSources: [
        { title: 'Source 1', url: 'https://example.com/1' },
        { title: 'Source 2', url: 'https://example.com/2' }
      ]
    });

    expect(result.searchFacts).toEqual([
      { item: 'Brand', source: 'Blue can' }
    ]);
    expect(result.searchPromptDraft).toBe('Blue can poster');
    expect(result.completionProgress).toMatchObject({
      status: 'complete',
      queries: ['blue can brand']
    });
    expect(result.completionProgress?.results).toEqual([
      { label: 'Brand', value: 'Blue can' }
    ]);
  });

  it('executes search phase and collects streamed grounding data', async () => {
    const onSearchProgress = vi.fn();

    const result = await executeSearchPhase({
      ai: {
        models: {
          generateContentStream: vi.fn().mockResolvedValue((async function* () {
            yield {
              text: 'narrative',
              candidates: [{
                groundingMetadata: {
                  webSearchQueries: ['blue can brand'],
                  groundingChunks: [
                    { web: { title: 'Source 1', uri: 'https://example.com/1' } }
                  ]
                }
              }]
            };
          })())
        }
      } as any,
      searchModelName: 'gemini-2.5-flash',
      searchContents: [],
      searchInstruction: 'search',
      signal: new AbortController().signal,
      searchTools: [{}],
      onSearchProgress,
      language: 'zh'
    });

    expect(result.searchFullText).toBe('narrative');
    expect(result.collectedQueries).toEqual(['blue can brand']);
    expect(result.collectedSources).toEqual([
      { title: 'Source 1', url: 'https://example.com/1' }
    ]);
    expect(onSearchProgress).toHaveBeenCalled();
  });
});

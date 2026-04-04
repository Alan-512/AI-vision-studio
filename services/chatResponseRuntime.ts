import { AppMode, TextModel, type SearchProgress } from '../types';

export const executeStreamChatResponse = async ({
  ai,
  history,
  newMessage,
  onChunk,
  modelName,
  mode,
  signal,
  contextSummary,
  summaryCursor,
  onUpdateContext,
  onToolCall,
  useSearch,
  params,
  onThoughtSignatures,
  onThoughtImage,
  onThoughtText,
  onSearchProgress,
  projectId,
  compactConversationContext,
  buildSystemInstruction,
  getAlwaysOnMemorySnippet,
  convertHistoryToNativeFormat,
  buildGoogleSearchTools,
  buildSearchPhaseInstruction,
  executeSearchPhase,
  finalizeSearchPhaseResult,
  buildRetrievedContextSection,
  mergeChatSystemInstruction,
  buildChatResponseConfig,
  executeChatStreamLoop,
  executeDeferredChatToolCalls,
  updateChatRollingSummary,
  normalizeSupportedToolName,
  stripVisibleToolPlanningText,
  summarizeConversation,
  imageTools
}: any) => {
  const isReasoning = modelName === TextModel.PRO;
  const realModelName = isReasoning ? TextModel.PRO : TextModel.FLASH;
  const isImageMode = mode === AppMode.IMAGE;
  const language = localStorage.getItem('app_language') || 'zh';
  const compactedContext = compactConversationContext(history, contextSummary, summaryCursor, 8);
  const effectiveSummary = compactedContext.effectiveSummary;
  const activeHistory = compactedContext.recentHistory;
  const contextPart = effectiveSummary
    ? `\n[CONVERSATION CONTEXT]\nHere is a summary of our earlier conversation: \n${effectiveSummary} \n\nUse this context to maintain consistency and understand references to previous work.\n`
    : '';

  const allowSearch = !!useSearch;
  const runLlmSearch = allowSearch;
  const searchModelName = TextModel.FLASH;
  let searchFacts: Array<{ item: string; source?: string }> = [];
  let searchPromptDraft = '';

  if (runLlmSearch) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateStrEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const monthYearEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    const searchInstruction = buildSearchPhaseInstruction({ contextPart, dateStr, dateStrEn, monthYearEn });
    const searchContents = convertHistoryToNativeFormat(activeHistory, searchModelName);
    if (signal.aborted) throw new Error('Cancelled');

    const { searchFullText, collectedQueries, collectedSources } = await executeSearchPhase({
      ai,
      searchModelName,
      searchContents,
      searchInstruction,
      signal,
      searchTools: buildGoogleSearchTools(),
      onSearchProgress,
      language
    });

    if (signal.aborted) throw new Error('Cancelled');
    const finalizedSearch = finalizeSearchPhaseResult({
      searchFullText,
      collectedQueries,
      collectedSources,
      completeTitle: language === 'zh' ? '收集关键信息' : 'Gathering key information'
    });
    if (onSearchProgress && finalizedSearch.completionProgress) {
      onSearchProgress(finalizedSearch.completionProgress as SearchProgress);
    }
    searchFacts = finalizedSearch.searchFacts;
    searchPromptDraft = finalizedSearch.searchPromptDraft;
  }

  const retrievedContextSection = buildRetrievedContextSection({
    searchFacts,
    searchPromptDraft
  });
  const searchFactsStrings = searchFacts.map(f => f.item);
  const { systemInstruction: builtInstruction } = buildSystemInstruction({
    mode,
    userMessage: newMessage,
    params,
    contextSummary: effectiveSummary,
    searchFacts: searchFactsStrings,
    useSearch,
    useGrounding: params?.useGrounding
  });

  let memorySnippet = '';
  try {
    memorySnippet = await getAlwaysOnMemorySnippet(projectId ?? null);
  } catch (error) {
    console.warn('[Memory] Failed to get memory snippet:', error);
  }

  const systemInstruction = mergeChatSystemInstruction({
    builtInstruction,
    contextPart,
    retrievedContextSection,
    memorySnippet
  });
  const contents = convertHistoryToNativeFormat(activeHistory, realModelName);
  const config = buildChatResponseConfig({
    systemInstruction,
    isImageMode,
    allowSearch,
    isReasoning,
    imageTools,
    searchTools: buildGoogleSearchTools()
  });

  const result = await ai.models.generateContentStream({
    model: realModelName,
    contents,
    config: { ...config, abortSignal: signal }
  });

  console.log('[Stream] Starting stream loop...');
  const {
    fullText: streamedText,
    sourcesList,
    collectedSignatures,
    pendingToolCalls,
    assistantTurnParts,
    chunkCount
  } = await executeChatStreamLoop({
    result,
    signal,
    onChunk,
    onThoughtText,
    onThoughtImage,
    normalizeToolName: normalizeSupportedToolName,
    stripVisiblePlanningText: stripVisibleToolPlanningText
  });
  let fullText = streamedText;

  if (sourcesList.length > 0) {
    let sourceText = '\n\n--_\n**Sources:**\n';
    sourcesList.forEach((source: any, index: number) => {
      sourceText += `${index + 1}. [${source.title}](${source.uri})\n`;
    });
    fullText += sourceText;
    onChunk(fullText);
  }
  console.log('[Stream] Stream completed. Total chunks:', chunkCount, 'Pending tool calls:', pendingToolCalls.length);

  if (collectedSignatures.length > 0 && onThoughtSignatures) {
    onThoughtSignatures(collectedSignatures);
  }

  if (pendingToolCalls.length > 0 && !signal?.aborted) {
    console.log(`[Stream] Executing ${pendingToolCalls.length} deferred tool calls`);
    try {
      const deferredToolResult = await executeDeferredChatToolCalls({
        pendingToolCalls,
        assistantTurnParts,
        contents,
        signal,
        fullText,
        onChunk,
        onToolCall,
        searchFacts,
        searchPromptDraft,
        userMessage: newMessage,
        projectId,
        generateFollowUpParts: async (followUpContents: any[]) => {
          const followUpResponse = await ai.models.generateContent({
            model: realModelName,
            contents: followUpContents,
            config: { ...config, abortSignal: signal }
          });
          return (followUpResponse as any).candidates?.[0]?.content?.parts || [];
        }
      });
      fullText = deferredToolResult.fullText;
    } catch (error) {
      console.error('[Stream] Deferred tool execution loop failed:', error);
    }
  }

  if (onUpdateContext && compactedContext.nextSummaryRange && !signal.aborted) {
    try {
      await updateChatRollingSummary({
        onUpdateContext,
        nextSummaryRange: compactedContext.nextSummaryRange,
        effectiveSummary,
        history,
        fullText,
        summarizeConversation
      });
    } catch (error) {
      console.warn('[Context] Failed to update rolling summary:', error);
    }
  }
};

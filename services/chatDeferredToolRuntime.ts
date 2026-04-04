import type { Content } from '@google/genai';
import { buildPromptWithFacts, type StructuredFact } from './searchFactsRuntime';
import { executeInternalToolCall, runInternalToolResultLoop, type DeferredToolCall } from './internalToolRuntime';

export const executeDeferredChatToolCalls = async ({
  pendingToolCalls,
  assistantTurnParts,
  contents,
  signal,
  fullText,
  onChunk,
  onToolCall,
  searchFacts,
  searchPromptDraft,
  userMessage,
  projectId,
  runInternalToolResultLoopImpl = runInternalToolResultLoop,
  executeInternalToolCallImpl = executeInternalToolCall,
  generateFollowUpParts
}: {
  pendingToolCalls: Array<{ toolName: string; args: any }>;
  assistantTurnParts: any[];
  contents: Content[];
  signal: AbortSignal;
  fullText: string;
  onChunk: (text: string) => void;
  onToolCall?: (action: { toolName: string; args: any }) => Promise<any> | any;
  searchFacts: StructuredFact[];
  searchPromptDraft: string;
  userMessage: string;
  projectId?: string | null;
  runInternalToolResultLoopImpl?: typeof runInternalToolResultLoop;
  executeInternalToolCallImpl?: typeof executeInternalToolCall;
  generateFollowUpParts: (followUpContents: Content[]) => Promise<any[]>;
}) => {
  if (pendingToolCalls.length === 0 || signal.aborted) {
    return { fullText };
  }

  const preparedToolCalls: DeferredToolCall[] = pendingToolCalls.map(pendingToolCall => {
    const rawArgs = pendingToolCall.args && typeof pendingToolCall.args === 'object'
      ? pendingToolCall.args as Record<string, any>
      : {};
    const hasParametersWrapper = 'parameters' in rawArgs && typeof rawArgs.parameters === 'object';
    const targetArgs = hasParametersWrapper ? rawArgs.parameters : rawArgs;
    const existingPrompt = targetArgs.prompt;
    const basePrompt = typeof existingPrompt === 'string'
      ? existingPrompt
      : (searchPromptDraft || userMessage);

    if (searchFacts.length > 0) {
      targetArgs.prompt = buildPromptWithFacts(basePrompt, searchFacts);
    } else if (basePrompt && !existingPrompt) {
      targetArgs.prompt = basePrompt;
    }

    targetArgs.useGrounding = false;
    return {
      toolName: pendingToolCall.toolName,
      args: hasParametersWrapper ? ({ ...rawArgs, parameters: targetArgs } as any) : targetArgs
    };
  });

  let workingContents: Content[] = assistantTurnParts.length > 0
    ? [...contents, { role: 'model', parts: assistantTurnParts } as Content]
    : [...contents];

  const internalLoopResult = await runInternalToolResultLoopImpl({
    pendingToolCalls: preparedToolCalls,
    workingContents,
    signal,
    fullText,
    onChunk,
    executeToolCall: (toolName, args) => {
      const rawArgs = args && typeof args === 'object' ? args : {};
      const targetArgs = 'parameters' in rawArgs && typeof (rawArgs as any).parameters === 'object'
        ? (rawArgs as any).parameters
        : rawArgs;
      return executeInternalToolCallImpl(toolName, targetArgs, projectId);
    },
    generateFollowUpParts
  });

  if (internalLoopResult.externalToolCalls.length > 0 && onToolCall && !signal.aborted) {
    for (const externalToolCall of internalLoopResult.externalToolCalls) {
      onToolCall({ toolName: externalToolCall.toolName, args: externalToolCall.args });
    }
  }

  return {
    fullText: internalLoopResult.fullText,
    workingContents: internalLoopResult.workingContents
  };
};

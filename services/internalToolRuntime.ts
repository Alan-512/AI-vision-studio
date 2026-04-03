import type { Content } from '@google/genai';

const MEMORY_TOOL_NAME = 'memory_search';
const INTERNAL_TOOL_NAMES = new Set<string>([MEMORY_TOOL_NAME, 'update_memory']);
const SUPPORTED_TOOL_NAMES = new Set<string>(['generate_image', 'update_memory', MEMORY_TOOL_NAME]);
const MAX_INTERNAL_TOOL_LOOPS = 4;
const TOOL_PLANNING_JSON_MARKERS = [
  '"action"',
  '"parameters"',
  '"generate_image"',
  '"generate_video"'
];

export type DeferredToolCall = {
  toolName: string;
  args: Record<string, any>;
};

type InternalToolExecutionResult = {
  response: Record<string, any>;
  fallbackText?: string;
};

export const normalizeSupportedToolName = (toolName?: string): string | null => {
  if (!toolName) return null;
  if (toolName === 'read_memory') return MEMORY_TOOL_NAME;
  return SUPPORTED_TOOL_NAMES.has(toolName) ? toolName : null;
};

export const stripVisibleToolPlanningText = (text: string): string => {
  if (!text) return text;

  const planningStartPatterns = [
    /\n\s*\{\s*"action"\s*:/m,
    /\n\s*```json\s*\{\s*"action"\s*:/im,
    /^\s*\{\s*"action"\s*:/m
  ];

  for (const pattern of planningStartPatterns) {
    const match = text.match(pattern);
    if (!match || typeof match.index !== 'number') continue;

    const candidate = text.slice(match.index);
    const looksLikeToolPlan = TOOL_PLANNING_JSON_MARKERS.every(marker => candidate.includes(marker))
      || (
        candidate.includes('"action"') &&
        candidate.includes('"parameters"') &&
        (candidate.includes('generate_image') || candidate.includes('generate_video'))
      );

    if (!looksLikeToolPlan) continue;

    return text.slice(0, match.index).trimEnd();
  }

  return text;
};

const buildAssistantFunctionCallContent = (toolName: string, args: Record<string, any>): Content => ({
  role: 'model',
  parts: [{ functionCall: { name: toolName, args } } as any]
});

const buildFunctionResponseContent = (toolName: string, response: Record<string, any>): Content => ({
  role: 'user',
  parts: [{ functionResponse: { name: toolName, response } } as any]
});

export const executeInternalToolCall = async (
  toolName: string,
  args: Record<string, any>,
  projectId?: string | null
): Promise<InternalToolExecutionResult> => {
  if (toolName === 'update_memory') {
    const { section, key, value, scope } = args;
    if (!section || !value) {
      return {
        response: { ok: false, error: 'Missing section or value' },
        fallbackText: ''
      };
    }

    const { appendDailyLog, applyPatchToMemory } = await import('./memoryService');
    const targetScope = (scope === 'global' || scope === 'project') ? scope : 'project';
    const targetId = targetScope === 'global' ? 'default' : (projectId || 'default');

    const logId = await appendDailyLog({
      content: `${section}: ${key || ''} ${value}`.trim(),
      confidence: 1.0,
      projectId: projectId || undefined,
      scopeHint: targetScope as any,
      metadata: { source: 'ai_tool_call' }
    });

    const doc = await applyPatchToMemory(targetScope, targetId, {
      ops: [{
        op: 'upsert',
        section,
        key: key || section.toLowerCase().replace(/\s+/g, '_'),
        value
      }],
      confidence: 1.0,
      reason: 'Real-time update from AI tool call'
    });

    return {
      response: {
        ok: true,
        scope: targetScope,
        targetId,
        docVersion: doc.version,
        logId
      },
      fallbackText: `✅ 好的，我记住了：${value}`
    };
  }

  if (toolName === MEMORY_TOOL_NAME) {
    const { query, scope } = args;
    const { memorySearch } = await import('./memoryService');
    const searchResult = await memorySearch(String(query || ''), projectId, { scope });
    return {
      response: {
        ok: true,
        query: String(query || ''),
        scope: scope || 'both',
        result: searchResult
      },
      fallbackText: searchResult
    };
  }

  return { response: { ok: false, error: `Unsupported internal tool: ${toolName}` } };
};

export const runInternalToolResultLoop = async ({
  pendingToolCalls,
  workingContents,
  signal,
  fullText,
  onChunk,
  executeToolCall,
  generateFollowUpParts,
  maxInternalLoops = MAX_INTERNAL_TOOL_LOOPS
}: {
  pendingToolCalls: DeferredToolCall[];
  workingContents: Content[];
  signal: AbortSignal;
  fullText: string;
  onChunk: (text: string) => void;
  executeToolCall: (toolName: string, args: Record<string, any>) => Promise<InternalToolExecutionResult>;
  generateFollowUpParts: (contents: Content[]) => Promise<any[]>;
  maxInternalLoops?: number;
}): Promise<{ fullText: string; workingContents: Content[]; externalToolCalls: DeferredToolCall[] }> => {
  const externalToolCalls: DeferredToolCall[] = [];
  const queuedToolCalls = [...pendingToolCalls];
  let nextFullText = fullText;
  let nextContents = [...workingContents];
  let internalLoopCount = 0;

  while (queuedToolCalls.length > 0 && !signal.aborted) {
    const pendingToolCall = queuedToolCalls.shift()!;

    if (!INTERNAL_TOOL_NAMES.has(pendingToolCall.toolName)) {
      externalToolCalls.push(pendingToolCall);
      continue;
    }

    if (internalLoopCount >= maxInternalLoops) {
      console.warn('[Stream] Reached max internal tool loops, stopping follow-up tool execution');
      break;
    }

    internalLoopCount += 1;
    const { response, fallbackText } = await executeToolCall(pendingToolCall.toolName, pendingToolCall.args);
    nextContents = [
      ...nextContents,
      buildAssistantFunctionCallContent(pendingToolCall.toolName, pendingToolCall.args),
      buildFunctionResponseContent(pendingToolCall.toolName, response)
    ];

    const followUpParts = await generateFollowUpParts(nextContents);
    if (followUpParts.length > 0) {
      nextContents = [...nextContents, { role: 'model', parts: followUpParts } as Content];
    }

    let followUpText = '';
    for (const part of followUpParts) {
      if (part.text) {
        followUpText += part.text;
      }
      if (part.functionCall) {
        const nextToolName = normalizeSupportedToolName(part.functionCall.name);
        if (nextToolName) {
          queuedToolCalls.push({
            toolName: nextToolName,
            args: (part.functionCall.args || {}) as Record<string, any>
          });
        }
      }
    }

    if (followUpText.trim()) {
      const combinedText = nextFullText.trim().length > 0 ? `${nextFullText}\n${followUpText}` : followUpText;
      nextFullText = stripVisibleToolPlanningText(combinedText);
      onChunk(nextFullText);
    } else if (!nextFullText.trim() && fallbackText) {
      nextFullText = fallbackText;
      onChunk(nextFullText);
    }
  }

  return {
    fullText: nextFullText,
    workingContents: nextContents,
    externalToolCalls
  };
};

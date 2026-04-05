import type { AgentAction } from '../types';
import type { ToolClass, TurnRuntimeState } from './agentKernelTypes';
import { evaluateToolPermission, type ToolPermissionPolicy } from './toolPermissionRuntime';

// Toolbox is the capability boundary.
// It classifies tools, validates arguments, enforces permission policy, and normalizes results.
// It must not become a second lifecycle owner; turn/job semantics stay in the kernel.

type ToolExecutionOutput = {
  status: 'success' | 'error' | 'requires_action';
  content?: Record<string, unknown>;
  jobTransition?: Record<string, unknown>;
  error?: string;
};

type RegisteredTool = {
  name: string;
  toolClass: ToolClass;
  execute: (args: unknown) => Promise<ToolExecutionOutput>;
  permissionPolicy?: ToolPermissionPolicy;
  denyReason?: string;
};

export interface NormalizedToolResult {
  toolName: string;
  toolClass: ToolClass;
  status: 'success' | 'error' | 'requires_action';
  reinject: boolean;
  content?: Record<string, unknown>;
  jobTransition?: Record<string, unknown>;
  errorType?: 'permission_denied' | 'tool_error';
  error?: string;
}

type ExecuteToolCallsResult = {
  normalizedResults: NormalizedToolResult[];
};

export const buildSequenceFramePrompts = ({
  basePrompt,
  count,
  framePrompts
}: {
  basePrompt: string;
  count: number;
  framePrompts?: string[];
}): string[] => {
  if (count <= 1) {
    return [basePrompt];
  }

  if (framePrompts) {
    const normalizedFramePrompts = framePrompts.map(prompt => prompt.trim());
    const hasValidLength = normalizedFramePrompts.length === count;
    const hasOnlyNonEmpty = normalizedFramePrompts.every(prompt => prompt.length > 0);
    const hasDistinctPrompts = new Set(normalizedFramePrompts).size === normalizedFramePrompts.length;

    if (!hasValidLength) {
      throw new Error(`Sequence generation requires ${count} explicit frame prompts.`);
    }

    if (!hasOnlyNonEmpty) {
      throw new Error('Sequence generation requires non-empty frame prompts.');
    }

    if (!hasDistinctPrompts) {
      throw new Error('Sequence generation requires distinct frame prompts.');
    }

    return normalizedFramePrompts;
  }

  return Array.from({ length: count }, (_unused, index) => (
    `${basePrompt}\n\nSequence frame ${index + 1} of ${count}. Keep subject and scene continuity, but make this frame a distinct action beat.`
  ));
};

const normalizePermissionDenied = (
  action: AgentAction,
  toolClass: ToolClass,
  reason?: string
): NormalizedToolResult => ({
  toolName: action.toolName,
  toolClass,
  status: 'error',
  reinject: false,
  errorType: 'permission_denied',
  error: reason || 'Tool execution denied by policy'
});

const normalizeExecutionResult = (
  action: AgentAction,
  toolClass: ToolClass,
  result: ToolExecutionOutput
): NormalizedToolResult => ({
  toolName: action.toolName,
  toolClass,
  status: result.status,
  reinject: toolClass === 'interactive_tool' && result.status === 'success',
  content: result.content,
  jobTransition: result.jobTransition,
  errorType: result.status === 'error' ? 'tool_error' : undefined,
  error: result.error
});

export const createToolboxRuntime = ({
  tools
}: {
  tools: RegisteredTool[];
}) => {
  const registry = new Map(tools.map(tool => [tool.name, tool]));

  return {
    async executeToolCalls({
      toolCalls
    }: {
      turn: TurnRuntimeState;
      toolCalls: AgentAction[];
    }): Promise<ExecuteToolCallsResult> {
      const normalizedResults: NormalizedToolResult[] = [];

      for (const action of toolCalls) {
        const tool = registry.get(action.toolName);
        if (!tool) {
          normalizedResults.push({
            toolName: action.toolName,
            toolClass: 'interactive_tool',
            status: 'error',
            reinject: false,
            errorType: 'tool_error',
            error: `Tool "${action.toolName}" is not registered`
          });
          continue;
        }

        const permission = evaluateToolPermission({
          toolName: tool.name,
          toolClass: tool.toolClass,
          policy: tool.permissionPolicy,
          reason: tool.denyReason
        });

        if (!permission.allowed) {
          normalizedResults.push(
            normalizePermissionDenied(action, tool.toolClass, permission.reason)
          );
          continue;
        }

        const result = await tool.execute(action.args);
        normalizedResults.push(normalizeExecutionResult(action, tool.toolClass, result));
      }

      return {
        normalizedResults
      };
    }
  };
};

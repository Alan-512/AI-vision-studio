import type { AgentJob } from '../types';
import { createAgentKernel } from './agentKernel';
import type {
  ExecuteToolCallsCommand,
  StartGenerationCommand,
  StreamingTurnCompatPayload,
  SubmitUserTurnCommand
} from './agentKernelTypes';

type AppAgentKernelDeps = {
  executeStartGeneration?: (payload: StartGenerationCommand['payload']) => Promise<unknown[]>;
  executeToolCalls?: (command: ExecuteToolCallsCommand) => Promise<unknown[]>;
  executeSubmitUserTurn?: (payload: StreamingTurnCompatPayload) => Promise<unknown>;
  executeResolveRequiresAction?: (command: {
    type: 'ResolveRequiresAction';
    jobId: string;
    resolutionType: string;
    payload?: Record<string, unknown>;
  }) => Promise<{
    job: AgentJob;
    events: any[];
    toolResult?: unknown;
  }>;
  executeCancelJob?: (command: {
    type: 'CancelJob';
    jobId: string;
    reason?: string;
  }) => Promise<{
    job: AgentJob;
    events: any[];
    toolResult?: unknown;
  }>;
  executeResumeJob?: (command: { type: 'ResumeJob'; jobId: string; actionType?: string }) => Promise<{
    job: AgentJob;
    events: any[];
    toolResult?: unknown;
  }>;
};

export const createAppAgentKernel = ({
  executeStartGeneration,
  executeToolCalls,
  executeSubmitUserTurn,
  executeResolveRequiresAction,
  executeCancelJob,
  executeResumeJob,
}: AppAgentKernelDeps) => createAgentKernel({
  planner: async () => ({
    type: 'final_response',
    text: 'unused'
  }),
  submitUserTurnCommand: async command => {
    const payload = command.payload;
    if (executeSubmitUserTurn) {
      if (!payload) {
        throw new Error('No app submit-turn handler configured');
      }

      const result = await executeSubmitUserTurn(payload) as { turnOutput?: unknown };
      return result?.turnOutput ?? result;
    }

    throw new Error('No app submit-turn handler configured');
  },
  resolveRequiresAction: async command => {
    if (executeResolveRequiresAction) {
      return executeResolveRequiresAction(command);
    }

    throw new Error('No app requires-action handler configured');
  },
  cancelJob: async command => {
    if (executeCancelJob) {
      return executeCancelJob(command);
    }

    throw new Error('No app cancel-job handler configured');
  },
  resumeJob: async command => {
    if (executeResumeJob) {
      return executeResumeJob(command);
    }

    throw new Error('No app resume-job handler configured');
  },
  startGeneration: async command => {
    if (executeStartGeneration) {
      return executeStartGeneration(command.payload);
    }
    throw new Error('No app generation handler configured');
  },
  executeToolCalls: async command => {
    if (!executeToolCalls) {
      throw new Error('No app tool-call handler configured');
    }

    return executeToolCalls(command);
  }
});

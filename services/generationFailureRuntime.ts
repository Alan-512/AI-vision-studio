import { AppMode, type AgentJob, type AgentToolResult, type AssetItem } from '../types';
import {
  prepareCancelledGeneration,
  prepareFailedGeneration,
  prepareVisibleAssetRecovery
} from './agentRuntime';

export const resolveGenerationFailure = async ({
  mode,
  agentJob,
  stepId,
  taskId,
  latestVisibleAsset,
  taskMarkedVisibleComplete = false,
  error,
  deps
}: {
  mode: AppMode;
  agentJob: AgentJob;
  stepId: string;
  taskId: string;
  latestVisibleAsset?: AssetItem | null;
  taskMarkedVisibleComplete?: boolean;
  error: Error;
  deps: {
    taskRuntime: {
      cancel: (job: AgentJob, taskId: string) => Promise<unknown>;
      recoverVisibleAsset: (input: {
        recoveredJob: AgentJob;
        visibleJob: AgentJob;
        shouldMarkVisibleComplete: boolean;
      }) => Promise<unknown> | unknown;
      fail: (job: AgentJob) => Promise<unknown>;
    };
    addToast: (level: 'info' | 'error' | 'success', title: string, message: string) => void;
    playErrorSound: () => void;
    setCooldown: (endTime: number) => void;
    getFriendlyError: (errorText: string) => string;
    language: 'en' | 'zh';
    now?: () => number;
  };
}): Promise<{ toolResult: AgentToolResult; taskMarkedVisibleComplete: boolean }> => {
  const withRuntimeMetadata = (toolResult: AgentToolResult, result: unknown): AgentToolResult => ({
    ...toolResult,
    metadata: {
      ...(toolResult.metadata || {}),
      runtimeEvents: Array.isArray((result as any)?.events) ? (result as any).events : [],
      jobSnapshot: (result as any)?.job
    }
  });

  if (error.message === 'Cancelled' || error.name === 'AbortError') {
    const { cancelledJob, toolResult } = prepareCancelledGeneration({
      job: agentJob,
      stepId,
      taskId,
      toolName: mode === AppMode.IMAGE ? 'generate_image' : 'generate_video',
      reason: 'Cancelled by user',
      now: (deps.now || Date.now)()
    });
    const cancelResult = await deps.taskRuntime.cancel(cancelledJob, taskId);
    return {
      toolResult: withRuntimeMetadata(toolResult, cancelResult),
      taskMarkedVisibleComplete
    };
  }

  const errorText = error.message || '';
  if (mode === AppMode.IMAGE && latestVisibleAsset) {
    const { recoveredJob, toolResult } = prepareVisibleAssetRecovery({
      job: agentJob,
      stepId,
      taskId,
      toolName: 'generate_image',
      assetId: latestVisibleAsset.id,
      error: errorText,
      now: (deps.now || Date.now)()
    });
    const nextTaskMarkedVisibleComplete = true;
    const recoveryResult = await deps.taskRuntime.recoverVisibleAsset({
      recoveredJob,
      visibleJob: agentJob,
      shouldMarkVisibleComplete: nextTaskMarkedVisibleComplete
    });
    deps.addToast(
      'info',
      deps.language === 'zh' ? '图片已生成，后续评审未完成' : 'Image ready; post-review did not finish',
      errorText
    );
    return {
      toolResult: withRuntimeMetadata(toolResult, recoveryResult),
      taskMarkedVisibleComplete: nextTaskMarkedVisibleComplete
    };
  }

  const retryable = errorText.includes('429') || errorText.includes('Quota') || errorText.includes('RESOURCE_EXHAUSTED');
  const { failedJob, toolResult } = prepareFailedGeneration({
    job: agentJob,
    stepId,
    taskId,
    toolName: mode === AppMode.IMAGE ? 'generate_image' : 'generate_video',
    error: errorText,
    retryable,
    now: (deps.now || Date.now)()
  });
  const failedResult = await deps.taskRuntime.fail(failedJob);
  deps.playErrorSound();
  deps.addToast('error', 'task.failed', deps.getFriendlyError(errorText));
  if (retryable) {
    deps.setCooldown((deps.now || Date.now)() + 60000);
  }
  return {
    toolResult: withRuntimeMetadata(toolResult, failedResult),
    taskMarkedVisibleComplete
  };
};

import type { AgentToolResult } from '../types';

export const executeAppGenerationFlow = async ({
  launchControllerInput,
  requestInput,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest,
  dispatchKernelCommand
}: {
  launchControllerInput: any;
  requestInput: any;
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
  dispatchKernelCommand?: (command: {
    type: 'StartGeneration';
    payload: Record<string, unknown>;
  }) => Promise<{ toolResults?: unknown[] }>;
}) => {
  if (dispatchKernelCommand) {
    if (requestInput.resumeJobId) {
      await dispatchKernelCommand({
        type: 'ResumeJob',
        jobId: requestInput.resumeJobId,
        actionType: requestInput.resumeActionType
      });
    }

    const result = await dispatchKernelCommand({
      type: 'StartGeneration',
      payload: {
        launchControllerInput,
        requestInput
      }
    });
    return (result.toolResults || []) as AgentToolResult[];
  }

  const launchPreparedTask = createGenerationTaskLaunchController(launchControllerInput);
  return executeAppGenerationRequest({
    ...requestInput,
    launchPreparedTask
  });
};

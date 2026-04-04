import type { AgentToolResult } from '../types';
import type { StartGenerationCommand } from './agentKernelTypes';

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
    payload: StartGenerationCommand['payload'];
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
        kind: 'generation_request',
        input: {
          launchControllerInput,
          requestInput
        }
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

import type { AgentToolResult } from '../types';
import type { StartGenerationCommand } from './agentKernelTypes';
import {
  clearStartGenerationBindings,
  registerStartGenerationBindings
} from './startGenerationBindingRuntime';

export const executeAppGenerationFlow = async ({
  launchControllerInput,
  requestInput,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest,
  dispatchKernelCommand,
  createId = () => crypto.randomUUID()
}: {
  launchControllerInput: any;
  requestInput: any;
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
  dispatchKernelCommand?: (command: {
    type: 'StartGeneration';
    payload: StartGenerationCommand['payload'];
  }) => Promise<{ toolResults?: unknown[] }>;
  createId?: () => string;
}) => {
  if (dispatchKernelCommand) {
    if (requestInput.resumeJobId) {
      await dispatchKernelCommand({
        type: 'ResumeJob',
        jobId: requestInput.resumeJobId,
        actionType: requestInput.resumeActionType
      });
    }

    const bindingKey = createId();
    registerStartGenerationBindings(bindingKey, {
      launchControllerInput,
      requestInput
    });

    try {
      const result = await dispatchKernelCommand({
        type: 'StartGeneration',
        payload: {
          kind: 'generation_request',
          input: {
            bindingKey,
            currentProjectId: requestInput.currentProjectId,
            resolvedJobSource: requestInput.resolvedJobSource
          }
        }
      });
      return (result.toolResults || []) as AgentToolResult[];
    } finally {
      clearStartGenerationBindings(bindingKey);
    }
  }

  const launchPreparedTask = createGenerationTaskLaunchController(launchControllerInput);
  return executeAppGenerationRequest({
    ...requestInput,
    launchPreparedTask
  });
};

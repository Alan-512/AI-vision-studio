import type { StartGenerationCompatPayload } from './agentKernelTypes';

export const executeAppStartGeneration = async ({
  kind,
  input,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest
}: {
  kind: StartGenerationCompatPayload['kind'];
  input: StartGenerationCompatPayload['input'];
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
}) => {
  if (kind !== 'generation_request') {
    throw new Error(`Unsupported start-generation payload kind: ${String(kind)}`);
  }

  const { launchControllerInput, requestInput } = input;
  const launchPreparedTask = createGenerationTaskLaunchController(launchControllerInput);
  return executeAppGenerationRequest({
    ...requestInput,
    launchPreparedTask
  });
};

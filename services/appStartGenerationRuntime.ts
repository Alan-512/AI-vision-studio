import type { StartGenerationCompatPayload } from './agentKernelTypes';
import {
  getStartGenerationBindings,
  type StartGenerationBindings
} from './startGenerationBindingRuntime';

export const executeAppStartGeneration = async ({
  kind,
  input,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest,
  resolveGenerationBindings = getStartGenerationBindings
}: {
  kind: StartGenerationCompatPayload['kind'];
  input: StartGenerationCompatPayload['input'];
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
  resolveGenerationBindings?: (key: string) => StartGenerationBindings | undefined;
}) => {
  if (kind !== 'generation_request') {
    throw new Error(`Unsupported start-generation payload kind: ${String(kind)}`);
  }

  const bindings = resolveGenerationBindings(input.bindingKey);
  if (!bindings) {
    throw new Error(`Missing start-generation bindings for key: ${input.bindingKey}`);
  }

  const { launchControllerInput, requestInput } = bindings;
  const launchPreparedTask = createGenerationTaskLaunchController(launchControllerInput);
  return executeAppGenerationRequest({
    ...requestInput,
    launchPreparedTask
  });
};

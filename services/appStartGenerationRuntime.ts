export const executeAppStartGeneration = async ({
  launchControllerInput,
  requestInput,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest
}: {
  launchControllerInput: any;
  requestInput: any;
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
}) => {
  const launchPreparedTask = createGenerationTaskLaunchController(launchControllerInput);
  return executeAppGenerationRequest({
    ...requestInput,
    launchPreparedTask
  });
};

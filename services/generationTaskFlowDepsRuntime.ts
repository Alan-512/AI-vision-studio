export const createGenerationTaskFlowDeps = ({
  taskRuntime,
  taskContext,
  generationDeps
}: {
  taskRuntime: any;
  taskContext: any;
  generationDeps: any;
}) => ({
  stagePendingAsset: (asset: any) => taskRuntime.stagePendingAsset(asset),
  normalizeGenerationParams: () => generationDeps.normalizeGenerationParams(),
  executeGenerationAttempt: (input: any) => generationDeps.executeGenerationAttempt({
    ...input,
    taskRuntime,
    taskContext
  }),
  afterVisibleImage: (input: any) => generationDeps.afterVisibleImage({
    ...input,
    taskRuntime,
    taskContext
  }),
  executePrimaryReview: (input: any) => generationDeps.executePrimaryReview({
    ...input,
    taskRuntime,
    taskContext
  }),
  executeAutoRevisionFlow: (input: any) => generationDeps.executeAutoRevisionFlow({
    ...input,
    taskRuntime,
    taskContext
  }),
  resolvePrimaryReview: (input: any) => generationDeps.resolvePrimaryReview({
    ...input,
    taskRuntime,
    taskContext
  }),
  resolveGenerationFailure: (input: any) => generationDeps.resolveGenerationFailure(input)
});

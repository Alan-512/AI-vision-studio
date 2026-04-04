export const createAppHandleGenerateContextBuilder = ({
  tasksRef,
  setTaskViews,
  saveTaskView,
  deleteTaskView,
  activeProjectIdRef,
  setAssets,
  saveAsset,
  updateAsset,
  deleteAssetPermanently,
  saveAgentJobSnapshot,
  loadAgentJobsByProject,
  taskControllers,
  createGenerationTaskLaunchController,
  executeAppGenerationRequest,
  dispatchKernelCommand,
  createResumeActionStep,
  buildConsistencyProfile,
  normalizeAssistantMode,
  prepareGenerationLaunch,
  playSuccessSound
}: {
  tasksRef: { current: Array<{ id: string; jobId?: string }> };
  setTaskViews: unknown;
  saveTaskView: unknown;
  deleteTaskView: unknown;
  activeProjectIdRef: { current: string };
  setAssets: unknown;
  saveAsset: unknown;
  updateAsset: unknown;
  deleteAssetPermanently: unknown;
  saveAgentJobSnapshot: unknown;
  loadAgentJobsByProject: (projectId: string) => Promise<any[]>;
  taskControllers: { current: Record<string, AbortController> };
  createGenerationTaskLaunchController: (input: any) => any;
  executeAppGenerationRequest: (input: any) => Promise<any>;
  dispatchKernelCommand?: (command: any) => Promise<any>;
  createResumeActionStep: unknown;
  buildConsistencyProfile: unknown;
  normalizeAssistantMode: unknown;
  prepareGenerationLaunch: unknown;
  playSuccessSound?: () => void;
}) => ({
  onPreview,
  onSuccess
}: {
  onPreview?: (asset: any) => void;
  onSuccess?: (asset: any) => void;
}) => ({
  launchControllerInput: {
    persistenceDeps: {
      taskViewsRef: tasksRef,
      setTaskViews,
      saveTaskView,
      deleteTaskView,
      activeProjectIdRef,
      setAssets,
      saveAsset,
      updateAsset,
      deleteAssetPermanently,
      saveAgentJobSnapshot,
      onPreview,
      onSuccess
    },
    launcherDeps: {
      loadExistingJob: async (projectId: string, maybeResumeJobId?: string) => maybeResumeJobId
        ? (await loadAgentJobsByProject(projectId)).find(job => job.id === maybeResumeJobId)
        : undefined,
      getPreviousTaskIds: (jobId: string) => tasksRef.current.filter(task => task.jobId === jobId).map(task => task.id),
      createAbortController: () => new AbortController(),
      registerController: (taskId: string, controller: AbortController) => {
        taskControllers.current[taskId] = controller;
      },
      unregisterController: (taskId: string) => {
        delete taskControllers.current[taskId];
      }
    },
    runtimeDeps: {
      now: () => Date.now(),
      createId: () => crypto.randomUUID()
    }
  },
  createGenerationTaskLaunchController,
  executeAppGenerationRequest,
  dispatchKernelCommand,
  createSessionInput: {
    createResumeActionStep,
    buildConsistencyProfile,
    normalizeAssistantMode,
    prepareGenerationLaunch
  },
  playSuccessSound
});

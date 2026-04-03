import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, AssetItem, BackgroundTaskView } from '../types';
import { createGenerationTaskRuntimeController } from '../services/generationTaskRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'queued',
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
  source: 'studio',
  steps: [],
  artifacts: [],
  ...overrides
});

const createTaskView = (id: string): BackgroundTaskView => ({
  id,
  jobId: `job-${id}`,
  projectId: 'project-1',
  projectName: 'Project One',
  type: 'IMAGE',
  status: 'QUEUED',
  startTime: 1710000000000,
  prompt: 'poster'
});

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'task-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://asset',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

describe('generationTaskRuntime', () => {
  it('creates a controller that coordinates job/task/asset runtime actions', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const setTaskViews = vi.fn();
    const setAssets = vi.fn();
    let currentJob = createJob();
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: currentJob },
        saveAgentJobSnapshot,
        onPersist: job => {
          currentJob = job;
        }
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews,
          saveTaskView,
          deleteTaskView
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets,
          saveAsset,
          updateAsset
        }
      }
    });

    await controller.persistJob(createJob({ status: 'executing' }));
    await controller.upsertTaskView(currentJob);
    await controller.publishAsset(createAsset());
    await controller.patchAsset({ persistedPatch: { operationName: 'op-1' } });
    await controller.markTaskVisibleComplete(currentJob);
    await controller.dismissTaskView('task-1');

    expect(saveAgentJobSnapshot).toHaveBeenCalled();
    expect(saveTaskView).toHaveBeenCalled();
    expect(saveAsset).toHaveBeenCalled();
    expect(updateAsset).toHaveBeenCalledWith('task-1', { operationName: 'op-1' });
    expect(deleteTaskView).toHaveBeenCalledWith('task-1');
  });

  it('syncs a job snapshot and task view through one controller call', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.syncJob(createJob({ status: 'reviewing' }), { taskView: 'upsert' });
    await controller.syncJob(createJob({ status: 'completed' }), { taskView: 'visible_complete' });

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenCalledTimes(2);
    expect(deleteTaskView).not.toHaveBeenCalled();
  });

  it('deletes the pending task asset from persistence and visible state through one controller call', async () => {
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot: vi.fn().mockResolvedValue(undefined)
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets,
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined),
          deleteAssetPermanently
        }
      }
    });

    await controller.deleteTaskAsset();

    expect(deleteAssetPermanently).toHaveBeenCalledWith('task-1');
    expect(setAssets).toHaveBeenCalledTimes(1);
    const removeTaskAsset = setAssets.mock.calls[0][0] as (assets: AssetItem[]) => AssetItem[];
    expect(removeTaskAsset([createAsset({ id: 'task-1' }), createAsset({ id: 'other-task' })])).toEqual([
      createAsset({ id: 'other-task' })
    ]);
  });

  it('cancels a task by persisting the cancelled job, dismissing its task view, and deleting its asset', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined),
          deleteAssetPermanently
        }
      }
    });

    await controller.cancel(createJob({ status: 'cancelled' }), 'task-1');

    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(deleteTaskView).toHaveBeenCalledWith('task-1');
    expect(deleteAssetPermanently).toHaveBeenCalledWith('task-1');
  });

  it('recovers a visible asset by persisting the recovered job and marking the current job visible complete when needed', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.recoverVisibleAsset({
      recoveredJob: createJob({ status: 'completed' }),
      visibleJob: createJob({ status: 'completed' }),
      shouldMarkVisibleComplete: true
    });

    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('fails a task by syncing the failed job and deleting the pending task asset', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined),
          deleteAssetPermanently
        }
      }
    });

    await controller.fail(createJob({ status: 'failed' }));

    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(saveTaskView).toHaveBeenCalledTimes(1);
    expect(deleteAssetPermanently).toHaveBeenCalledWith('task-1');
  });

  it('persists multiple job snapshots through one controller call', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.persistJobs([
      createJob({ status: 'revising' }),
      createJob({ status: 'executing', updatedAt: 1710000000002 })
    ]);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveAgentJobSnapshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'revising' }));
    expect(saveAgentJobSnapshot).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'executing' }));
  });

  it('syncs a surface job with an optional task-view policy', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.syncSurfaceJob(createJob({ status: 'reviewing' }), true);
    await controller.syncSurfaceJob(createJob({ status: 'completed', updatedAt: 1710000000003 }), false);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('stages a running job by patching the asset and syncing the task view', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset
        }
      }
    });

    await controller.stageRunningJob({
      runningJob: createJob({ status: 'executing' }),
      assetPatch: { status: 'GENERATING' as const },
      assetViewPatch: { status: 'GENERATING' as const }
    });

    expect(updateAsset).toHaveBeenCalledWith('task-1', { status: 'GENERATING' });
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'executing' }));
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('publishes a completed image and persists its completed job', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset,
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.completeVisibleImage({
      asset: createAsset(),
      completedJob: createJob({ status: 'completed' })
    });

    expect(saveAsset).toHaveBeenCalled();
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('updates an operation asset patch and persists the operation job', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset
        }
      }
    });

    await controller.updateOperation({
      operationJob: createJob({ status: 'executing' }),
      assetPatch: { operationName: 'op-1' }
    });

    expect(updateAsset).toHaveBeenCalledWith('task-1', { operationName: 'op-1' });
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'executing' }));
  });

  it('publishes an asset and then persists a follow-up job snapshot', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset,
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.publishAssetAndPersistJob({
      asset: createAsset({ id: 'task-2' }),
      job: createJob({ status: 'reviewing' })
    });

    expect(saveAsset).toHaveBeenCalled();
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'reviewing' }));
  });

  it('syncs the initial queued job into the task view surface', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.initializeQueuedJob(createJob({ status: 'queued' }));

    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('stages the pending task asset before generation starts', async () => {
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot: vi.fn().mockResolvedValue(undefined)
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets,
          saveAsset,
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.stagePendingAsset(createAsset({ status: 'PENDING', url: '' }));

    expect(saveAsset).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', url: '' }));
    expect(setAssets).toHaveBeenCalledTimes(1);
  });

  it('completes a video by patching the asset and persisting the completed job', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets,
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset
        }
      }
    });

    await controller.completeVideo({
      assetUpdates: { status: 'COMPLETED' as const, url: 'blob://video', videoUri: 'gs://video' },
      completedJob: createJob({ status: 'completed' })
    });

    expect(updateAsset).toHaveBeenCalledWith('task-1', {
      status: 'COMPLETED',
      url: 'blob://video',
      videoUri: 'gs://video'
    });
    expect(setAssets).toHaveBeenCalledTimes(1);
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('starts a review by persisting the review job and optionally syncing task view', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.startReview(createJob({ status: 'reviewing' }), true);
    await controller.startReview(createJob({ status: 'reviewing', updatedAt: 1710000000002 }), false);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('starts auto revision by persisting both revising and executing jobs', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView: vi.fn().mockResolvedValue(undefined),
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.startAutoRevision([
      createJob({ status: 'revising' }),
      createJob({ status: 'executing', updatedAt: 1710000000002 })
    ]);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveAgentJobSnapshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'revising' }));
    expect(saveAgentJobSnapshot).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'executing' }));
  });

  it('resolves a primary review by persisting the resolved job and applying the surface policy', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.resolvePrimaryReview(createJob({ status: 'requires_action' }), true);
    await controller.resolvePrimaryReview(createJob({ status: 'completed', updatedAt: 1710000000002 }), false);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });

  it('resolves an auto revision by persisting the resolved job and applying the surface policy', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const controller = createGenerationTaskRuntimeController({
      jobRuntime: {
        jobRef: { current: createJob() },
        saveAgentJobSnapshot
      },
      taskRuntime: {
        options: {
          projectName: 'Project One',
          fallbackPrompt: 'poster',
          viewId: 'task-1'
        },
        deps: {
          taskViewsRef: { current: [] as BackgroundTaskView[] },
          setTaskViews: vi.fn(),
          saveTaskView,
          deleteTaskView: vi.fn().mockResolvedValue(undefined)
        }
      },
      assetRuntime: {
        options: {
          taskId: 'task-1',
          currentProjectId: 'project-1'
        },
        deps: {
          activeProjectIdRef: { current: 'project-1' },
          setAssets: vi.fn(),
          saveAsset: vi.fn().mockResolvedValue(undefined),
          updateAsset: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await controller.resolveAutoRevision(createJob({ status: 'requires_action' }), true);
    await controller.resolveAutoRevision(createJob({ status: 'completed', updatedAt: 1710000000002 }), false);

    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenCalledTimes(1);
  });
});

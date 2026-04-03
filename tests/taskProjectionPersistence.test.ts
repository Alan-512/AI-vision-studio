import { describe, expect, it, vi } from 'vitest';
import type { BackgroundTaskView } from '../types';
import {
  applyTaskViewDismissal,
  applyTaskViewProjectionResult,
  createTaskViewDismissalController,
  createTaskViewProjectionController,
  markTaskViewVisibleComplete,
  persistTaskViewPersistencePlan,
  upsertDerivedTaskViewForJob
} from '../services/taskProjectionPersistence';

const createTaskView = (id: string): BackgroundTaskView => ({
  id,
  jobId: `job-${id}`,
  projectId: 'project-1',
  projectName: 'Project One',
  type: 'IMAGE',
  status: 'COMPLETED',
  startTime: 1710000000000,
  prompt: id
});

describe('taskProjectionPersistence', () => {
  it('persists task-view plans through injected save/delete adapters', async () => {
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const taskA = createTaskView('task-a');
    const taskB = createTaskView('task-b');

    await persistTaskViewPersistencePlan({
      taskViewsToSave: [taskA, taskB],
      taskViewIdsToDelete: ['stale-task']
    }, {
      saveTaskView,
      deleteTaskView
    });

    expect(saveTaskView).toHaveBeenCalledTimes(2);
    expect(saveTaskView).toHaveBeenNthCalledWith(1, taskA);
    expect(saveTaskView).toHaveBeenNthCalledWith(2, taskB);
    expect(deleteTaskView).toHaveBeenCalledTimes(1);
    expect(deleteTaskView).toHaveBeenCalledWith('stale-task');
  });

  it('applies a projection result to ref/state and persists the plan', async () => {
    const setTaskViews = vi.fn();
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const nextTaskViews = [createTaskView('next-task')];
    const taskViewsRef = {
      current: [createTaskView('old-task')]
    };

    await applyTaskViewProjectionResult({
      nextTaskViews,
      persistencePlan: {
        taskViewsToSave: nextTaskViews,
        taskViewIdsToDelete: ['old-task']
      }
    }, {
      taskViewsRef,
      setTaskViews,
      saveTaskView,
      deleteTaskView
    });

    expect(taskViewsRef.current).toEqual(nextTaskViews);
    expect(setTaskViews).toHaveBeenCalledWith(nextTaskViews);
    expect(saveTaskView).toHaveBeenCalledWith(nextTaskViews[0]);
    expect(deleteTaskView).toHaveBeenCalledWith('old-task');
  });

  it('applies a dismissal result by updating ref/state and deleting dismissed ids', async () => {
    const setTaskViews = vi.fn();
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const remainingTaskViews = [createTaskView('keep-task')];
    const taskViewsRef = {
      current: [createTaskView('keep-task'), createTaskView('dismiss-task')]
    };

    await applyTaskViewDismissal({
      remainingTaskViews,
      dismissedTaskIds: ['dismiss-task']
    }, {
      taskViewsRef,
      setTaskViews,
      deleteTaskView
    });

    expect(taskViewsRef.current).toEqual(remainingTaskViews);
    expect(setTaskViews).toHaveBeenCalledWith(remainingTaskViews);
    expect(deleteTaskView).toHaveBeenCalledWith('dismiss-task');
  });

  it('derives and persists a task view directly from an agent job snapshot', async () => {
    const setTaskViews = vi.fn();
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const taskViewsRef = {
      current: [] as BackgroundTaskView[]
    };

    const derived = await upsertDerivedTaskViewForJob({
      id: 'job-1',
      projectId: 'project-1',
      type: 'IMAGE_GENERATION',
      status: 'queued',
      createdAt: 1710000000000,
      updatedAt: 1710000000001,
      source: 'studio',
      steps: [],
      artifacts: []
    }, {
      projectName: 'Project One',
      fallbackPrompt: 'poster',
      viewId: 'task-1'
    }, {
      taskViewsRef,
      setTaskViews,
      saveTaskView,
      deleteTaskView
    });

    expect(derived).toMatchObject({
      id: 'task-1',
      jobId: 'job-1',
      projectName: 'Project One',
      prompt: 'poster',
      status: 'QUEUED'
    });
    expect(taskViewsRef.current).toEqual([derived]);
    expect(setTaskViews).toHaveBeenCalledWith([derived]);
    expect(saveTaskView).toHaveBeenCalledWith(derived);
  });

  it('marks a job-backed task view visible complete through the projection adapter', async () => {
    const setTaskViews = vi.fn();
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const taskViewsRef = {
      current: [] as BackgroundTaskView[]
    };

    const completed = await markTaskViewVisibleComplete({
      id: 'job-1',
      projectId: 'project-1',
      type: 'IMAGE_GENERATION',
      status: 'executing',
      createdAt: 1710000000000,
      updatedAt: 1710000000001,
      source: 'studio',
      currentStepId: 'step-1',
      lastError: 'stale error',
      steps: [],
      artifacts: []
    }, {
      projectName: 'Project One',
      fallbackPrompt: 'poster',
      viewId: 'task-1'
    }, {
      taskViewsRef,
      setTaskViews,
      saveTaskView,
      deleteTaskView
    });

    expect(completed).toMatchObject({
      id: 'task-1',
      status: 'COMPLETED'
    });
    expect(saveTaskView).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      status: 'COMPLETED'
    }));
  });

  it('creates a projection controller that reuses shared task-view deps and options', async () => {
    const setTaskViews = vi.fn();
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const taskViewsRef = {
      current: [] as BackgroundTaskView[]
    };
    const controller = createTaskViewProjectionController({
      options: {
        projectName: 'Project One',
        fallbackPrompt: 'poster',
        viewId: 'task-1'
      },
      deps: {
        taskViewsRef,
        setTaskViews,
        saveTaskView,
        deleteTaskView
      }
    });

    const queued = await controller.upsertForJob({
      id: 'job-1',
      projectId: 'project-1',
      type: 'IMAGE_GENERATION',
      status: 'queued',
      createdAt: 1710000000000,
      updatedAt: 1710000000001,
      source: 'studio',
      steps: [],
      artifacts: []
    });

    const completed = await controller.markVisibleComplete({
      id: 'job-1',
      projectId: 'project-1',
      type: 'IMAGE_GENERATION',
      status: 'executing',
      createdAt: 1710000000000,
      updatedAt: 1710000000002,
      source: 'studio',
      currentStepId: 'step-1',
      steps: [],
      artifacts: []
    });

    expect(queued).toMatchObject({
      id: 'task-1',
      status: 'QUEUED'
    });
    expect(completed).toMatchObject({
      id: 'task-1',
      status: 'COMPLETED'
    });
    expect(saveTaskView).toHaveBeenCalledTimes(2);

    await controller.dismissById('task-1');
    expect(deleteTaskView).toHaveBeenCalledWith('task-1');

    taskViewsRef.current = [createTaskView('done-a'), createTaskView('done-b')];
    await controller.clearDismissable();
    expect(deleteTaskView).toHaveBeenCalledWith('done-a');
    expect(deleteTaskView).toHaveBeenCalledWith('done-b');
  });

  it('creates a dismissal controller for shared task-view cleanup actions', async () => {
    const setTaskViews = vi.fn();
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const taskViewsRef = {
      current: [createTaskView('keep-a'), createTaskView('keep-b')]
    };
    const controller = createTaskViewDismissalController({
      taskViewsRef,
      setTaskViews,
      deleteTaskView
    });

    await controller.dismissById('keep-a');
    expect(deleteTaskView).toHaveBeenCalledWith('keep-a');

    taskViewsRef.current = [createTaskView('done-a'), createTaskView('done-b')];
    await controller.clearDismissable();
    expect(deleteTaskView).toHaveBeenCalledWith('done-a');
    expect(deleteTaskView).toHaveBeenCalledWith('done-b');
  });
});

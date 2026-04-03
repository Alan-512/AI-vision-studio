import { describe, expect, it } from 'vitest';
import type { AgentJob, BackgroundTaskView } from '../types';
import {
  buildTaskViewPersistencePlan,
  clearDismissableTaskViews,
  createTaskViewIntent,
  dismissTaskViewById,
  dismissTaskViewsByIds,
  planTaskViewSyncForJob,
  planTaskViewUpsertForJob,
  deriveBackgroundTaskViews,
  deriveBackgroundTaskView,
  getBackgroundTaskViewStatus,
  isDismissableTaskView,
  syncTaskViewsForJob,
  upsertTaskViewForJob
} from '../services/taskReadModel';

const now = 1710000000000;

const createJob = (status: AgentJob['status']): AgentJob => ({
  id: `job-${status}`,
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status,
  createdAt: now - 5000,
  updatedAt: now,
  source: 'chat',
  steps: [
    {
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: status === 'executing' ? 'running' : 'success',
      input: {
        prompt: 'cinematic poster'
      },
      startTime: now - 4000
    }
  ],
  artifacts: []
});

describe('taskReadModel', () => {
  it('maps runtime job statuses into task-view statuses', () => {
    expect(getBackgroundTaskViewStatus('queued')).toBe('QUEUED');
    expect(getBackgroundTaskViewStatus('executing')).toBe('GENERATING');
    expect(getBackgroundTaskViewStatus('reviewing')).toBe('REVIEWING');
    expect(getBackgroundTaskViewStatus('requires_action')).toBe('ACTION_REQUIRED');
    expect(getBackgroundTaskViewStatus('completed')).toBe('COMPLETED');
    expect(getBackgroundTaskViewStatus('failed')).toBe('FAILED');
    expect(getBackgroundTaskViewStatus('cancelled')).toBe('FAILED');
    expect(getBackgroundTaskViewStatus('interrupted')).toBe('FAILED');
  });

  it('derives a background task view from an agent job snapshot', () => {
    const job = createJob('executing');

    const view = deriveBackgroundTaskView(job, {
      projectName: 'Project One'
    });

    expect(view).toEqual<BackgroundTaskView>({
      id: 'job-executing',
      jobId: 'job-executing',
      projectId: 'project-1',
      projectName: 'Project One',
      type: 'IMAGE',
      status: 'GENERATING',
      startTime: now - 5000,
      executionStartTime: now - 4000,
      prompt: 'cinematic poster',
      error: undefined
    });
  });

  it('emits cancel intent for active task views', () => {
    const taskView: BackgroundTaskView = {
      id: 'view-1',
      jobId: 'job-1',
      projectId: 'project-1',
      projectName: 'Project One',
      type: 'IMAGE',
      status: 'REVIEWING',
      startTime: now,
      prompt: 'poster'
    };

    expect(createTaskViewIntent(taskView)).toEqual({
      type: 'cancel_job',
      taskId: 'view-1',
      jobId: 'job-1'
    });
  });

  it('emits dismiss intent for terminal task views', () => {
    const taskView: BackgroundTaskView = {
      id: 'view-2',
      jobId: 'job-2',
      projectId: 'project-1',
      projectName: 'Project One',
      type: 'IMAGE',
      status: 'COMPLETED',
      startTime: now,
      prompt: 'poster'
    };

    expect(createTaskViewIntent(taskView)).toEqual({
      type: 'dismiss_task_view',
      taskId: 'view-2',
      jobId: 'job-2'
    });
    expect(isDismissableTaskView(taskView)).toBe(true);
  });

  it('reconciles persisted task views with recovered jobs using job-derived status', () => {
    const recoveredJob = createJob('interrupted');
    const persistedViews: BackgroundTaskView[] = [
      {
        id: 'task-view-1',
        jobId: 'job-interrupted',
        projectId: 'project-1',
        projectName: 'Old Project Name',
        type: 'IMAGE',
        status: 'GENERATING',
        startTime: now - 7000,
        executionStartTime: now - 6000,
        prompt: 'stale prompt'
      }
    ];

    const views = deriveBackgroundTaskViews({
      jobs: [recoveredJob],
      persistedTaskViews: persistedViews,
      projectNamesById: {
        'project-1': 'Recovered Project'
      }
    });

    expect(views).toEqual([
      {
        id: 'task-view-1',
        jobId: 'job-interrupted',
        projectId: 'project-1',
        projectName: 'Recovered Project',
        type: 'IMAGE',
        status: 'FAILED',
        startTime: now - 5000,
        executionStartTime: now - 4000,
        prompt: 'cinematic poster',
        error: undefined
      }
    ]);
  });

  it('syncs matching task views from a resolved job snapshot', () => {
    const existingViews: BackgroundTaskView[] = [
      {
        id: 'task-view-3',
        jobId: 'job-completed',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'ACTION_REQUIRED',
        startTime: now - 8000,
        prompt: 'old prompt',
        error: 'Needs review'
      },
      {
        id: 'task-view-other',
        jobId: 'job-other',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 2000,
        prompt: 'other'
      }
    ];

    const resolvedJob: AgentJob = {
      ...createJob('completed'),
      id: 'job-completed',
      lastError: undefined,
      steps: [
        {
          id: 'step-finished',
          kind: 'system',
          name: 'keep_current_requires_action',
          status: 'success',
          input: {
            prompt: 'resolved prompt'
          },
          startTime: now - 3000
        }
      ]
    };

    const synced = syncTaskViewsForJob(existingViews, resolvedJob, {
      projectName: 'Project One'
    });

    expect(synced).toEqual([
      {
        id: 'task-view-3',
        jobId: 'job-completed',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 5000,
        executionStartTime: now - 3000,
        prompt: 'old prompt',
        error: undefined
      },
      existingViews[1]
    ]);
  });

  it('upserts a derived task view when a job enters execution', () => {
    const queuedView: BackgroundTaskView = {
      id: 'task-view-queued',
      jobId: 'job-executing',
      projectId: 'project-1',
      projectName: 'Project One',
      type: 'IMAGE',
      status: 'QUEUED',
      startTime: now - 9000,
      prompt: 'queued prompt'
    };

    const runningJob = createJob('executing');
    const nextViews = upsertTaskViewForJob([queuedView], runningJob, {
      projectName: 'Project One',
      viewId: 'task-view-queued',
      fallbackPrompt: queuedView.prompt
    });

    expect(nextViews).toEqual([
      {
        id: 'task-view-queued',
        jobId: 'job-executing',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'GENERATING',
        startTime: now - 5000,
        executionStartTime: now - 4000,
        prompt: 'cinematic poster',
        error: undefined
      }
    ]);
  });

  it('upserts a queued task view from a queued job snapshot', () => {
    const queuedJob = createJob('queued');

    const nextViews = upsertTaskViewForJob([], queuedJob, {
      projectName: 'Project One',
      viewId: 'queued-view',
      fallbackPrompt: 'fallback prompt'
    });

    expect(nextViews).toEqual([
      {
        id: 'queued-view',
        jobId: 'job-queued',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'QUEUED',
        startTime: now - 5000,
        executionStartTime: now - 4000,
        prompt: 'cinematic poster',
        error: undefined
      }
    ]);
  });

  it('clears only dismissable task views', () => {
    const taskViews: BackgroundTaskView[] = [
      {
        id: 'active-view',
        jobId: 'job-active',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'GENERATING',
        startTime: now,
        prompt: 'active'
      },
      {
        id: 'done-view',
        jobId: 'job-done',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 1,
        prompt: 'done'
      },
      {
        id: 'blocked-view',
        jobId: 'job-blocked',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'ACTION_REQUIRED',
        startTime: now - 2,
        prompt: 'blocked'
      }
    ];

    expect(clearDismissableTaskViews(taskViews)).toEqual({
      remainingTaskViews: [taskViews[0]],
      dismissedTaskIds: ['done-view', 'blocked-view']
    });
  });

  it('dismisses a single task view by id without affecting others', () => {
    const taskViews: BackgroundTaskView[] = [
      {
        id: 'keep-view',
        jobId: 'job-keep',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'GENERATING',
        startTime: now,
        prompt: 'keep'
      },
      {
        id: 'dismiss-view',
        jobId: 'job-dismiss',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 1,
        prompt: 'dismiss'
      }
    ];

    expect(dismissTaskViewById(taskViews, 'dismiss-view')).toEqual({
      remainingTaskViews: [taskViews[0]],
      dismissedTaskIds: ['dismiss-view']
    });
  });

  it('dismisses multiple task views by id and ignores missing ids', () => {
    const taskViews: BackgroundTaskView[] = [
      {
        id: 'keep-view',
        jobId: 'job-keep',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'GENERATING',
        startTime: now,
        prompt: 'keep'
      },
      {
        id: 'dismiss-a',
        jobId: 'job-a',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 1,
        prompt: 'dismiss-a'
      },
      {
        id: 'dismiss-b',
        jobId: 'job-b',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'FAILED',
        startTime: now - 2,
        prompt: 'dismiss-b'
      }
    ];

    expect(dismissTaskViewsByIds(taskViews, ['dismiss-b', 'missing-id', 'dismiss-a'])).toEqual({
      remainingTaskViews: [taskViews[0]],
      dismissedTaskIds: ['dismiss-a', 'dismiss-b']
    });
  });

  it('builds a persistence plan that updates derived views and removes stale job-backed cache entries', () => {
    const previousTaskViews: BackgroundTaskView[] = [
      {
        id: 'stale-job-view',
        jobId: 'job-old',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'FAILED',
        startTime: now - 3,
        prompt: 'stale'
      },
      {
        id: 'orphan-view',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 2,
        prompt: 'orphan'
      }
    ];

    const nextTaskViews: BackgroundTaskView[] = [
      {
        id: 'job-new-view',
        jobId: 'job-new',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'QUEUED',
        startTime: now - 1,
        prompt: 'new'
      },
      previousTaskViews[1]
    ];

    expect(buildTaskViewPersistencePlan(previousTaskViews, nextTaskViews)).toEqual({
      taskViewsToSave: [nextTaskViews[0]],
      taskViewIdsToDelete: ['stale-job-view']
    });
  });

  it('plans a task-view upsert without persisting unchanged derived views', () => {
    const job = createJob('executing');
    const existingView = deriveBackgroundTaskView(job, {
      projectName: 'Project One',
      viewId: 'task-view-same'
    });

    expect(planTaskViewUpsertForJob([existingView], job, {
      projectName: 'Project One',
      viewId: 'task-view-same'
    })).toEqual({
      nextTaskViews: [existingView],
      persistencePlan: {
        taskViewsToSave: [],
        taskViewIdsToDelete: []
      }
    });
  });

  it('plans a task-view sync for a resolved job and persists only changed matching views', () => {
    const existingViews: BackgroundTaskView[] = [
      {
        id: 'task-view-3',
        jobId: 'job-completed',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'ACTION_REQUIRED',
        startTime: now - 8000,
        prompt: 'old prompt',
        error: 'Needs review'
      },
      {
        id: 'task-view-other',
        jobId: 'job-other',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'COMPLETED',
        startTime: now - 2000,
        prompt: 'other'
      }
    ];

    const resolvedJob: AgentJob = {
      ...createJob('completed'),
      id: 'job-completed',
      lastError: undefined,
      steps: [
        {
          id: 'step-finished',
          kind: 'system',
          name: 'keep_current_requires_action',
          status: 'success',
          input: {
            prompt: 'resolved prompt'
          },
          startTime: now - 3000
        }
      ]
    };

    expect(planTaskViewSyncForJob(existingViews, resolvedJob, {
      projectName: 'Project One'
    })).toEqual({
      nextTaskViews: [
        {
          id: 'task-view-3',
          jobId: 'job-completed',
          projectId: 'project-1',
          projectName: 'Project One',
          type: 'IMAGE',
          status: 'COMPLETED',
          startTime: now - 5000,
          executionStartTime: now - 3000,
          prompt: 'old prompt',
          error: undefined
        },
        existingViews[1]
      ],
      persistencePlan: {
        taskViewsToSave: [
          {
            id: 'task-view-3',
            jobId: 'job-completed',
            projectId: 'project-1',
            projectName: 'Project One',
            type: 'IMAGE',
            status: 'COMPLETED',
            startTime: now - 5000,
            executionStartTime: now - 3000,
            prompt: 'old prompt',
            error: undefined
          }
        ],
        taskViewIdsToDelete: []
      }
    });
  });
});

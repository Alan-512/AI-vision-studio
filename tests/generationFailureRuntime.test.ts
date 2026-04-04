import { describe, expect, it, vi } from 'vitest';
import { AppMode, type AgentJob, type AssetItem } from '../types';
import { resolveGenerationFailure } from '../services/generationFailureRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'executing',
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
  source: 'studio',
  steps: [{
    id: 'step-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'running',
    startTime: 1710000000000,
    input: { prompt: 'poster' }
  }],
  artifacts: [],
  ...overrides
});

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'asset-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://image',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

describe('generationFailureRuntime', () => {
  it('cancels a generation attempt through the task runtime', async () => {
    const cancel = vi.fn().mockResolvedValue({ events: [{ type: 'JobCancelled' }] });

    const result = await resolveGenerationFailure({
      mode: AppMode.IMAGE,
      agentJob: createJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      error: new Error('Cancelled'),
      deps: {
        taskRuntime: {
          cancel,
          recoverVisibleAsset: vi.fn(),
          fail: vi.fn()
        },
        addToast: vi.fn(),
        playErrorSound: vi.fn(),
        setCooldown: vi.fn(),
        getFriendlyError: message => message,
        language: 'en',
        now: () => 1710000000100
      }
    });

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), 'task-1');
    expect(result.toolResult.status).toBe('error');
    expect(result.toolResult.metadata?.runtimeEvents).toMatchObject([{ type: 'JobCancelled' }]);
  });

  it('recovers a visible image asset when post-review fails', async () => {
    const recoverVisibleAsset = vi.fn().mockResolvedValue({ events: [{ type: 'JobCompleted' }] });
    const addToast = vi.fn();

    const result = await resolveGenerationFailure({
      mode: AppMode.IMAGE,
      agentJob: createJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      latestVisibleAsset: createAsset(),
      taskMarkedVisibleComplete: false,
      error: new Error('review failed'),
      deps: {
        taskRuntime: {
          cancel: vi.fn(),
          recoverVisibleAsset,
          fail: vi.fn()
        },
        addToast,
        playErrorSound: vi.fn(),
        setCooldown: vi.fn(),
        getFriendlyError: message => message,
        language: 'en',
        now: () => 1710000000200
      }
    });

    expect(recoverVisibleAsset).toHaveBeenCalledWith({
      recoveredJob: expect.objectContaining({ status: 'completed' }),
      visibleJob: expect.objectContaining({ id: 'job-1' }),
      shouldMarkVisibleComplete: true
    });
    expect(addToast).toHaveBeenCalledWith('info', 'Image ready; post-review did not finish', 'review failed');
    expect(result.toolResult.status).toBe('success');
    expect(result.taskMarkedVisibleComplete).toBe(true);
    expect(result.toolResult.metadata?.runtimeEvents).toMatchObject([{ type: 'JobCompleted' }]);
  });

  it('fails a generation attempt and applies retry cooldown when retryable', async () => {
    const fail = vi.fn().mockResolvedValue({ events: [{ type: 'JobFailed' }] });
    const addToast = vi.fn();
    const playErrorSound = vi.fn();
    const setCooldown = vi.fn();

    const result = await resolveGenerationFailure({
      mode: AppMode.VIDEO,
      agentJob: createJob({ type: 'VIDEO_GENERATION' }),
      stepId: 'step-1',
      taskId: 'task-1',
      error: new Error('429 RESOURCE_EXHAUSTED'),
      deps: {
        taskRuntime: {
          cancel: vi.fn(),
          recoverVisibleAsset: vi.fn(),
          fail
        },
        addToast,
        playErrorSound,
        setCooldown,
        getFriendlyError: () => 'Friendly quota error',
        language: 'en',
        now: () => 1710000000300
      }
    });

    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(playErrorSound).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('error', 'task.failed', 'Friendly quota error');
    expect(setCooldown).toHaveBeenCalledWith(1710000000300 + 60000);
    expect(result.toolResult.status).toBe('error');
    expect(result.toolResult.metadata?.runtimeEvents).toMatchObject([{ type: 'JobFailed' }]);
  });
});

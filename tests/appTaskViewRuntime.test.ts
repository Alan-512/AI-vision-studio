import { describe, expect, it, vi } from 'vitest';
import { createAppTaskViewController } from '../services/appTaskViewRuntime';

describe('appTaskViewRuntime', () => {
  it('dismisses the task view and aborts active controllers when cancelling', () => {
    const dismissById = vi.fn().mockResolvedValue(undefined);
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn();
    const setAssets = vi.fn();

    const controller = createAppTaskViewController({
      taskViewDismissal: { dismissById, clearDismissable: vi.fn() } as any,
      taskControllers: { current: { 'task-1': { abort } } },
      deleteAssetPermanently,
      activeProjectIdRef: { current: 'project-1' },
      getActiveProjectId: () => 'project-1',
      setAssets
    });

    controller.cancelTask('task-1');

    expect(dismissById).toHaveBeenCalledWith('task-1');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(deleteAssetPermanently).toHaveBeenCalledWith('task-1');
    expect(setAssets).toHaveBeenCalledTimes(1);
  });

  it('routes task intents to cancel or dismiss', () => {
    const dismissById = vi.fn().mockResolvedValue(undefined);
    const controller = createAppTaskViewController({
      taskViewDismissal: { dismissById, clearDismissable: vi.fn().mockResolvedValue(undefined) } as any,
      taskControllers: { current: {} },
      deleteAssetPermanently: vi.fn(),
      activeProjectIdRef: { current: 'project-1' },
      getActiveProjectId: () => 'project-1',
      setAssets: vi.fn()
    });

    controller.handleTaskViewIntent({ type: 'cancel_job', taskId: 'task-1', jobId: 'job-1' });
    controller.handleTaskViewIntent({ type: 'dismiss_task_view', taskId: 'task-2' });

    expect(dismissById).toHaveBeenNthCalledWith(1, 'task-1');
    expect(dismissById).toHaveBeenNthCalledWith(2, 'task-2');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createAppTaskViewController } from '../services/appTaskViewRuntime';

describe('appTaskViewRuntime', () => {
  it('dismisses the task view after kernel cancel settles and aborts active controllers', async () => {
    const dismissById = vi.fn().mockResolvedValue(undefined);
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    let resolveDispatch: (() => void) | undefined;
    const dispatchKernelCommand = vi.fn().mockImplementation(() => new Promise<void>(resolve => {
      resolveDispatch = resolve;
    }));
    const abort = vi.fn();
    const setAssets = vi.fn();

    const controller = createAppTaskViewController({
      taskViewDismissal: { dismissById, clearDismissable: vi.fn() } as any,
      taskControllers: { current: { 'task-1': { abort } } },
      deleteAssetPermanently,
      activeProjectIdRef: { current: 'project-1' },
      getActiveProjectId: () => 'project-1',
      setAssets,
      dispatchKernelCommand
    });

    const cancellation = controller.cancelTask('task-1', 'job-1');

    expect(dispatchKernelCommand).toHaveBeenCalledWith({
      type: 'CancelJob',
      jobId: 'job-1',
      reason: 'Cancelled from task center'
    });
    expect(dismissById).not.toHaveBeenCalled();

    resolveDispatch?.();
    await cancellation;

    expect(dismissById).toHaveBeenCalledWith('task-1');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(deleteAssetPermanently).toHaveBeenCalledWith('task-1');
    expect(setAssets).toHaveBeenCalledTimes(1);
  });

  it('routes task intents to cancel or dismiss', async () => {
    const dismissById = vi.fn().mockResolvedValue(undefined);
    const controller = createAppTaskViewController({
      taskViewDismissal: { dismissById, clearDismissable: vi.fn().mockResolvedValue(undefined) } as any,
      taskControllers: { current: {} },
      deleteAssetPermanently: vi.fn(),
      activeProjectIdRef: { current: 'project-1' },
      getActiveProjectId: () => 'project-1',
      setAssets: vi.fn(),
      dispatchKernelCommand: vi.fn().mockResolvedValue(undefined)
    });

    await controller.handleTaskViewIntent({ type: 'cancel_job', taskId: 'task-1', jobId: 'job-1' });
    await controller.handleTaskViewIntent({ type: 'dismiss_task_view', taskId: 'task-2' });

    expect(dismissById).toHaveBeenNthCalledWith(1, 'task-1');
    expect(dismissById).toHaveBeenNthCalledWith(2, 'task-2');
  });
});

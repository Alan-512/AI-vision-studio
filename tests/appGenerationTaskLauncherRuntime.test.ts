import { describe, expect, it, vi } from 'vitest';
import { launchAppGenerationTasks } from '../services/appGenerationTaskLauncherRuntime';

describe('appGenerationTaskLauncherRuntime', () => {
  it('launches the requested number of generation tasks', async () => {
    const launchPreparedTask = vi.fn()
      .mockResolvedValueOnce({ status: 'success', summary: 'one' })
      .mockResolvedValueOnce({ status: 'success', summary: 'two' });

    const results = await launchAppGenerationTasks({
      count: 2,
      createLaunchInput: index => ({ taskIndex: index }),
      launchPreparedTask
    });

    expect(launchPreparedTask).toHaveBeenCalledTimes(2);
    expect(launchPreparedTask).toHaveBeenNthCalledWith(1, { taskIndex: 0 });
    expect(launchPreparedTask).toHaveBeenNthCalledWith(2, { taskIndex: 1 });
    expect(results).toEqual([
      { status: 'success', summary: 'one' },
      { status: 'success', summary: 'two' }
    ]);
  });
});

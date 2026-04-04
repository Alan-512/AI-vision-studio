import { describe, expect, it, vi } from 'vitest';
import { createChatSurfaceController } from '../services/chatSurfaceController';

describe('chatSurfaceController', () => {
  it('routes surface actions to the injected runtimes', async () => {
    const stopStreaming = vi.fn();
    const executeSendFlow = vi.fn().mockResolvedValue(undefined);
    const dismissActionCard = vi.fn().mockResolvedValue(undefined);
    const applyActionCard = vi.fn().mockResolvedValue(undefined);

    const controller = createChatSurfaceController({
      stopStreaming,
      executeSendFlow,
      dismissActionCard,
      applyActionCard
    });

    controller.handleStop();
    await controller.handleSend('hello');
    await controller.handleDismissActionCard({ id: 'tc-1' } as any);
    await controller.handleApplyActionCard({ id: 'tc-2' } as any);

    expect(stopStreaming).toHaveBeenCalledTimes(1);
    expect(executeSendFlow).toHaveBeenCalledWith('hello');
    expect(dismissActionCard).toHaveBeenCalledWith({ id: 'tc-1' });
    expect(applyActionCard).toHaveBeenCalledWith({ id: 'tc-2' });
  });
});

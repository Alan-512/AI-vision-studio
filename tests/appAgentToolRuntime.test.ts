import { describe, expect, it, vi } from 'vitest';
import { createAppAgentToolExecutor } from '../services/appAgentToolRuntime';

describe('appAgentToolRuntime', () => {
  it('executes tool calls sequentially and returns ordered results', async () => {
    const executeToolCall = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'success',
        toolName: 'generate_image',
        jobId: 'job-1'
      })
      .mockResolvedValueOnce({
        status: 'error',
        toolName: 'generate_video',
        jobId: '',
        error: 'failed'
      });

    const executeToolCalls = createAppAgentToolExecutor({ executeToolCall });
    const result = await executeToolCalls({
      type: 'ExecuteToolCalls',
      turnId: 'turn-1',
      toolCalls: [
        {
          toolName: 'generate_image',
          args: { prompt: 'image' }
        },
        {
          toolName: 'generate_video',
          args: { prompt: 'video' }
        }
      ]
    });

    expect(executeToolCall).toHaveBeenNthCalledWith(1, {
      toolName: 'generate_image',
      args: { prompt: 'image' }
    });
    expect(executeToolCall).toHaveBeenNthCalledWith(2, {
      toolName: 'generate_video',
      args: { prompt: 'video' }
    });
    expect(result).toEqual([
      {
        status: 'success',
        toolName: 'generate_image',
        jobId: 'job-1'
      },
      {
        status: 'error',
        toolName: 'generate_video',
        jobId: '',
        error: 'failed'
      }
    ]);
  });
});

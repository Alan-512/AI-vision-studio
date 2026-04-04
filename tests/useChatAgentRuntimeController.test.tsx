import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImageModel, type AgentAction, type ChatMessage, type GenerationParams } from '../types';
import { useChatAgentRuntimeController } from '../services/useChatAgentRuntimeController';

const createParams = (): GenerationParams => ({
  prompt: '',
  savedImagePrompt: '',
  savedVideoPrompt: '',
  aspectRatio: '1:1' as any,
  imageModel: ImageModel.FLASH_3_1,
  imageStyle: undefined as any,
  imageResolution: '1K' as any,
  videoModel: undefined as any,
  videoStyle: undefined as any,
  videoResolution: undefined as any,
  videoDuration: undefined as any,
  useGrounding: false,
  searchPolicy: undefined as any,
  smartAssets: [],
  isAutoMode: true
});

describe('useChatAgentRuntimeController', () => {
  it('exposes agent surface status and resets runtime when project changes', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    const historyRef = { current: [] as ChatMessage[] };
    const onToolCall = vi.fn().mockResolvedValue({ status: 'success', artifactIds: ['asset-1'] });
    const setToolCallStatus = vi.fn();
    const setToolCallExpanded = vi.fn();
    const states: string[] = [];

    const Harness = ({ projectId }: { projectId: string }) => {
      const { agentSurfaceStatus, handleToolCallWithRetry } = useChatAgentRuntimeController({
        projectId,
        params: createParams(),
        historyRef,
        onToolCall,
        setToolCallStatus,
        setToolCallExpanded
      });

      states.push(agentSurfaceStatus.kind);
      (globalThis as any).__fire = handleToolCallWithRetry;
      return null;
    };

    await act(async () => {
      root.render(<Harness projectId="project-a" />);
    });

    await act(async () => {
      await (globalThis as any).__fire({
        toolName: 'generate_image',
        args: { prompt: 'poster', model: ImageModel.FLASH_3_1 }
      } satisfies AgentAction);
    });

    await act(async () => {
      root.render(<Harness projectId="project-b" />);
    });

    expect(states).toContain('idle');
    expect(states[states.length - 1]).toBe('idle');

    await act(async () => {
      root.unmount();
    });
  });

  it('rethrows generate failures so chat surface callers can roll back optimistic UI', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    const historyRef = { current: [] as ChatMessage[] };
    const onToolCall = vi.fn().mockResolvedValue({
      status: 'error',
      error: 'Tool execution failed',
      retryable: false
    });

    const Harness = () => {
      const { handleToolCallWithRetry } = useChatAgentRuntimeController({
        projectId: 'project-a',
        params: createParams(),
        historyRef,
        onToolCall,
        setToolCallStatus: vi.fn(),
        setToolCallExpanded: vi.fn()
      });

      (globalThis as any).__fireFailure = handleToolCallWithRetry;
      return null;
    };

    await act(async () => {
      root.render(<Harness />);
    });

    let thrownError: unknown;
    await act(async () => {
      try {
        await (globalThis as any).__fireFailure({
          toolName: 'generate_image',
          args: { prompt: 'poster', model: ImageModel.FLASH_3_1 }
        } satisfies AgentAction);
      } catch (error) {
        thrownError = error;
      }
    });
    expect(thrownError).toMatchObject({
      message: 'Tool execution failed'
    });

    await act(async () => {
      root.unmount();
    });
  });
});

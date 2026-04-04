import { describe, expect, it, vi } from 'vitest';
import { AppMode, ImageModel, type AgentJob, type GenerationParams, type Project } from '../types';
import { prepareAppGenerationRequest } from '../services/appGenerationPreflightRuntime';

describe('appGenerationPreflightRuntime', () => {
  it('blocks generation during cooldown and emits an error toast', async () => {
    const addToast = vi.fn();

    const result = await prepareAppGenerationRequest({
      fullParams: { prompt: 'hi' } as GenerationParams,
      useParamsAsBase: false,
      params: { prompt: 'base' } as GenerationParams,
      mode: AppMode.IMAGE,
      activeProjectId: 'project-1',
      projects: [],
      videoCooldownEndTime: Date.now() + 1000,
      getUserApiKey: vi.fn(),
      sanitizeImageModel: value => value as ImageModel,
      setThoughtImages: vi.fn(),
      addToast,
      setShowSettings: vi.fn()
    });

    expect(result).toBeNull();
    expect(addToast).toHaveBeenCalledWith(
      'error',
      'System Cooled Down',
      'Please wait for the timer to finish before generating again.'
    );
  });

  it('opens settings when no user key is available', async () => {
    const setShowSettings = vi.fn();

    const result = await prepareAppGenerationRequest({
      fullParams: { prompt: 'hi' } as GenerationParams,
      useParamsAsBase: false,
      params: { prompt: 'base' } as GenerationParams,
      mode: AppMode.IMAGE,
      activeProjectId: 'project-1',
      projects: [],
      videoCooldownEndTime: 0,
      getUserApiKey: () => null,
      sanitizeImageModel: value => value as ImageModel,
      setThoughtImages: vi.fn(),
      addToast: vi.fn(),
      setShowSettings
    });

    expect(result).toBeNull();
    expect(setShowSettings).toHaveBeenCalledWith(true);
  });

  it('prepares normalized params and triggers project rename for untitled projects', async () => {
    const setProjects = vi.fn();
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const generateTitle = vi.fn().mockResolvedValue('New Title');
    const projects: Project[] = [{
      id: 'project-1',
      name: 'New Project',
      createdAt: 1,
      updatedAt: 1
    }];

    const result = await prepareAppGenerationRequest({
      fullParams: { prompt: 'make a poster', imageModel: 'bad-model' as any } as GenerationParams,
      useParamsAsBase: false,
      params: { prompt: 'base' } as GenerationParams,
      mode: AppMode.VIDEO,
      activeProjectId: 'project-1',
      projects,
      historyOverride: [{ role: 'user', content: 'hello', timestamp: 123 }],
      videoCooldownEndTime: 0,
      getUserApiKey: () => 'user-key',
      sanitizeImageModel: () => ImageModel.FLASH_3_1,
      setThoughtImages: vi.fn(),
      addToast: vi.fn(),
      setShowSettings: vi.fn(),
      generateTitle,
      setProjects,
      saveProject,
      jobSource: 'chat' as AgentJob['source'],
      resolveNewProjectLabel: () => 'New Project'
    });

    expect(result).toMatchObject({
      userKey: 'user-key',
      currentProjectId: 'project-1',
      currentMode: AppMode.VIDEO,
      resolvedJobSource: 'chat',
      triggerMessageTimestamp: 123
    });
    expect(result?.activeParams.imageModel).toBe(ImageModel.FLASH_3_1);
    await Promise.resolve();
    expect(generateTitle).toHaveBeenCalledWith('make a poster');
  });
});

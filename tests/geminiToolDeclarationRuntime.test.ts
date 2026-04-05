import { describe, expect, it } from 'vitest';
import {
  generateImageTool,
  memorySearchTool,
  updateMemoryTool
} from '../services/geminiToolDeclarationRuntime';

describe('geminiToolDeclarationRuntime', () => {
  it('defines the generate_image tool contract', () => {
    expect(generateImageTool.name).toBe('generate_image');
    expect(generateImageTool.parameters?.required).toEqual(expect.arrayContaining([
      'prompt',
      'model',
      'aspectRatio',
      'resolution',
      'assistant_mode'
    ]));
    expect((generateImageTool.parameters as any)?.properties).toMatchObject({
      sequence_intent: expect.any(Object),
      frame_index: expect.any(Object),
      frame_total: expect.any(Object),
      screen_focus: expect.any(Object),
      change_objective: expect.any(Object),
      stable_constraints: expect.any(Object)
    });
    expect(String((generateImageTool.parameters as any)?.properties?.prompt?.description)).toContain('For separate multi-image frame sequences');
    expect(String((generateImageTool.parameters as any)?.properties?.prompt?.description)).toContain('position');
    expect(String((generateImageTool.parameters as any)?.properties?.prompt?.description)).toContain('screen focus');
  });

  it('defines the update_memory tool contract', () => {
    expect(updateMemoryTool.name).toBe('update_memory');
    expect(updateMemoryTool.parameters?.required).toEqual(['scope', 'section', 'value']);
  });

  it('defines the memory_search tool contract', () => {
    expect(memorySearchTool.name).toBe('memory_search');
    expect(memorySearchTool.parameters?.required).toEqual(['query']);
  });
});

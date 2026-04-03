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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getMemoryDoc: vi.fn(),
  saveMemoryDoc: vi.fn(),
  deleteMemoryDoc: vi.fn(),
  getAllMemoryDocs: vi.fn(),
  getMemoryOps: vi.fn(),
  recordMemoryOp: vi.fn(),
  saveMemoryLog: vi.fn(),
  getMemoryLogs: vi.fn()
}));

vi.mock('../services/storageService', () => ({
  getMemoryDoc: storageMocks.getMemoryDoc,
  saveMemoryDoc: storageMocks.saveMemoryDoc,
  deleteMemoryDoc: storageMocks.deleteMemoryDoc,
  getAllMemoryDocs: storageMocks.getAllMemoryDocs,
  getMemoryOps: storageMocks.getMemoryOps,
  recordMemoryOp: storageMocks.recordMemoryOp,
  saveMemoryLog: storageMocks.saveMemoryLog,
  getMemoryLogs: storageMocks.getMemoryLogs
}));

import { getAlwaysOnMemorySnippet } from '../services/memoryService';

describe('MemoryService always-on snippets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read existing global and project memory docs into the layered always-on snippet', async () => {
    const projectId = 'project-compat-test';
    storageMocks.getMemoryDoc.mockImplementation(async (scope: string, targetId: string) => {
      if (scope === 'global' && targetId === 'default') {
        return {
          id: 'global:default',
          scope,
          targetId,
          content: `# Memory

## Guardrails
- Brand logos must stay accurate

## Visual Preferences
- preferred_style: minimalist editorial
`,
          version: 1,
          updatedAt: Date.now(),
          createdAt: Date.now()
        };
      }

      if (scope === 'project' && targetId === projectId) {
        return {
          id: `project:${projectId}`,
          scope,
          targetId,
          content: `# Memory

## Style Card
- primary_style: clean product photography
- lighting: soft window light

## Project Decisions
- Keep the composition centered on a white pedestal
`,
          version: 1,
          updatedAt: Date.now(),
          createdAt: Date.now()
        };
      }

      return null;
    });

    const snippet = await getAlwaysOnMemorySnippet(projectId);

    expect(snippet).toContain('Brand logos must stay accurate');
    expect(snippet).toContain('minimalist editorial');
    expect(snippet).toContain('project.primary_style: clean product photography');
    expect(snippet).toContain('current.direction: Keep the composition centered on a white pedestal');
  });
});

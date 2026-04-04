import { describe, expect, it } from 'vitest';
import { evaluateToolPermission } from '../services/toolPermissionRuntime';

describe('toolPermissionRuntime', () => {
  it('allows tool execution when no approval gate blocks it', () => {
    const result = evaluateToolPermission({
      toolName: 'memory_search',
      toolClass: 'interactive_tool',
      policy: 'allow'
    });

    expect(result).toEqual({
      allowed: true
    });
  });

  it('returns an auditable deny result when policy blocks the tool', () => {
    const result = evaluateToolPermission({
      toolName: 'generate_image',
      toolClass: 'job_tool',
      policy: 'deny',
      reason: 'Image generation disabled'
    });

    expect(result).toEqual({
      allowed: false,
      errorType: 'permission_denied',
      reason: 'Image generation disabled'
    });
  });
});

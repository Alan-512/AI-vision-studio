import { describe, expect, it } from 'vitest';
import type { AgentJob, ChatMessage, ToolCallRecord } from '../types';
import {
  removeChatMessageByTimestamp,
  resolveAgentJobKeepCurrent,
  resolveChatHistoryKeepCurrent,
  resolveToolCallAfterKeepCurrent,
  resolveToolCallRecordStatus
} from '../services/requiresActionRuntime';

describe('requiresActionRuntime', () => {
  it('maps requires_action results to a distinct tool-call lifecycle status', () => {
    expect(resolveToolCallRecordStatus('success')).toBe('success');
    expect(resolveToolCallRecordStatus('error')).toBe('failed');
    expect(resolveToolCallRecordStatus('requires_action')).toBe('requires_action');
  });

  it('resolves a tool call to keep-current without leaving requiresAction behind', () => {
    const now = 1710000000000;
    const record: ToolCallRecord = {
      id: 'tool-1',
      toolName: 'generate_image',
      args: { prompt: 'poster' },
      status: 'requires_action',
      completedAt: now - 1000,
      result: {
        jobId: 'job-1',
        toolName: 'generate_image',
        status: 'requires_action',
        error: 'Needs user review',
        requiresAction: {
          type: 'review_output',
          message: 'Need a decision'
        },
        metadata: {
          review: { decision: 'requires_action' }
        }
      }
    };

    const resolved = resolveToolCallAfterKeepCurrent(record, now);

    expect(resolved.status).toBe('success');
    expect(resolved.result?.status).toBe('success');
    expect(resolved.result?.requiresAction).toBeUndefined();
    expect(resolved.result?.error).toBeUndefined();
    expect((resolved.result?.metadata as any)?.resolution).toEqual({
      type: 'keep_current',
      resolvedAt: now
    });
  });

  it('updates the matching chat history message when the user keeps the current result', () => {
    const now = 1710000000000;
    const history: ChatMessage[] = [
      {
        role: 'model',
        content: 'draft',
        timestamp: now - 10,
        toolCalls: [
          {
            id: 'tool-1',
            toolName: 'generate_image',
            args: { prompt: 'poster' },
            status: 'requires_action',
            result: {
              jobId: 'job-1',
              toolName: 'generate_image',
              status: 'requires_action',
              requiresAction: {
                type: 'review_output',
                message: 'Need a decision'
              }
            }
          }
        ]
      },
      {
        role: 'model',
        content: 'other',
        timestamp: now - 5
      }
    ];

    const updated = resolveChatHistoryKeepCurrent(history, 'tool-1', now);
    const updatedRecord = updated[0].toolCalls?.[0];

    expect(updatedRecord?.status).toBe('success');
    expect(updatedRecord?.result?.status).toBe('success');
    expect(updatedRecord?.result?.requiresAction).toBeUndefined();
    expect(updated[1]).toEqual(history[1]);
  });

  it('marks the persisted agent job completed when the user keeps the current result', () => {
    const now = 1710000000000;
    const job: AgentJob = {
      id: 'job-1',
      projectId: 'project-1',
      type: 'IMAGE_GENERATION',
      status: 'requires_action',
      createdAt: now - 2000,
      updatedAt: now - 1000,
      source: 'chat',
      lastError: 'Needs review',
      requiresAction: {
        type: 'review_output',
        message: 'Need a decision'
      },
      steps: [],
      artifacts: []
    };

    const resolved = resolveAgentJobKeepCurrent(job, {
      now,
      stepId: 'step-keep',
      actionType: 'review_output',
      prompt: 'poster prompt'
    });

    expect(resolved.status).toBe('completed');
    expect(resolved.requiresAction).toBeUndefined();
    expect(resolved.lastError).toBeUndefined();
    expect(resolved.steps[0]).toMatchObject({
      id: 'step-keep',
      kind: 'system',
      name: 'keep_current_requires_action',
      status: 'success'
    });
  });

  it('removes an optimistic system message by timestamp when continue action fails', () => {
    const history: ChatMessage[] = [
      { role: 'model', content: 'before', timestamp: 1 },
      { role: 'user', content: 'optimistic', timestamp: 2, isSystem: true },
      { role: 'model', content: 'after', timestamp: 3 }
    ];

    expect(removeChatMessageByTimestamp(history, 2)).toEqual([
      { role: 'model', content: 'before', timestamp: 1 },
      { role: 'model', content: 'after', timestamp: 3 }
    ]);
  });
});

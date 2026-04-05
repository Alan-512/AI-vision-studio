import { describe, expect, it } from 'vitest';
import {
  annotateSeparateFrameToolCalls,
  buildSeparateFramePromptContract,
  buildSeparateFrameSequencePlan,
  normalizeSequenceAwarePrompt,
  shouldUseSeparateFrameContract
} from '../services/sequencePlanningRuntime';

describe('sequencePlanningRuntime', () => {
  it('annotates multiple generate_image calls as separate frames without touching other tools', () => {
    const annotated = annotateSeparateFrameToolCalls([
      { toolName: 'generate_image', args: { prompt: 'frame one' } },
      { toolName: 'memory_search', args: { query: 'style' } },
      { toolName: 'generate_image', args: { prompt: 'frame two' } }
    ]);

    expect(annotated[0].args).toMatchObject({
      sequence_intent: 'separate_frames',
      frame_index: 0,
      frame_total: 2
    });
    expect(annotated[1].args).toEqual({ query: 'style' });
    expect(annotated[2].args).toMatchObject({
      sequence_intent: 'separate_frames',
      frame_index: 1,
      frame_total: 2
    });
  });

  it('builds a frame-native prompt contract only for separate frame intents', () => {
    const plainPrompt = normalizeSequenceAwarePrompt({
      prompt: 'Create a four-panel storyboard.',
      rawArgs: {
        sequence_intent: 'multi_panel_single_image'
      }
    });

    const separateFramePrompt = normalizeSequenceAwarePrompt({
      prompt: 'Anchor walks toward center stage.',
      rawArgs: {
        sequence_intent: 'separate_frames',
        frame_index: 1,
        frame_total: 4
      }
    });

    expect(plainPrompt).toBe('Create a four-panel storyboard.');
    expect(separateFramePrompt).toContain('Frame 2 of 4.');
    expect(separateFramePrompt).toContain('Render exactly one standalone frame');
    expect(separateFramePrompt).toContain('Sequence trajectory');
  });

  it('detects separate frame contracts and leaves plain actions untouched', () => {
    expect(shouldUseSeparateFrameContract({
      sequence_intent: 'separate_frames'
    })).toBe(true);
    expect(shouldUseSeparateFrameContract({
      sequence_intent: 'multi_panel_single_image'
    })).toBe(false);
    expect(buildSeparateFramePromptContract({
      prompt: 'Anchor points at the map.',
      frameIndex: 0,
      frameTotal: 4
    })).toContain('single camera view');
  });

  it('builds a structured sequence plan for separate frame trajectories', () => {
    const plan = buildSeparateFrameSequencePlan({
      frameIndex: 2,
      frameTotal: 4
    });

    expect(plan.frameLabel).toBe('Frame 3 of 4');
    expect(plan.positionLabel).toBe('right-of-center');
    expect(plan.progressLabel).toBe('late progression');
    expect(plan.changeObjective).toContain('advance the host');
    expect(plan.changeObjective).toContain('gesture');
    expect(plan.changeObjective).toContain('body orientation');
    expect(plan.stableConstraints.join(' ')).toContain('same studio');
  });

  it('annotates multiple generate_image calls with a reusable frame plan', () => {
    const annotated = annotateSeparateFrameToolCalls([
      { toolName: 'generate_image', args: { prompt: 'frame one' } },
      { toolName: 'generate_image', args: { prompt: 'frame two' } },
      { toolName: 'generate_image', args: { prompt: 'frame three' } },
      { toolName: 'generate_image', args: { prompt: 'frame four' } }
    ]);

    expect(annotated[0].args.sequence_plan).toMatchObject({
      frameLabel: 'Frame 1 of 4',
      positionLabel: 'far left'
    });
    expect(annotated[3].args.sequence_plan).toMatchObject({
      frameLabel: 'Frame 4 of 4',
      positionLabel: 'far right'
    });
  });

  it('gives different motion beats to neighboring frames so poses do not collapse together', () => {
    const early = buildSeparateFrameSequencePlan({
      frameIndex: 1,
      frameTotal: 4
    });
    const late = buildSeparateFrameSequencePlan({
      frameIndex: 2,
      frameTotal: 4
    });

    expect(early.changeObjective).toContain('active pointing beat');
    expect(late.changeObjective).toContain('transition gesture');
    expect(early.changeObjective).toContain('left-side forecast area');
    expect(late.changeObjective).toContain('right-side forecast area');
    expect(early.changeObjective).not.toBe(late.changeObjective);
  });
});

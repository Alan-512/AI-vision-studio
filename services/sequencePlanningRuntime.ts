import type { AgentAction } from '../types';

// Sequence planning is a planning-transform layer, not a second runtime loop.
// It only activates when the planner emits multiple independent generate_image calls
// in the same assistant turn. This preserves single-image storyboard requests while
// giving separate-frame requests stronger frame-native semantics.

export type SequenceIntent = 'separate_frames' | 'multi_panel_single_image';
export type SequenceProgressLabel = 'opening' | 'early progression' | 'mid progression' | 'late progression' | 'final beat';

export type SeparateFrameSequencePlan = {
  frameLabel: string;
  positionLabel: string;
  progressLabel: SequenceProgressLabel;
  changeObjective: string;
  stableConstraints: string[];
};

export const SEPARATE_FRAME_SEQUENCE_INTENT: SequenceIntent = 'separate_frames';

const buildPositionLabel = (frameIndex: number, frameTotal: number) => {
  if (frameTotal <= 1) return 'center';
  const ratio = frameTotal === 1 ? 0 : frameIndex / (frameTotal - 1);
  if (ratio <= 0.125) return 'far left';
  if (ratio <= 0.375) return 'left-of-center';
  if (ratio <= 0.75) return 'right-of-center';
  return 'far right';
};

const buildProgressLabel = (frameIndex: number, frameTotal: number): SequenceProgressLabel => {
  if (frameTotal <= 1) return 'opening';
  if (frameIndex === 0) return 'opening';
  if (frameIndex === frameTotal - 1) return 'final beat';
  const ratio = frameIndex / (frameTotal - 1);
  if (ratio <= 0.34) return 'early progression';
  if (ratio < 0.6) return 'mid progression';
  return 'late progression';
};

const buildGestureCue = (frameIndex: number, frameTotal: number) => {
  if (frameTotal <= 1 || frameIndex === 0) {
    return 'Use an opening presenter gesture, with one hand introducing the forecast board.';
  }
  if (frameIndex === frameTotal - 1) {
    return 'Use a closing presenter gesture, with the host settled and addressing the audience confidently.';
  }
  const ratio = frameIndex / (frameTotal - 1);
  if (ratio <= 0.5) {
    return 'Shift the gesture toward an active pointing beat so the host is clearly engaging the screen while moving.';
  }
  return 'Use a transition gesture that continues the explanation while the host finishes the move across the stage.';
};

const buildBodyOrientationCue = (frameIndex: number, frameTotal: number) => {
  if (frameTotal <= 1 || frameIndex === 0) {
    return 'body orientation should be mostly toward the camera with a slight turn toward the screen.';
  }
  if (frameIndex === frameTotal - 1) {
    return 'body orientation should be settled at the far side with the torso opened back toward the camera.';
  }
  if (frameIndex < frameTotal / 2) {
    return 'body orientation should rotate more toward the weather screen than the opening frame.';
  }
  return 'body orientation should start turning back from the screen so the transition feels continuous and readable.';
};

const buildScreenFocusCue = (frameIndex: number, frameTotal: number) => {
  if (frameTotal <= 1 || frameIndex === 0) {
    return 'Direct attention to the left-side forecast area so the opening frame establishes the overall board.';
  }
  if (frameIndex === frameTotal - 1) {
    return 'Direct attention to the right-side forecast area so the closing frame lands on the final forecast detail.';
  }
  if (frameIndex < frameTotal / 2) {
    return 'Direct attention to the left-side forecast area while the host is still moving across the set.';
  }
  return 'Direct attention to the right-side forecast area as the host completes the move across the set.';
};

export const buildSeparateFrameSequencePlan = ({
  frameIndex,
  frameTotal
}: {
  frameIndex: number;
  frameTotal: number;
}): SeparateFrameSequencePlan => {
  const positionLabel = buildPositionLabel(frameIndex, frameTotal);
  const progressLabel = buildProgressLabel(frameIndex, frameTotal);
  const frameLabel = `Frame ${frameIndex + 1} of ${frameTotal}`;

  return {
    frameLabel,
    positionLabel,
    progressLabel,
    changeObjective: `In this frame, advance the host to the ${positionLabel} position while preserving a believable in-between movement for ${progressLabel}. ${buildGestureCue(frameIndex, frameTotal)} ${buildBodyOrientationCue(frameIndex, frameTotal)} ${buildScreenFocusCue(frameIndex, frameTotal)}`,
    stableConstraints: [
      'Keep the same host identity, outfit, hairstyle, and facial appearance as the reference image.',
      'Keep the same studio, broadcast screen style, and camera angle across the sequence.',
      'Keep this frame photorealistic and coherent with the surrounding frames.'
    ]
  };
};

export const buildSeparateFramePromptContract = ({
  prompt,
  frameIndex,
  frameTotal,
  sequencePlan
}: {
  prompt: string;
  frameIndex?: number;
  frameTotal?: number;
  sequencePlan?: SeparateFrameSequencePlan;
}) => {
  const resolvedPlan = sequencePlan
    ?? (typeof frameIndex === 'number' && typeof frameTotal === 'number'
      ? buildSeparateFrameSequencePlan({ frameIndex, frameTotal })
      : undefined);
  const frameLabel = resolvedPlan
    ? `${resolvedPlan.frameLabel}.`
    : typeof frameIndex === 'number' && typeof frameTotal === 'number'
      ? `Frame ${frameIndex + 1} of ${frameTotal}.`
      : 'This request is one frame in a multi-image sequence.';
  const sequenceDetails = resolvedPlan
    ? `Sequence trajectory: ${resolvedPlan.progressLabel}; target position: ${resolvedPlan.positionLabel}. ${resolvedPlan.changeObjective} Stable constraints: ${resolvedPlan.stableConstraints.join(' ')}`
    : '';

  return `${prompt}\n\n${frameLabel} ${sequenceDetails} Render exactly one standalone frame for this moment only. Depict a single camera view and a single moment in time. Do not create a collage, storyboard, contact sheet, split-screen, or multiple panels. Do not show multiple positions of the same subject in one image.`;
};

export const annotateSeparateFrameToolCalls = <T extends { toolName: string; args: any }>(toolCalls: T[]): T[] => {
  const generateImageIndices = toolCalls
    .map((toolCall, index) => toolCall.toolName === 'generate_image' ? index : -1)
    .filter(index => index >= 0);

  if (generateImageIndices.length <= 1) {
    return toolCalls;
  }

  return toolCalls.map((toolCall, index) => {
    const frameIndex = generateImageIndices.indexOf(index);
    if (frameIndex === -1) {
      return toolCall;
    }

    const rawArgs = toolCall.args && typeof toolCall.args === 'object'
      ? toolCall.args as Record<string, any>
      : {};
    const hasParametersWrapper = 'parameters' in rawArgs && typeof rawArgs.parameters === 'object';
    const targetArgs = hasParametersWrapper ? rawArgs.parameters : rawArgs;
    const annotatedArgs = {
      ...targetArgs,
      sequence_intent: SEPARATE_FRAME_SEQUENCE_INTENT,
      frame_index: frameIndex,
      frame_total: generateImageIndices.length,
      sequence_plan: buildSeparateFrameSequencePlan({
        frameIndex,
        frameTotal: generateImageIndices.length
      })
    };

    return {
      ...toolCall,
      args: hasParametersWrapper
        ? ({ ...rawArgs, parameters: annotatedArgs } as any)
        : annotatedArgs
    };
  });
};

export const shouldUseSeparateFrameContract = (rawArgs: unknown): rawArgs is {
  sequence_intent: SequenceIntent;
  frame_index?: number;
  frame_total?: number;
  sequence_plan?: SeparateFrameSequencePlan;
  prompt?: string;
} => {
  if (!rawArgs || typeof rawArgs !== 'object') return false;
  return (rawArgs as any).sequence_intent === SEPARATE_FRAME_SEQUENCE_INTENT;
};

export const normalizeSequenceAwarePrompt = ({
  prompt,
  rawArgs
}: {
  prompt: string;
  rawArgs: unknown;
}) => {
  if (!shouldUseSeparateFrameContract(rawArgs)) {
    return prompt;
  }

  return buildSeparateFramePromptContract({
    prompt,
    frameIndex: typeof rawArgs.frame_index === 'number' ? rawArgs.frame_index : undefined,
    frameTotal: typeof rawArgs.frame_total === 'number' ? rawArgs.frame_total : undefined,
    sequencePlan: rawArgs.sequence_plan
  });
};

export const isSeparateFrameAction = (action: AgentAction) =>
  shouldUseSeparateFrameContract(action.args && typeof action.args === 'object' && 'parameters' in action.args
    ? (action.args as any).parameters
    : action.args);

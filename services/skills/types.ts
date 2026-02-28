/**
 * Skill System Types
 *
 * Type definitions for the dynamic Skill injection architecture.
 * Based on Agent-Skills-for-Context-Engineering pattern.
 */

import { AppMode, GenerationParams } from '../../types';

/** Skill trigger types */
export type TriggerType = 'always' | 'mode' | 'keyword';

/** Skill definition */
export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Trigger type determines when this skill is activated */
  triggerType: TriggerType;
  /** Keywords for matching user message */
  keywords?: string[];
  /** App mode for matching (used when triggerType is 'mode') */
  mode?: AppMode;
  /** The actual prompt content */
  content: string;
  /** Priority for ordering (higher = more important) */
  priority?: number;
}

/** BuildSystemInstruction options */
export interface BuildInstructionOptions {
  mode: AppMode;
  userMessage?: string;
  params?: GenerationParams;
  contextSummary?: string;
  searchFacts?: string[];
  useSearch?: boolean;
  useGrounding?: boolean;
}

/** Active skill collection result */
export interface ActiveSkills {
  skills: Skill[];
  systemInstruction: string;
}

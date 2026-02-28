/**
 * Prompt Router
 *
 * Dynamic skill injection system based on context.
 * Phase 3: Dynamic routing - load only relevant skills per request.
 *
 * Architecture:
 * 1. Always load: CORE_IDENTITY, WORKFLOW, CRITICAL_RULES
 * 2. Mode-based loading: PROTOCOL_IMAGE_GEN for IMAGE mode
 * 3. Keyword-based loading: for ambiguous prompts
 */

import { SKILLS, getGenerationDefaultsContent, getSearchPolicyContent, getPromptOptimizerContent, getRoleInstruction } from './index';
import { BuildInstructionOptions, ActiveSkills } from './types';
import { AppMode } from '../../types';

// Re-export for convenience
export { getPromptOptimizerContent, getRoleInstruction };

/**
 * Find skills matching keywords in user message
 */
function findSkillsByKeywords(message?: string): typeof SKILLS[string][] {
  if (!message) return [];
  const lowerMessage = message.toLowerCase();

  return Object.values(SKILLS).filter(skill => {
    // Must have keywords to match
    if (!skill.keywords || skill.keywords.length === 0) return false;

    // Skip always-on skills (they're already loaded)
    if (skill.triggerType === 'always') return false;

    // Match keywords - case insensitive
    if (skill.triggerType === 'keyword') {
      return skill.keywords.some(k => lowerMessage.includes(k.toLowerCase()));
    }

    return false;
  });
}

/**
 * Build system instruction by selecting active skills (ON-DEMAND MODE)
 * Phase 3: True dynamic routing - only load relevant skills
 *
 * @param options - Build configuration
 * @returns ActiveSkills containing selected skills and assembled instruction
 */
export function buildSystemInstruction(options: BuildInstructionOptions): ActiveSkills {
  const { mode, userMessage, params, contextSummary, searchFacts, useSearch, useGrounding } = options;

  // Phase 3: TRUE on-demand loading - start with minimal set
  const activeSkills: typeof SKILLS[string][] = [];

  // 1. ALWAYS: Load all skills with triggerType 'always' (includes CORE_IDENTITY, WORKFLOW, CRITICAL_RULES)
  const alwaysOnSkills = Object.values(SKILLS).filter(s => s.triggerType === 'always');
  activeSkills.push(...alwaysOnSkills);

  // 2. MODE-SPECIFIC: Add protocol based on mode
  if (mode === AppMode.IMAGE) {
    activeSkills.push(SKILLS.PROTOCOL_IMAGE_GEN);
    activeSkills.push(SKILLS.REFERENCE_MODE);
  }

  // 3. KEYWORD TRIGGER: Add skills based on user message keywords
  const keywordSkills = findSkillsByKeywords(userMessage);
  // Limit to top 2 keyword skills to prevent overloading
  keywordSkills.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  activeSkills.push(...keywordSkills.slice(0, 2));

  // 4. SEARCH: Add search skill if user is asking factual questions
  if (useSearch && searchFacts && searchFacts.length > 0) {
    const searchSkill = SKILLS.SKILL_SEARCH;
    if (searchSkill) activeSkills.push(searchSkill);
  }

  // Sort by priority (highest first)
  activeSkills.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Build the system instruction string
  const parts: string[] = [];

  // 1. Add all active skills sorted by priority (skip duplicates via Set)
  const addedIds = new Set<string>();
  for (const skill of activeSkills) {
    if (!addedIds.has(skill.id)) {
      parts.push(skill.content);
      addedIds.add(skill.id);
    }
  }

  // 2. Context summary (if provided)
  if (contextSummary) {
    parts.push(`[PROJECT CONTEXT]\n${contextSummary}`);
  }

  // 3. Current date context (for search relevance)
  const now = new Date();
  const currentDateSection = `[CURRENT DATE]
Today is ${now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} (${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}).
When user asks about "recent", "latest", "this week" events, search for content from ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`;
  parts.push(currentDateSection);

  // 4. Retrieved context from search (if any)
  if (searchFacts && searchFacts.length > 0) {
    parts.push(`[RETRIEVED CONTEXT FROM SEARCH]\n${searchFacts.join('\n')}`);
  }

  // 5. Generation defaults (always needed)
  parts.push(getGenerationDefaultsContent(params));

  // 6. Search policy (for grounding)
  parts.push(getSearchPolicyContent(useSearch, useGrounding));

  return {
    skills: activeSkills,
    systemInstruction: parts.join('\n\n')
  };
}

/**
 * Build simple system instruction (for backward compatibility)
 * Uses Phase 1 approach - loads most skills for compatibility
 *
 * @deprecated Use buildSystemInstruction for dynamic routing
 */
export function buildSimpleSystemInstruction(
  mode: AppMode,
  params?: any,
  contextSummary?: string,
  searchFacts?: string[],
  useSearch?: boolean,
  useGrounding?: boolean
): string {
  return buildSystemInstruction({
    mode,
    params,
    contextSummary,
    searchFacts,
    useSearch,
    useGrounding
  }).systemInstruction;
}

/**
 * Get active skills for current context (for debugging/display)
 */
export function getActiveSkills(options: BuildInstructionOptions): string[] {
  // Return skill names used
  return buildSystemInstruction(options).skills.map(s => s.name);
}

/**
 * Validate skill configuration
 */
export function validateSkills(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check all always-on skills exist
  const alwaysOnSkills = Object.values(SKILLS).filter(s => s.triggerType === 'always');
  for (const skill of alwaysOnSkills) {
    if (!skill.content) {
      errors.push(`Skill ${skill.id} has empty content`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

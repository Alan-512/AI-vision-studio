/**
 * Memory Patch System
 * 
 * Handles structured patch operations for memory updates
 * Provides conflict resolution and deterministic merging
 */

export type PatchOp = 'upsert' | 'append' | 'delete';

// Maximum items per section for append operations (FIFO eviction)
const MAX_APPEND_ITEMS = 10;

export interface MemoryPatchOp {
  op: PatchOp;
  section: string;
  key?: string;
  value?: string;
  oldValue?: string;
}

export interface MemoryPatch {
  ops: MemoryPatchOp[];
  confidence: number;
  reason: string; // 'explicit_user_command' | 'implicit_fact' | 'ai_consolidation'
}

// Import the markdown utilities
import {
  parseMemoryMarkdown,
  formatMemoryToMarkdown,
  MemorySections,
  MemorySectionItem
} from './memoryMarkdown';

/**
 * Create a memory patch from AI output
 */
export const createMemoryPatch = (
  ops: MemoryPatchOp[],
  confidence: number = 0.9,
  reason: string = 'ai_consolidation'
): MemoryPatch => {
  return {
    ops,
    confidence,
    reason
  };
};

/**
 * Apply a patch to markdown content
 * Returns new markdown content
 */
export const applyMemoryPatch = (content: string, patch: MemoryPatch): string => {
  // Parse existing content into sections
  let sections = parseMemoryMarkdown(content);

  // If content was empty or invalid, initialize with basic structure
  if (Object.keys(sections).length === 0) {
    sections = {
      'User Profile': [],
      'Stable Preferences': [],
      'Project Decisions': [],
      'Guardrails': [],
      'Custom Notes': []
    };
  }

  // Apply each operation
  for (const op of patch.ops) {
    sections = applyPatchOp(sections, op);
  }

  // Format back to markdown
  return formatMemoryToMarkdown(sections);
};

/**
 * Apply a single patch operation to sections
 */
const applyPatchOp = (sections: MemorySections, op: MemoryPatchOp): MemorySections => {
  const { op: opType, section, key, value } = op;

  // Initialize section if doesn't exist
  if (!sections[section]) {
    sections[section] = [];
  }

  switch (opType) {
    case 'upsert':
      return applyUpsert(sections, section, key, value);

    case 'append':
      return applyAppend(sections, section, value);

    case 'delete':
      return applyDelete(sections, section, key);

    default:
      return sections;
  }
};

/**
 * Upsert (update or insert) a key-value pair in a section
 */
const applyUpsert = (
  sections: MemorySections,
  section: string,
  key: string | undefined,
  value: string | undefined
): MemorySections => {
  if (!key || value === undefined) {
    return sections;
  }

  const items = sections[section];
  const existingIndex = items.findIndex(item => item.key === key);

  if (existingIndex >= 0) {
    // Store old value for conflict tracking
    items[existingIndex].oldValue = items[existingIndex].value;
    items[existingIndex].value = value;
  } else {
    // Insert new key-value pair
    items.push({ key, value });
  }

  sections[section] = items;
  return sections;
};

/**
 * Append a value to a section (typically for decisions)
 */
const applyAppend = (
  sections: MemorySections,
  section: string,
  value: string | undefined
): MemorySections => {
  if (!value) {
    return sections;
  }

  const items = sections[section];

  // Dedup: skip if an item with the exact same value already exists
  const isDuplicate = items.some(item => item.value === value);
  if (isDuplicate) {
    return sections;
  }

  // Check for timestamp in value
  const timestampMatch = value.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)/);

  if (timestampMatch) {
    items.push({
      timestamp: timestampMatch[1],
      value: timestampMatch[2].trim()
    });
  } else {
    // Add current timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    items.push({
      timestamp,
      value
    });
  }

  sections[section] = items;

  // Capacity management: evict oldest items if over limit
  if (sections[section].length > MAX_APPEND_ITEMS) {
    sections[section] = sections[section].slice(-MAX_APPEND_ITEMS);
  }

  return sections;
};

/**
 * Delete a key from a section
 */
const applyDelete = (
  sections: MemorySections,
  section: string,
  key: string | undefined
): MemorySections => {
  if (!key) {
    return sections;
  }

  const items = sections[section];
  sections[section] = items.filter(item => item.key !== key);
  return sections;
};

/**
 * Detect conflicts between patches
 * Returns true if there's a conflict
 */
export const detectConflict = (
  _existingContent: string,
  _patch: MemoryPatch,
  _currentVersion: number
): boolean => {
  // Simple conflict detection: check if any key in patch was modified
  // after the given version (would require tracking version per key)
  // For now, we rely on the version check in storageService

  // This is a placeholder for more sophisticated conflict detection
  // In practice, the CAS (Compare-And-Swap) in storageService handles conflicts
  return false;
};

/**
 * Merge multiple patches into one
 * Useful when AI generates multiple memory updates
 */
export const mergePatches = (patches: MemoryPatch[]): MemoryPatch => {
  const mergedOps: MemoryPatchOp[] = [];
  let totalConfidence = 0;

  for (const patch of patches) {
    mergedOps.push(...patch.ops);
    totalConfidence += patch.confidence;
  }

  // Average confidence
  const avgConfidence = totalConfidence / patches.length;

  return {
    ops: mergedOps,
    confidence: avgConfidence,
    reason: 'merged_from_multiple_patches'
  };
};

/**
 * Validate patch structure
 */
export const validatePatch = (patch: unknown): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!patch || typeof patch !== 'object') {
    errors.push('Patch must be an object');
    return { valid: false, errors };
  }

  const p = patch as MemoryPatch;

  if (!Array.isArray(p.ops)) {
    errors.push('Patch must have ops array');
    return { valid: false, errors };
  }

  if (p.ops.length === 0) {
    errors.push('Patch must have at least one operation');
    return { valid: false, errors };
  }

  for (let i = 0; i < p.ops.length; i++) {
    const op = p.ops[i];

    if (!op.op || !['upsert', 'append', 'delete'].includes(op.op)) {
      errors.push(`Operation ${i}: invalid op type`);
    }

    if (!op.section) {
      errors.push(`Operation ${i}: missing section`);
    }

    if (op.op === 'upsert' && !op.key) {
      errors.push(`Operation ${i}: upsert requires key`);
    }
  }

  if (p.confidence === undefined || p.confidence < 0 || p.confidence > 1) {
    errors.push('Patch must have confidence between 0 and 1');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Create patch from natural language (for explicit commands)
 */
export const createPatchFromCommand = (
  command: string,
  confidence: number = 1.0
): MemoryPatch | null => {
  // Example: "记住我喜欢简洁代码风格"
  // Output: { op: 'upsert', section: 'Stable Preferences', key: 'code_style', value: '简洁' }

  const patterns = [
    // Pattern: "记住我喜欢 X" or "记住我偏好 X"
    { regex: /记住我(喜欢|偏好|想要|希望|使用)(.+)/i, section: 'Stable Preferences' },
    // Pattern: "记住 X 是 Y"
    { regex: /记住(.+)是(.+)/i, section: 'User Profile' },
    // Pattern: "以后都用 X" -> project decision
    { regex: /以后都用(.+)/i, section: 'Project Decisions' },
    // Pattern: "这个项目用 X"
    { regex: /这个项目用(.+)/i, section: 'Project Decisions' }
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern.regex);
    if (match) {
      // For patterns with 2 capture groups, use match[2]; for 1 group, use match[1]
      const value = match[2] ? match[2].trim() : match[1]?.trim();
      if (!value) continue;

      return {
        ops: [{
          op: 'upsert',
          section: pattern.section,
          key: extractKeyFromValue(value),
          value
        }],
        confidence,
        reason: 'explicit_user_command'
      };
    }
  }

  return null;
};

/**
 * Extract a key from a value (simple heuristic)
 */
const extractKeyFromValue = (value: string): string => {
  // Remove common prefixes
  let key = value
    .replace(/^(我|我的|喜欢|偏好|想要|希望|使用)/i, '')
    .trim();

  // Convert to snake_case
  key = key
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  // Limit length
  if (key.length > 30) {
    key = key.slice(0, 30);
  }

  return key || 'unnamed_preference';
};

/**
 * Generate diff between two memory contents
 */
export const generateMemoryDiff = (
  oldContent: string,
  newContent: string
): { added: string[]; removed: string[]; modified: string[] } => {
  const oldSections = parseMemoryMarkdown(oldContent);
  const newSections = parseMemoryMarkdown(newContent);

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // Find added and modified sections
  for (const [section, items] of Object.entries(newSections)) {
    const oldItems = oldSections[section] || [];

    for (const item of items) {
      const oldItem = oldItems.find(
        o => (item.key && o.key === item.key) || (item.value && o.value === item.value)
      );

      if (!oldItem) {
        if (item.key) {
          added.push(`${section}: ${item.key} = ${item.value}`);
        } else {
          added.push(`${section}: ${item.value}`);
        }
      } else if (oldItem.value !== item.value) {
        modified.push(`${section}: ${item.key || item.value}`);
      }
    }
  }

  // Find removed sections/keys
  for (const [section, items] of Object.entries(oldSections)) {
    const newItems = newSections[section] || [];

    for (const item of items) {
      const stillExists = newItems.some(
        n => (item.key && n.key === item.key) || (item.value && n.value === item.value)
      );

      if (!stillExists) {
        if (item.key) {
          removed.push(`${section}: ${item.key}`);
        } else {
          removed.push(`${section}: ${item.value}`);
        }
      }
    }
  }

  return { added, removed, modified };
};

// Re-export types for convenience
export type { MemorySections, MemorySectionItem };

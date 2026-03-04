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
  MemorySections
} from './memoryMarkdown';

/**

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

// Re-export types for convenience
// export type { MemorySections };

/**
 * Memory Markdown Parser & Formatter
 * 
 * Handles conversion between structured memory data and Markdown text
 * Provides parsing and formatting for memory sections
 */

export interface MemorySectionItem {
  key?: string;
  value: string;
  timestamp?: string;
  oldValue?: string;
}

export interface MemorySections {
  [sectionName: string]: MemorySectionItem[];
}

// Section headers we're looking for
const STANDARD_SECTIONS = [
  'Creative Profile',
  'Visual Preferences',
  'Generation Defaults',
  'Guardrails',
  // Legacy fallback sections (for backward compatibility with old memory docs)
  'User Profile',
  'Stable Preferences',
  // Project-specific sections
  'Style Card',
  'Prompt Patterns',
  'Project Decisions',
  'Custom Notes'
];

/**
 * Get default memory template for new documents
 */
export const getDefaultMemoryTemplate = (scope: 'global' | 'project'): string => {
  const timestamp = new Date().toISOString().split('T')[0];

  if (scope === 'global') {
    return `# AI-vision-studio Memory

## Creative Profile
- name: 
- role: 
- language: 
- skill_level: 

## Visual Preferences
- preferred_style: 
- color_palette: 
- lighting_preference: 
- composition_style: 
- negative_defaults: blurry, low quality, text, watermark

## Generation Defaults
- preferred_model: 
- default_aspect_ratio: 
- thinking_depth: 
- typical_count: 1

## Guardrails
- Never store API keys, passwords, private credentials
- Respect original artistic intent when editing images

`;
  } else {
    return `# AI-vision-studio Memory - Project

## Style Card
- primary_style: 
- mood: 
- color_scheme: 
- lighting: 
- camera_angle: 
- subject_type: 
- reference_keywords: 

## Prompt Patterns

## Project Decisions
- [${timestamp}] 

## Custom Notes

`;
  }
};

/**
 * Parse markdown content into structured sections
 */
export const parseMemoryMarkdown = (content: string): MemorySections => {
  const sections: MemorySections = {};

  if (!content || typeof content !== 'string') {
    return sections;
  }

  // Split by section headers
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentItems: MemorySectionItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this is a section header (##)
    if (line.startsWith('## ')) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = currentItems;
      }

      // Start new section
      currentSection = line.slice(3).trim();
      currentItems = [];
      continue;
    }

    // Check for subsection (###)
    if (line.startsWith('### ')) {
      if (currentSection) {
        // Save current items under main section
        if (!sections[currentSection]) {
          sections[currentSection] = [];
        }
        sections[currentSection].push(...currentItems);
      }

      currentSection = `${currentSection}:${line.slice(4).trim()}`;
      currentItems = [];
      continue;
    }

    // Parse list items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const itemText = line.slice(2).trim();

      // Check for timestamp format: - [2026-03-02] Some decision
      const timestampMatch = itemText.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)/);
      if (timestampMatch) {
        currentItems.push({
          timestamp: timestampMatch[1],
          value: timestampMatch[2].trim()
        });
        continue;
      }

      // Check for key-value format: - key: value
      const kvMatch = itemText.match(/^([^:]+):\s*(.*)/);
      if (kvMatch) {
        currentItems.push({
          key: kvMatch[1].trim(),
          value: kvMatch[2].trim()
        });
        continue;
      }

      // Plain value
      currentItems.push({
        value: itemText
      });
    }
  }

  // Save last section
  if (currentSection) {
    sections[currentSection] = currentItems;
  }

  return sections;
};

/**
 * Format structured sections back to markdown
 */
export const formatMemoryToMarkdown = (sections: MemorySections): string => {
  const lines: string[] = ['# AI-vision-studio Memory', ''];

  for (const sectionName of STANDARD_SECTIONS) {
    const items = sections[sectionName];
    if (!items || items.length === 0) {
      continue;
    }

    lines.push(`## ${sectionName}`);

    for (const item of items) {
      if (item.timestamp) {
        // Project decision with timestamp
        lines.push(`- [${item.timestamp}] ${item.value}`);
      } else if (item.key) {
        // Key-value pair
        lines.push(`- ${item.key}: ${item.value}`);
      } else {
        // Plain value
        lines.push(`- ${item.value}`);
      }
    }

    lines.push(''); // Empty line between sections
  }

  // Handle custom sections
  for (const sectionName of Object.keys(sections)) {
    if (!STANDARD_SECTIONS.includes(sectionName)) {
      const items = sections[sectionName];
      if (items && items.length > 0) {
        // Check if it's a subsection
        if (sectionName.includes(':')) {
          const [_main, sub] = sectionName.split(':');
          lines.push(`### ${sub.trim()}`);
        } else {
          lines.push(`## ${sectionName}`);
        }

        for (const item of items) {
          if (item.key) {
            lines.push(`- ${item.key}: ${item.value}`);
          } else {
            lines.push(`- ${item.value}`);
          }
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n').trim();
};

/**
 * Get a specific section from markdown content
 */
export const getSectionFromMarkdown = (content: string, sectionName: string): MemorySectionItem[] => {
  const sections = parseMemoryMarkdown(content);
  return sections[sectionName] || [];
};

/**
 * Update a specific key in a section
 */
export const updateKeyInMarkdown = (
  content: string,
  sectionName: string,
  key: string,
  value: string
): string => {
  const sections = parseMemoryMarkdown(content);

  // Initialize section if doesn't exist
  if (!sections[sectionName]) {
    sections[sectionName] = [];
  }

  // Find and update existing key
  const existingIndex = sections[sectionName].findIndex(item => item.key === key);
  if (existingIndex >= 0) {
    sections[sectionName][existingIndex].value = value;
  } else {
    sections[sectionName].push({ key, value });
  }

  return formatMemoryToMarkdown(sections);
};

/**
 * Append a decision to Project Decisions section
 */
export const appendDecisionToMarkdown = (
  content: string,
  decision: string,
  timestamp?: string
): string => {
  const sections = parseMemoryMarkdown(content);
  const ts = timestamp || new Date().toISOString().split('T')[0];

  // Initialize Project Decisions if doesn't exist
  if (!sections['Project Decisions']) {
    sections['Project Decisions'] = [];
  }

  sections['Project Decisions'].push({
    timestamp: ts,
    value: decision
  });

  return formatMemoryToMarkdown(sections);
};

/**
 * Validate markdown content structure
 */
export const validateMemoryMarkdown = (content: string): { valid: boolean; warnings: string[] } => {
  const warnings: string[] = [];

  if (!content || content.trim().length === 0) {
    warnings.push('Content is empty');
    return { valid: false, warnings };
  }

  if (!content.includes('#')) {
    warnings.push('Missing header markers');
  }

  // Check for required sections (accept both new and legacy names)
  const hasProfile = content.includes('Creative Profile') || content.includes('User Profile');
  const hasPreferences = content.includes('Visual Preferences') || content.includes('Stable Preferences');
  const hasGuardrails = content.includes('Guardrails');

  if (!hasProfile) warnings.push('Missing Creative Profile section');
  if (!hasPreferences) warnings.push('Missing Visual Preferences section');
  if (!hasGuardrails) warnings.push('Missing Guardrails section');

  return {
    valid: warnings.length === 0,
    warnings
  };
};

/**
 * Extract just the values for injection (flat format)
 */
export const extractFlatMemory = (content: string): Record<string, string> => {
  const sections = parseMemoryMarkdown(content);
  const flat: Record<string, string> = {};

  for (const [sectionName, items] of Object.entries(sections)) {
    for (const item of items) {
      if (item.key) {
        const key = `${sectionName.toLowerCase().replace(/\s+/g, '_')}.${item.key.toLowerCase()}`;
        flat[key] = item.value;
      } else if (item.value) {
        const key = sectionName.toLowerCase().replace(/\s+/g, '_');
        flat[key] = (flat[key] ? flat[key] + '; ' : '') + item.value;
      }
    }
  }

  return flat;
};

/**
 * Memory Service - Core API for Long-term Memory System
 * 
 * Provides:
 * - Memory CRUD operations
 * - Patch application with conflict resolution
 * - Memory snippet extraction for injection
 * - Export/Import functionality
 * - Sensitive data filtering
 */

import {
  getMemoryDoc,
  saveMemoryDoc,
  deleteMemoryDoc,
  getAllMemoryDocs,
  getMemoryOps,
  recordMemoryOp,
  saveMemoryLog,
  getMemoryLogs,
  MemoryDoc,
  MemoryOp
} from './storageService';
import { generateText } from './geminiService';
import { TextModel } from '../types';
import { parseMemoryMarkdown, getDefaultMemoryTemplate } from '../utils/memoryMarkdown';
import { applyMemoryPatch, MemoryPatch } from '../utils/memoryPatch';
import { GenerationParams, ImageStyle } from '../types';

// Constants
const INJECTION_MAX_CHARS = 1600;
const GLOBAL_DEFAULT_TARGET = 'default';

// Sensitive patterns that should never be stored - optimized to avoid false positives on instructions
const SENSITIVE_PATTERNS = [
  // Patterns like 'key: AIza...' or 'password = 123456'
  /(api[_-]?key|password|secret|token|credential|auth|private[_-]?key)\s*[:=]\s*\S+/i,
  // High-entropy strings or obvious secrets
  /\bAIza[0-9A-Za-z-_]{35}\b/, // Google API Keys
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{16}\b/, // Credit card
  /-----begin\s+(rsa\s+)?private\s+key-----/i, // SSH Private Keys
];

// Whitelist for allowed profile fields
// const ALLOWED_PROFILE_FIELDS = ['name', 'role', 'language', 'avatar', 'bio'];


/**
 * Check if content contains sensitive information
 */
const containsSensitiveData = (content: string): boolean => {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(content));
};

/**
 * Filter sensitive data from content
 */
const filterSensitiveData = (content: string): string => {
  let filtered = content;
  SENSITIVE_PATTERNS.forEach(pattern => {
    filtered = filtered.replace(pattern, '[REDACTED]');
  });
  return filtered;
};

/**
 * Get or create global memory document
 */
export const getGlobalMemory = async (): Promise<MemoryDoc> => {
  let doc = await getMemoryDoc('global', GLOBAL_DEFAULT_TARGET);
  if (!doc) {
    doc = {
      id: 'global:default',
      scope: 'global',
      targetId: GLOBAL_DEFAULT_TARGET,
      path: '.ai-vision-studio/profiles/default.md',
      content: getDefaultMemoryTemplate('global'),
      version: 0,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
    await saveMemoryDoc(doc);
  }
  return doc;
};

/**
 * Get or create project memory document
 */
export const getProjectMemory = async (projectId: string): Promise<MemoryDoc> => {
  let doc = await getMemoryDoc('project', projectId);
  if (!doc) {
    doc = {
      id: `project:${projectId}`,
      scope: 'project',
      targetId: projectId,
      path: `.ai-vision-studio/memory/${projectId}.md`,
      content: getDefaultMemoryTemplate('project'),
      version: 0,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
    await saveMemoryDoc(doc);
  }
  return doc;
};

/**
 * Get memory document (auto-detect scope)
 */
export const getMemory = async (scope: 'global' | 'project', targetId: string): Promise<MemoryDoc | null> => {
  return getMemoryDoc(scope, targetId);
};

/**
 * Update memory content directly (for manual edits)
 */
export const updateMemoryContent = async (
  scope: 'global' | 'project',
  targetId: string,
  content: string,
  reason = 'manual_edit'
): Promise<MemoryDoc> => {
  // Filter sensitive data
  const filteredContent = filterSensitiveData(content);

  // Get existing doc
  let doc = await getMemoryDoc(scope, targetId);
  const oldContent = doc?.content || '';
  const oldVersion = doc?.version || 0;

  if (!doc) {
    // Create new doc
    doc = {
      id: `${scope}:${targetId}`,
      scope,
      targetId,
      path: scope === 'global' ? '.ai-vision-studio/profiles/default.md' : `.ai-vision-studio/memory/${targetId}.md`,
      content: filteredContent,
      version: 1,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
    await saveMemoryDoc(doc);
  } else {
    // Update existing
    doc.content = filteredContent;
    doc.updatedAt = Date.now();
    await saveMemoryDoc(doc, oldVersion);
  }

  // Record operation
  await recordMemoryOp({
    docId: doc.id,
    operation: 'upsert',
    patch: JSON.stringify({ before: oldContent, after: filteredContent }),
    confidence: 1.0,
    reason
  });

  return doc;
};

/**
 * Append an entry to the daily memory log stream (V2.1 OpenClaw-style)
 */
export const appendDailyLog = async (params: {
  content: string;
  confidence: number;
  projectId?: string;
  scopeHint?: 'global' | 'project';
  metadata?: any;
}): Promise<string> => {
  // Filter sensitive data
  const filteredContent = filterSensitiveData(params.content);

  const dateStr = new Date().toISOString().split('T')[0];

  const logId = await saveMemoryLog({
    date: dateStr,
    projectId: params.projectId,
    content: filteredContent,
    confidence: params.confidence,
    scopeHint: params.scopeHint,
    metadata: params.metadata
  });

  console.log(`[Memory] Appended to Daily Log (${dateStr}):`, filteredContent.slice(0, 50) + '...');
  return logId;
};

/**
 * Apply a structured patch to memory
 */
export const applyPatchToMemory = async (
  scope: 'global' | 'project',
  targetId: string,
  patch: MemoryPatch,
  reason = 'ai_consolidation'
): Promise<MemoryDoc> => {
  // Get existing doc
  let doc = await getMemoryDoc(scope, targetId);
  const oldVersion = doc?.version || 0;
  const oldContent = doc?.content || getDefaultMemoryTemplate(scope);

  if (!doc) {
    // Create new with default template
    doc = {
      id: `${scope}:${targetId}`,
      scope,
      targetId,
      path: scope === 'global' ? '.ai-vision-studio/profiles/default.md' : `.ai-vision-studio/memory/${targetId}.md`,
      content: getDefaultMemoryTemplate(scope),
      version: 0,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
  }

  // Apply patch to content
  const newContent = applyMemoryPatch(oldContent, patch);

  // Filter sensitive data
  const filteredContent = filterSensitiveData(newContent);

  // Save with version check
  doc.content = filteredContent;
  doc.updatedAt = Date.now();
  await saveMemoryDoc(doc, oldVersion);

  // Record each operation
  for (const op of patch.ops) {
    await recordMemoryOp({
      docId: doc.id,
      operation: op.op,
      section: op.section,
      key: op.key,
      value: op.value,
      oldValue: op.oldValue,
      patch: JSON.stringify(op),
      confidence: patch.confidence,
      reason: patch.reason || reason
    });
  }

  return doc;
};

/**
 * Extract memory snippet for injection into AI requests
 * Returns formatted text within character limit
 */
const getMemorySnippet = async (
  scope: 'global' | 'project',
  targetId: string,
  maxChars = INJECTION_MAX_CHARS
): Promise<string> => {
  const doc = await getMemoryDoc(scope, targetId);
  if (!doc || !doc.content) {
    return '';
  }

  // Parse markdown to structured data
  const sections = parseMemoryMarkdown(doc.content);

  if (scope === 'global') {
    return formatGlobalSnippet(sections, maxChars);
  } else {
    return formatProjectSnippet(sections, maxChars);
  }
};

// --- Creative Injection Helpers ---

/** Maps preference keys to natural-language sentences for AI consumption */
const PREF_SENTENCE_MAP: Record<string, (v: string) => string> = {
  preferred_style: (v) => `The user prefers ${v} visual style.`,
  color_palette: (v) => `Preferred color palette: ${v}.`,
  lighting_preference: (v) => `Default lighting: ${v}.`,
  composition_style: (v) => `Typical composition: ${v}.`,
  negative_defaults: (v) => `Avoid in generations: ${v}.`,
  preferred_model: (v) => `Preferred model: ${v}.`,
  default_aspect_ratio: (v) => `Default aspect ratio: ${v}.`,
  thinking_depth: (v) => `Thinking depth: ${v}.`,
  typical_count: (v) => `Typical generation count: ${v}.`,
  lighting: (v) => `Preferred lighting: ${v}.`,
  camera_angle: (v) => `Common camera angle: ${v}.`,
  subject_type: (v) => `Primary subject type: ${v}.`,
};

/** Format global memory into creative guidance with MUST/PREFER priority layers */
function formatGlobalSnippet(sections: ReturnType<typeof parseMemoryMarkdown>, maxChars: number): string {
  const lines: string[] = ['[CREATIVE MEMORY]'];

  // Priority 1: MUST (Guardrails - enforceable rules, cannot be overridden by user prompt)
  const guardrails = sections['Guardrails'] || [];
  if (guardrails.length > 0) {
    lines.push('MUST (enforceable rules):');
    for (const item of guardrails) {
      if (item.value) lines.push(`- ${item.value}`);
    }
  }

  // Priority 2: Creative Profile
  const profile = sections['Creative Profile'] || sections['User Profile'] || [];
  const profileEntries = profile.filter(item => item.key && item.value);
  if (profileEntries.length > 0) {
    lines.push('User profile:');
    for (const item of profileEntries) {
      lines.push(`- ${item.key}: ${item.value}`);
    }
  }

  // Priority 3: PREFER (Visual Preferences + Generation Defaults - soft suggestions, user's current request overrides)
  const visualPrefs = sections['Visual Preferences'] || sections['Stable Preferences'] || [];
  const genDefaults = sections['Generation Defaults'] || [];
  const allPrefs = [...visualPrefs, ...genDefaults].filter(item => item.key && item.value);
  if (allPrefs.length > 0) {
    lines.push('PREFER (soft defaults, override if user specifies otherwise):');
    for (const item of allPrefs) {
      const sentence = PREF_SENTENCE_MAP[item.key!];
      lines.push(sentence ? `- ${sentence(item.value)}` : `- ${item.key}: ${item.value}`);
    }
  }

  // Topics index: tell AI what's available for on-demand loading
  lines.push('(Use read_memory tool to load full details for visual_prefs, gen_defaults, or guardrails.)');

  return truncateSnippet(lines, maxChars);
}

/** Format project memory into project-specific creative context */
function formatProjectSnippet(sections: ReturnType<typeof parseMemoryMarkdown>, maxChars: number): string {
  const lines: string[] = ['[PROJECT STYLE]'];

  // Priority 1: Style Card
  const styleCard = sections['Style Card'] || [];
  for (const item of styleCard) {
    if (item.key && item.value) {
      lines.push(`- project.${item.key}: ${item.value}`);
    }
  }

  // Priority 2: Prompt Patterns (reusable prompt fragments)
  const patterns = sections['Prompt Patterns'] || [];
  if (patterns.length > 0) {
    lines.push('Recurring prompt patterns:');
    for (const item of patterns.slice(-5)) {
      if (item.value) {
        const text = item.value.length > 80 ? item.value.slice(0, 80) + '...' : item.value;
        lines.push(`- "${text}"`);
      }
    }
  }

  // Priority 3: Latest Project Decisions
  const decisions = sections['Project Decisions'] || [];
  if (decisions.length > 0) {
    const recent = decisions.slice(-3);
    for (const item of recent) {
      if (item.value) {
        const text = item.value.length > 80 ? item.value.slice(0, 80) + '...' : item.value;
        lines.push(`- project.decision: ${text}`);
      }
    }
  }

  return truncateSnippet(lines, maxChars);
}

/** Shared truncation logic */
function truncateSnippet(lines: string[], maxChars: number): string {
  let result = lines.join('\n');
  if (result.length > maxChars) {
    // Progressive truncation — keep highest priority lines
    const priorityLines = lines.slice(0, 10);
    result = priorityLines.join('\n');
    if (result.length > maxChars) {
      result = result.slice(0, maxChars - 20) + '...(truncated)';
    }
  }
  return result;
}

/**
 * Get both global and project memory snippets combined
 */
export const getCombinedMemorySnippet = async (
  projectId: string | null,
  maxChars = INJECTION_MAX_CHARS
): Promise<string> => {
  const snippets: string[] = [];

  // Always include global memory
  const globalSnippet = await getMemorySnippet('global', GLOBAL_DEFAULT_TARGET, Math.floor(maxChars / 2));
  if (globalSnippet) {
    snippets.push(globalSnippet);
  }

  // Include project memory if available
  if (projectId) {
    const projectSnippet = await getMemorySnippet('project', projectId, Math.floor(maxChars / 2));
    if (projectSnippet) {
      snippets.push(projectSnippet);
    }
  }

  return snippets.join('\n\n');
};

/**
 * Get memory operation history
 */
export const getMemoryHistory = async (
  scope: 'global' | 'project',
  targetId: string,
  limit = 50
): Promise<MemoryOp[]> => {
  const docId = `${scope}:${targetId}`;
  return getMemoryOps(docId, limit);
};

/**
/**
 * Export all memory as a bundle
 */
export const exportMemoryBundle = async (): Promise<string> => {
  const docs = await getAllMemoryDocs(true); // Include soft-deleted
  const bundle = {
    version: '1.0',
    exportedAt: Date.now(),
    docs: docs.map(doc => ({
      id: doc.id,
      scope: doc.scope,
      targetId: doc.targetId,
      path: doc.path,
      content: doc.content,
      isDeleted: doc.isDeleted,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    }))
  };

  return JSON.stringify(bundle, null, 2);
};

/**
 * Import memory from a bundle
 */
export const importMemoryBundle = async (bundleJson: string): Promise<{ imported: number; errors: string[] }> => {
  const errors: string[] = [];
  let imported = 0;

  try {
    const bundle = JSON.parse(bundleJson);

    if (!bundle.docs || !Array.isArray(bundle.docs)) {
      throw new Error('Invalid bundle format: missing docs array');
    }

    for (const docData of bundle.docs) {
      try {
        // Validate required fields
        if (!docData.scope || !docData.targetId || !docData.content) {
          errors.push(`Skipped invalid doc: missing required fields`);
          continue;
        }

        // Filter sensitive data
        const filteredContent = filterSensitiveData(docData.content);

        // Check if doc already exists
        const existing = await getMemoryDoc(docData.scope, docData.targetId);

        if (existing) {
          // Update if import is newer
          if (docData.updatedAt > existing.updatedAt) {
            existing.content = filteredContent;
            existing.isDeleted = docData.isDeleted || false;
            existing.updatedAt = Date.now();
            await saveMemoryDoc(existing, existing.version);
            imported++;
          }
        } else {
          // Create new
          const newDoc: MemoryDoc = {
            id: `${docData.scope}:${docData.targetId}`,
            scope: docData.scope,
            targetId: docData.targetId,
            path: docData.path || (docData.scope === 'global' ? '.lumina/profiles/default.md' : `.lumina/memory/${docData.targetId}.md`),
            content: filteredContent,
            version: 1,
            isDeleted: docData.isDeleted || false,
            updatedAt: Date.now(),
            createdAt: docData.createdAt || Date.now()
          };
          await saveMemoryDoc(newDoc);
          imported++;
        }
      } catch (e: any) {
        errors.push(`Error importing ${docData.id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`Bundle parse error: ${e.message}`);
  }

  return { imported, errors };
};

/**
 * Delete memory (soft delete)
 */
export const softDeleteMemory = async (scope: 'global' | 'project', targetId: string): Promise<void> => {
  return deleteMemoryDoc(scope, targetId);
};

/**

/**
 * Validate memory content before save
 */
export const validateMemoryContent = (content: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check for sensitive data
  if (containsSensitiveData(content)) {
    errors.push('Content contains sensitive data (API keys, passwords, etc.)');
  }

  // Basic markdown structure check
  if (!content.includes('# Lumina Memory') && !content.includes('# Memory')) {
    // Warn but don't error - template will be applied
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
};

// Re-export types for convenience
export type { MemoryDoc, MemoryOp };

// --- Memory Write-Back (Passive Extraction) ---

/**
 * Record user preference from implicit positive signals (e.g., download, favorite)
 * In V2.1, this appends to the Daily Log instead of directly patching memory.
 */
export const recordUserPreference = async (
  params: Partial<GenerationParams>,
  action: 'download' | 'favorite' | 'use_as_reference' | 'silent_approval'
): Promise<void> => {
  try {
    const findings: string[] = [];

    if (params.aspectRatio) findings.push(`Prefers aspect ratio: ${params.aspectRatio}`);
    if (params.imageModel) findings.push(`Prefers image model: ${params.imageModel}`);
    if (params.thinkingLevel) findings.push(`Prefers thinking depth: ${params.thinkingLevel}`);

    if (params.imageStyle && params.imageStyle !== Object.values(ImageStyle)[0]) {
      findings.push(`Prefers visual style: ${params.imageStyle}`);
    } else if (params.selectedImageTags && params.selectedImageTags.length > 0) {
      findings.push(`Prefers style elements: ${params.selectedImageTags.join(', ')}`);
    }

    if (findings.length > 0) {
      const confidence = action === 'favorite' || action === 'use_as_reference' ? 1.0
        : action === 'silent_approval' ? 0.6
          : 0.8;

      // Log to daily stream (V2.1 logic)
      await appendDailyLog({
        content: findings.join('; '),
        confidence,
        metadata: { action, source: 'implicit_signal' }
      });

      console.log('[Memory] Logged implicit preferences to Daily Log:', findings.length);
    }
  } catch (error) {
    console.warn('[Memory] Failed to record user preference implicitly:', error);
  }
};


/**
 * Search user memory for relevant preferences and decisions (V2.2 LLM Re-ranking)
 * 1. Coarse filter: Gather top 20 candidates based on term matching or recency.
 * 2. Fine re-ranking: Ask Gemini Flash to summarize the relevant parts for the specific query.
 */
export const memorySearch = async (
  query: string,
  projectId?: string | null,
  limit = 5
): Promise<string> => {
  const allResults: { score: number; text: string; source: string; timestamp?: number }[] = [];
  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1); // V2.2: more lenient term matching

  // 1. PHASE 1: Coarse Filtering (Candidate Generation)

  // Search Memory Docs (Global & Project)
  const docs = await getAllMemoryDocs();
  for (const doc of docs) {
    if (doc.scope === 'project' && doc.targetId !== projectId) continue;

    const sections = parseMemoryMarkdown(doc.content);
    for (const [sectionName, items] of Object.entries(sections)) {
      for (const item of items) {
        const textToSearch = `${sectionName} ${item.key || ''} ${item.value}`.toLowerCase();
        let score = 0;
        for (const term of searchTerms) {
          if (textToSearch.includes(term)) score += 2; // Exact term match gets higher score
        }

        // V2.2: Include all items with slight base score to allow LLM to judge semantic relevance
        // if no search terms are strictly matched, but give matched items a big boost.
        if (searchTerms.length === 0) score = 1;

        if (score >= 0) {
          allResults.push({
            score,
            text: `[${doc.scope === 'global' ? 'Global' : 'Project'}] ${sectionName} > ${item.key ? item.key + ':' : ''} ${item.value}`,
            source: `${doc.scope}:${doc.targetId}#${sectionName}`,
            timestamp: item.timestamp ? parseInt(item.timestamp) : undefined
          });
        }
      }
    }
  }

  // Search Daily Logs
  const logs = await getMemoryLogs({ projectId: projectId || undefined, limit: 30 });
  for (const log of logs) {
    const textToSearch = log.content.toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
      if (textToSearch.includes(term)) score += 2;
    }

    if (searchTerms.length === 0) score = 1;

    if (score >= 0) {
      allResults.push({
        score: score * 1.5, // Stronger boost for recent logs in V2.2
        text: `[Recent Log] ${log.content}`,
        source: `dailyLog:${log.date}`,
        timestamp: log.timestamp
      });
    }
  }

  // Sort candidates and take top 20
  allResults.sort((a, b) => b.score - a.score || (b.timestamp || 0) - (a.timestamp || 0));
  const candidates = allResults.slice(0, 20);

  if (candidates.length === 0) {
    return `No memory candidates found for: "${query}"`;
  }

  // 2. PHASE 2: LLM Semantic Re-ranking & Summarization
  const contextBlock = candidates.map((c, i) => `[${i + 1}] ${c.text}`).join('\n');

  const systemInstruction = `You are a Memory Retrieval Engine.
Your task is to analyze a raw dump of memory candidates and answer the user's query about their preferences or past context.
Be concise, direct, and factual based ONLY on the provided memory candidates.
If the candidates do not contain the answer or are completely irrelevant, state "No relevant information found in memory."
Ignore candidates that are contradictory if a more recent/global candidate exists.`;

  const prompt = `User's Query: "${query}"\n\nMemory Candidates (Raw Dump):\n${contextBlock}\n\nBased on these candidates, extract and synthesize the relevant memory points that answer the user's query:`;

  try {
    console.log(`[MemorySearch] Sending ${candidates.length} candidates to LLM for re-ranking...`);
    const llmSummary = await generateText(systemInstruction, prompt, false, TextModel.FLASH);
    return `Memory Search Results for "${query}":\n\n${llmSummary}`;
  } catch (err) {
    console.error('[MemorySearch] LLM re-ranking failed, falling back to raw candidates:', err);
    // Fallback to V2.1 output if LLM fails
    const output = [
      `Search results for "${query}" (Fallback):`,
      ...candidates.slice(0, limit).map(r => `- [${r.source}] ${r.text}`)
    ];
    return output.join('\n');
  }
};


/**
 * Memory Consolidator V2.2 - Low-frequency background process
 * 
 * Key Change: Consolidation now runs AT MOST once per day (not after every image generation).
 * The primary memory channel is `update_memory` tool calls during live chat.
 * This consolidator is a safety net for implicit/behavioral preferences only.
 * 
 * Functions:
 * - Review ONLY unconsolidated Daily Logs (incremental processing)
 * - Resolve conflicts and deduplicate findings via LLM
 * - Promote recurring project patterns to Global memory
 * - Mark processed logs as consolidated to prevent re-processing
 */

import { getMemoryLogs, MemoryLog, markLogsConsolidated } from './storageService';
import { applyPatchToMemory } from './memoryService';
import { MemoryPatch, MemoryPatchOp } from '../utils/memoryPatch';
import { generateText } from './geminiService';
import { TextModel } from '../types';

const CONSOLIDATION_KEY = 'memory_last_consolidation_date';

/**
 * Check if consolidation has already run today.
 * Returns true if we should skip (already ran today).
 */
function shouldSkipConsolidation(): boolean {
    const lastDate = localStorage.getItem(CONSOLIDATION_KEY);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return lastDate === today;
}

/**
 * Mark today as consolidated so subsequent calls are no-ops.
 */
function markConsolidationDone(): void {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(CONSOLIDATION_KEY, today);
}

/**
 * Run consolidation for a specific project or global scope.
 * Guarded to run at most once per calendar day.
 * Only processes logs that haven't been consolidated yet.
 * 
 * @param projectId - The project to consolidate. If omitted, consolidates global scope.
 * @param force - If true, bypass the daily guard (e.g., user manually triggered).
 */
export const runConsolidation = async (projectId?: string, force?: boolean): Promise<void> => {
    // Daily frequency guard
    if (!force && shouldSkipConsolidation()) {
        console.log('[Consolidator] Already consolidated today. Skipping.');
        return;
    }

    console.log(`[Consolidator] Starting daily consolidation for ${projectId || 'Global'}...`);

    // 1. Fetch ONLY unconsolidated logs (incremental - no redundant LLM calls)
    const logs = await getMemoryLogs({ projectId, limit: 50, onlyUnconsolidated: true });
    if (logs.length === 0) {
        console.log('[Consolidator] No new unconsolidated logs found. Done.');
        markConsolidationDone();
        return;
    }

    console.log(`[Consolidator] Found ${logs.length} new logs to process.`);

    // 2. Use LLM to intelligently cluster and extract structured patches from raw logs
    const findings = await clusterLogsWithLLM(logs);

    // 3. Apply to Project Memory
    if (projectId && findings.length > 0) {
        const patch: MemoryPatch = {
            ops: findings,
            confidence: 0.9,
            reason: 'Consolidated from daily log stream'
        };
        await applyPatchToMemory('project', projectId, patch);
    }

    // 4. Global Promotion Check
    if (projectId) {
        await checkGlobalPromotion(logs);
    }

    // 5. Mark all processed logs as consolidated (prevents re-processing)
    const logIds = logs.map(l => l.id);
    await markLogsConsolidated(logIds);

    // 6. Mark today as done
    markConsolidationDone();

    console.log(`[Consolidator] Finished. Processed ${logs.length} logs, extracted ${findings.length} ops.`);
};

/**
 * Cluster raw log strings into structured patch operations using Gemini Flash
 */
async function clusterLogsWithLLM(logs: MemoryLog[]): Promise<MemoryPatchOp[]> {
    if (logs.length === 0) return [];

    // Sort by recency to give LLM temporal context
    logs.sort((a, b) => b.timestamp - a.timestamp);

    const logsText = logs.map((l, i) => `[Log ${i + 1}] Date: ${l.date}, Content: ${l.content}, Hint: ${l.scopeHint || 'none'}`).join('\n');

    const systemInstruction = `You are an expert Memory Storage Administrator for an AI image generation tool.
Your task is to review a series of daily interaction logs and extract the true, underlying user preferences.

RULES:
1. Filter out noise, contradictory fleeting thoughts, or low-confidence guesses.
2. Identify core recurring patterns, stylistic preferences, and generation defaults.
3. Consolidate duplicates. If multiple logs mention "likes dark mode", only output it once.
4. Output EXACTLY a JSON array of MemoryPatchOp objects. No markdown formatting, no explanations.

A MemoryPatchOp has this structure:
{
  "op": "upsert" | "delete",
  "section": "Visual Preferences" | "Generation Defaults" | "Prompt Patterns" | "Guardrails" | string,
  "key": string (a short unique snake_case identifier, e.g. "preferred_style"),
  "value": string (the detailed preference)
}`;

    const prompt = `Here are the recent daily logs:\n\n${logsText}\n\nAnalyze these and output the consolidated JSON array:`;

    try {
        const jsonResponse = await generateText(systemInstruction, prompt, true, TextModel.FLASH);
        console.log('[Consolidator] Raw LLM output received (length):', jsonResponse.length);

        let parsed: any;
        try {
            // Handle potential markdown block wrapper from LLM
            const cleanJson = jsonResponse.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
            parsed = JSON.parse(cleanJson);
        } catch (e) {
            console.error('[Consolidator] Failed to parse LLM JSON:', jsonResponse);
            return [];
        }

        if (Array.isArray(parsed)) {
            // Validate basic structure
            const validOps = parsed.filter(op => op.op === 'upsert' || op.op === 'delete');
            console.log(`[Consolidator] Extracted ${validOps.length} valid memory operations.`);
            return validOps as MemoryPatchOp[];
        }
        return [];
    } catch (err) {
        console.error('[Consolidator] LLM clustering failed:', err);
        return [];
    }
}


/**
 * Check if any project findings should be promoted to Global
 */
async function checkGlobalPromotion(projectLogs: MemoryLog[]): Promise<void> {
    // Simple heuristic: if a pattern appears in multiple project logs with high confidence
    // Or if the log explicitly has scopeHint: 'global'
    const globalLogs = projectLogs.filter(l => l.scopeHint === 'global');
    if (globalLogs.length > 0) {
        const globalOps = await clusterLogsWithLLM(globalLogs);
        if (globalOps.length > 0) {
            await applyPatchToMemory('global', 'default', {
                ops: globalOps,
                confidence: 1.0,
                reason: 'Promoted to global from project log hint'
            });
            console.log(`[Consolidator] Promoted ${globalOps.length} patterns to Global.`);
        }
    }
}

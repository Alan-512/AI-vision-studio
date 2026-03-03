/**
 * Memory Consolidator - Background process for Memory V2.1 (OpenClaw style)
 * 
 * Functions:
 * - Review Daily Logs for the current/previous day
 * - Resolve conflicts and deduplicate findings
 * - Promote recurring project patterns to Global memory
 * - Update structured MEMORY.md files via applyPatchToMemory
 */

import { getMemoryLogs, MemoryLog } from './storageService';
import { applyPatchToMemory } from './memoryService';
import { MemoryPatch, MemoryPatchOp } from '../utils/memoryPatch';
import { generateText } from './geminiService';
import { TextModel } from '../types';


/**
 * Run consolidation for a specific project or global scope
 */
export const runConsolidation = async (projectId?: string): Promise<void> => {
    console.log(`[Consolidator] Starting consolidation for ${projectId || 'Global'}...`);

    // 1. Fetch recent logs (last 50 for now)
    const logs = await getMemoryLogs({ projectId, limit: 50 });
    if (logs.length === 0) return;

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

    console.log(`[Consolidator] Finished consolidation.`);
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

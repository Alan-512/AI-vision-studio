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


/**
 * Run consolidation for a specific project or global scope
 */
export const runConsolidation = async (projectId?: string): Promise<void> => {
    console.log(`[Consolidator] Starting consolidation for ${projectId || 'Global'}...`);

    // 1. Fetch recent logs (last 50 for now)
    const logs = await getMemoryLogs({ projectId, limit: 50 });
    if (logs.length === 0) return;

    // 2. Group by section/topic (heuristic attempt as logs are semi-structured)
    // In a real OpenClaw implementation, we might use an LLM here to cluster logs.
    // For V2.1 simple version, we'll extract "Section: Key Value" patterns.

    const findings = clusterLogs(logs);

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
 * Cluster raw log strings into structured patch operations
 */
function clusterLogs(logs: MemoryLog[]): MemoryPatchOp[] {
    const ops: MemoryPatchOp[] = [];
    const handledKeys = new Set<string>();

    // Sort by confidence and recency
    logs.sort((a, b) => b.confidence - a.confidence || b.timestamp - a.timestamp);

    for (const log of logs) {
        // Regex to find "Section: Key Value" or "Section: Value"
        const match = log.content.match(/^([^:>]+):\s*([^>]+?)(?:\s+([^>]+))?$/);
        if (match) {
            const section = match[1].trim();
            const key = match[3] ? match[2].trim() : undefined;
            const value = match[3] ? match[3].trim() : match[2].trim();

            const compositeKey = `${section}:${key || 'default'}`;
            if (!handledKeys.has(compositeKey)) {
                ops.push({
                    op: 'upsert',
                    section,
                    key,
                    value
                });
                handledKeys.add(compositeKey);
            }
        } else if (log.content.includes('Prefers')) {
            // Fallback for recordUserPreference style logs
            const preferenceItems = log.content.split('; ');
            for (const item of preferenceItems) {
                const prefMatch = item.match(/Prefers\s+([^:]+):\s+(.+)/);
                if (prefMatch) {
                    const key = prefMatch[1].trim();
                    const value = prefMatch[2].trim();
                    const section = key === 'aspect ratio' || key === 'image model' ? 'Generation Defaults' : 'Visual Preferences';

                    const compositeKey = `${section}:${key}`;
                    if (!handledKeys.has(compositeKey)) {
                        ops.push({ op: 'upsert', section, key: `preferred_${key.replace(' ', '_')}`, value });
                        handledKeys.add(compositeKey);
                    }
                }
            }
        }
    }
    return ops;
}

/**
 * Check if any project findings should be promoted to Global
 */
async function checkGlobalPromotion(projectLogs: MemoryLog[]): Promise<void> {
    // Simple heuristic: if a pattern appears in multiple project logs with high confidence
    // Or if the log explicitly has scopeHint: 'global'
    const globalLogs = projectLogs.filter(l => l.scopeHint === 'global');
    if (globalLogs.length > 0) {
        const globalOps = clusterLogs(globalLogs);
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

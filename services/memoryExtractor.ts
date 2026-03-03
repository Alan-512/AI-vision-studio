// services/memoryExtractor.ts
import { GoogleGenAI } from '@google/genai';
import { appendDailyLog } from './memoryService';
import { ChatMessage } from '../types';

const STORAGE_KEY = 'ai_vision_studio_memory_extract_last_ts';
const MIN_MESSAGES_FOR_ANALYSIS = 3;

/**
 * Background task to analyze recent generations and extract project-level memory
 * @param projectId Current project ID
 * @param history Current chat history
 * @param apiKey User's Gemini API Key
 */
export const runMemoryExtractionTask = async (
    projectId: string,
    history: ChatMessage[],
    apiKey?: string | null
): Promise<void> => {
    if (!apiKey || !projectId) return;

    // Filter for SYSTEM_FEEDBACK messages that confirm successful image generations
    // These are injected as user messages after each successful generation: `[SYSTEM_FEEDBACK]: Image generated successfully based on prompt: "..."`
    const genMessages = history.filter(m =>
        m.role === 'user' &&
        m.isSystem === true &&
        typeof m.content === 'string' &&
        m.content.includes('[SYSTEM_FEEDBACK]') &&
        m.content.includes('Image generated successfully')
    );

    if (genMessages.length < MIN_MESSAGES_FOR_ANALYSIS) return;

    try {
        const storageItem = localStorage.getItem(`${STORAGE_KEY}_${projectId}`);
        const lastExtractTs = Number(storageItem || 0);

        // Find new generation messages since last extraction
        const newGenMessages = genMessages.filter(m => m.timestamp > lastExtractTs);

        // Only extract if we have enough NEW data to warrant it
        if (newGenMessages.length < MIN_MESSAGES_FOR_ANALYSIS) {
            return;
        }

        console.log(`[MemoryExtractor] Found ${newGenMessages.length} new generation tasks. Starting background analysis...`);

        // Extract original prompts from SYSTEM_FEEDBACK content
        // Format: `[SYSTEM_FEEDBACK]: Image generated successfully based on prompt: "<prompt>".`
        const promptsToAnalyze = newGenMessages.map(m => {
            const promptMatch = m.content.match(/based on prompt:\s*"([^"]+)"/);
            return promptMatch ? `[Prompt]: ${promptMatch[1]}` : `[Prompt]: ${m.content}`;
        }).join('\n---\n');

        const systemPrompt = `You are a memory consolidation expert for a creative AI image studio.
Analyze the following recent user generation prompts and extract their core creative decisions for the CURRENT PROJECT.
Extract ONLY strong, recurring patterns. If there are no clear patterns, return an empty JSON object.

CONFLICT DETECTION: If the recent prompts suggest a clear SHIFT in style compared to what might have been stored before
(e.g., prompts were all "watercolor" before but now consistently "cyberpunk"), mark the field with "override": true.
This tells the system to replace the old value, not coexist with it.

Output MUST be valid JSON matching this schema:
{
  "style_card": {
    "primary_style": "string (e.g., 'cyberpunk', 'watercolor', or empty)",
    "color_scheme": "string (e.g., 'neon pink and blue', or empty)",
    "mood": "string (e.g., 'dystopian', 'whimsical', or empty)",
    "lighting": "string (e.g., 'golden hour', 'studio lighting', 'neon glow', or empty)",
    "camera_angle": "string (e.g., 'close-up', 'aerial', 'eye-level', 'low-angle', or empty)",
    "subject_type": "string (e.g., 'portrait', 'landscape', 'product', 'character', or empty)"
  },
  "prompt_patterns": [
    "string (a reusable prompt fragment they use frequently)"
  ]
}`;

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Fast and cheap for backend tasks
            contents: [
                { role: 'user', parts: [{ text: `Analyze these recent prompts:\n\n${promptsToAnalyze}` }] }
            ],
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
                temperature: 0.1
            }
        });

        const resultText = response.text;
        if (resultText) {
            const parsed = JSON.parse(resultText);
            const ops: { op: "upsert" | "append" | "delete"; section: string; key?: string; value: string; }[] = [];

            // Create patch operations based on LLM analysis
            if (parsed.style_card) {
                const styleFields = ['primary_style', 'color_scheme', 'mood', 'lighting', 'camera_angle', 'subject_type'];
                for (const field of styleFields) {
                    if (parsed.style_card[field]) {
                        ops.push({ op: 'upsert', section: 'Style Card', key: field, value: parsed.style_card[field] });
                    }
                }
            }

            if (parsed.prompt_patterns && Array.isArray(parsed.prompt_patterns)) {
                parsed.prompt_patterns.forEach((pattern: string) => {
                    if (pattern) {
                        ops.push({ op: 'append', section: 'Prompt Patterns', value: pattern });
                    }
                });
            }

            if (ops.length > 0) {
                const summary = ops.map(o => `${o.section} > ${o.key || ''}: ${o.value}`).join('; ');
                await appendDailyLog({
                    content: `Consolidated patterns: ${summary}`,
                    confidence: 0.8,
                    projectId,
                    scopeHint: 'project',
                    metadata: { source: 'background_extractor', op_count: ops.length }
                });
                console.log(`[MemoryExtractor] Successfully logged consolidated project styles: ${ops.length} patterns.`);
            } else {
                console.log(`[MemoryExtractor] No clear patterns found to consolidate.`);
            }
        }

        // Mark extraction time
        const latestTs = Math.max(...newGenMessages.map(m => m.timestamp));
        localStorage.setItem(`${STORAGE_KEY}_${projectId}`, String(latestTs));

    } catch (err) {
        console.error(`[MemoryExtractor] Background task failed:`, err);
    }
};

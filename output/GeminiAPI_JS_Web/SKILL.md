---
name: GeminiAPI_Lumina_Gen
description: Expert in Lumina Studio's implementation of Gemini 3, Imagen 3, and Veo models for generative AI.
---

# Gemini & Veo Generation Skill (Lumina Studio)

This skill is tailored for the **Lumina Studio** project, focusing on the orchestration of **Gemini 3 (Reasoning)**, **Imagen (Image Gen)**, and **Veo (Video Gen)** models.

## Core Capabilities
- **Video Generation**: Generating high-quality videos using `veo-3.1` with support for image-to-video (keyframes).
- **Image Generation**: Using `gemini-3-pro-image-preview` for high-fidelity visual synthesis and conversational editing.
- **Agent Reasoning**: Leveraging `gemini-3-flash`'s **Thinking** mode to plan generation tasks and refine prompts.

## Quick Reference

### 1. Generating Video (Veo)
```javascript
// In geminiService.ts
const result = await model.generateContent({
  contents: [
    { text: "Cinematic drone shot of a coastline" },
    // Optional: Start/End frames
    { inlineData: { mimeType: "image/jpeg", data: "..." } } 
  ],
  config: { videoGenerationConfig: { aspectRatio: "16:9", durationSeconds: 5 } }
});
```

### 2. Conversational Image Gen
```javascript
// Persistent session for iterative editing
const chat = model.startChat({ history: currentHistory });
const result = await chat.sendMessage("Change the background to sunset");
// Result contains the updated image
```

### 3. Agent Planning (Reasoning)
```javascript
// Used in AgentStateMachine for 'Understanding' & 'Planning' phases
const response = await agentModel.generateContent({
  contents: "User wants a cyberpunk style. Analyze key visual elements.",
  config: { thinkingConfig: { includeThoughts: true } }
});
```

## Best Practices
- **Veo Latency**: Video generation takes time. Ensure UI shows appropriate loading states (Processing/Downloading).
- **Prompt Refinement**: Always use the Agent model to *rewrite* user prompts before sending them to Veo/Imagen for better adherence.
- **Tool Calling**: The Agent should output structured tool calls (`generate_image`, `generate_video`) rather than raw text when the user asks for media.

## Reference Files
- **api.md**: Detailed configuration for Veo, Image models, and Reasoning parameters tailored to the `@google/genai` SDK.
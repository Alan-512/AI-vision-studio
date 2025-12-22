# Gemini API & Veo Generation Reference (Lumina Studio)

## Core Configuration
Using `@google/genai` v1.0.0.

```javascript
import { GoogleGenAI } from "@google/genai";
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
```

## 1. Video Generation (Veo)
Using `veo-3.1` models for high-fidelity video generation.

### Generate Video
```javascript
async function generateVideo(prompt, options = {}) {
  const model = genAI.getGenerativeModel({ 
    model: "veo-3.1-preview-0220" // or veo-2.0-0220
  });

  // Veo supports image guidance (start/end frames)
  const inputContents = [{ text: prompt }];
  
  if (options.startImage) {
    inputContents.push({ 
      inlineData: { mimeType: options.startImage.mime, data: options.startImage.base64 } 
    });
  }

  const result = await model.generateContent({
    contents: inputContents,
    config: {
      // Veo specific configuration
      videoGenerationConfig: {
        aspectRatio: options.aspectRatio || "16:9",
        durationSeconds: options.duration || 5,
        fps: 24
      }
    }
  });

  // Video generation is usually asynchronous/long-running
  return result.response;
}
```

## 2. Image Generation (Imagen 3 / Gemini Image)
Using `gemini-3-pro-image-preview` or `gemini-2.5-flash-image`.

### Standard Generation
```javascript
const model = genAI.getGenerativeModel({ model: "gemini-3-pro-image-preview" });

const response = await model.generateContent({
  contents: [{ text: "A futuristic city with neon lights" }],
  config: {
    // Image generation parameters
    imageGenerationConfig: {
      numberOfImages: 1,
      aspectRatio: "1:1",
      safetySettings: [/* ... */]
    }
  }
});

// Extract generated image
const imageBase64 = response.candidates[0].content.parts[0].inlineData.data;
```

### Conversational Image Editing (Lumina Special)
Lumina uses a chat session to refine images iteratively.

```javascript
// Keep history to allow "Make it bluer" type follow-ups
let chatSession = model.startChat({ history: [] });

async function refineImage(prompt) {
  const result = await chatSession.sendMessage(prompt);
  // The model returns a NEW image based on context + new prompt
  return result.response;
}
```

## 3. Agent Reasoning (Gemini 3 Thinking)
Using `gemini-3-flash-preview` or `gemini-3-pro-preview` for the Agent Brain.

### Thinking Mode (Reasoning)
Crucial for `AgentStateMachine` to plan complex tasks before executing tools.

```javascript
const agentModel = genAI.getGenerativeModel({ 
  model: "gemini-3-flash-preview",
  useThinking: true // Enable reasoning capabilities
});

const result = await agentModel.generateContent({
  contents: "User wants a video of a cat. Plan the style and prompt.",
  config: {
    thinkingConfig: {
      includeThoughts: true // Returns the reasoning trace
    }
  }
});

// Access the 'thought' part before the actual response
const thoughts = result.candidates[0].content.parts.filter(p => p.thought);
```

## Supported Models (Lumina Config)

| Type | Model ID | Use Case |
|------|----------|----------|
| **Text/Agent** | `gemini-3-flash-preview` | Fast reasoning, tool calling, chat. |
| **Text/Agent** | `gemini-3-pro-preview` | Complex planning, deep instruction following. |
| **Image** | `gemini-2.5-flash-image` | High-speed image generation. |
| **Image** | `gemini-3-pro-image-preview` | High-fidelity, prompt-adherence image gen. |
| **Video** | `veo-3.1-preview-0220` | Realistic video generation with control. |
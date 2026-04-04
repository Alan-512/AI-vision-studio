import { AppMode, TextModel, type ChatMessage } from '../types';

export const describeImageWithModel = async ({
  ai,
  base64,
  mimeType
}: {
  ai: any;
  base64: string;
  mimeType: string;
}): Promise<string> => {
  const response = await ai.models.generateContent({
    model: TextModel.FLASH,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: 'Describe this image in detail.' }
      ]
    }
  });
  return (response.text ?? '').trim();
};

export const generateShortTitle = async ({
  ai,
  prompt
}: {
  ai: any;
  prompt: string;
}): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: TextModel.FLASH,
      contents: `Generate a very short title (5-15 Chinese characters OR 3-6 English words MAX) that summarizes the following creative prompt. 
RULES:
- Output ONLY the title itself, nothing else.
- Do NOT output a list of options. Output exactly ONE title.
- Do NOT include quotes, numbering, or explanations.
- Keep it concise and descriptive.

Prompt: "${prompt.slice(0, 200)}"`
    });

    let title = (response.text ?? '').trim()
      .replace(/^[\"'""'']+|[\"'""'']+$/g, '')
      .replace(/^\d+\.\s*/, '')
      .split('\n')[0];

    if (title.length > 30) {
      title = title.slice(0, 30);
    }

    return title || prompt.slice(0, 20);
  } catch {
    return prompt.slice(0, 20);
  }
};

export const testGeminiConnection = async ({
  ai
}: {
  ai: any;
}): Promise<boolean> => {
  await ai.models.generateContent({ model: TextModel.FLASH, contents: 'Test' });
  return true;
};

export const extractPromptFromHistoryWithModel = async ({
  ai,
  history,
  mode,
  convertHistoryToNativeFormat
}: {
  ai: any;
  history: ChatMessage[];
  mode: AppMode;
  convertHistoryToNativeFormat: (history: ChatMessage[], model: string) => any[];
}): Promise<string | null> => {
  if (history.length === 0) return null;
  const contents = convertHistoryToNativeFormat(history, TextModel.FLASH);
  contents.push({ role: 'user', parts: [{ text: `Based on above, output a single visual prompt for ${mode}. Text only.` }] });
  const response = await ai.models.generateContent({ model: TextModel.FLASH, contents });
  return (response.text ?? '').trim();
};

export const generateTextWithModel = async ({
  ai,
  systemInstruction,
  prompt,
  forceJson = false,
  modelName = TextModel.FLASH
}: {
  ai: any;
  systemInstruction: string;
  prompt: string;
  forceJson?: boolean;
  modelName?: TextModel;
}): Promise<string> => {
  const config: any = {
    systemInstruction
  };

  if (forceJson) {
    config.responseMimeType = 'application/json';
  }

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config
  });
  return (response.text ?? '').trim();
};

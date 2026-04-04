import { describe, expect, it, vi } from 'vitest';
import { AppMode, TextModel, type ChatMessage } from '../types';
import {
  describeImageWithModel,
  extractPromptFromHistoryWithModel,
  generateShortTitle,
  generateTextWithModel,
  testGeminiConnection
} from '../services/geminiUtilityRuntime';

describe('geminiUtilityRuntime', () => {
  it('describes an image with flash model', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'Detailed scene' });
    const result = await describeImageWithModel({
      ai: { models: { generateContent } } as any,
      base64: 'abc',
      mimeType: 'image/png'
    });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: TextModel.FLASH
    }));
    expect(result).toBe('Detailed scene');
  });

  it('falls back to prompt slice when title generation fails', async () => {
    const title = await generateShortTitle({
      ai: { models: { generateContent: vi.fn().mockRejectedValue(new Error('boom')) } } as any,
      prompt: 'A long creative prompt about a futuristic bookstore'
    });

    expect(title).toBe('A long creative prom');
  });

  it('tests connection by issuing a flash request', async () => {
    const generateContent = vi.fn().mockResolvedValue({});
    const ok = await testGeminiConnection({
      ai: { models: { generateContent } } as any
    });

    expect(ok).toBe(true);
    expect(generateContent).toHaveBeenCalledWith({ model: TextModel.FLASH, contents: 'Test' });
  });

  it('extracts a prompt from history using converted contents', async () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1 }];
    const generateContent = vi.fn().mockResolvedValue({ text: 'visual prompt' });
    const convertHistoryToNativeFormat = vi.fn().mockReturnValue([{ role: 'user', parts: [{ text: 'hello' }] }]);

    const result = await extractPromptFromHistoryWithModel({
      ai: { models: { generateContent } } as any,
      history,
      mode: AppMode.IMAGE,
      convertHistoryToNativeFormat
    });

    expect(convertHistoryToNativeFormat).toHaveBeenCalledWith(history, TextModel.FLASH);
    expect(result).toBe('visual prompt');
  });

  it('generates text with optional json mime type', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'ok' });
    const result = await generateTextWithModel({
      ai: { models: { generateContent } } as any,
      systemInstruction: 'system',
      prompt: 'prompt',
      forceJson: true
    });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        responseMimeType: 'application/json'
      })
    }));
    expect(result).toBe('ok');
  });
});

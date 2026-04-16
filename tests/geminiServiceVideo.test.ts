import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateVideoWithModelMock = vi.fn();
const createTrackedBlobUrlMock = vi.fn();

vi.mock('@google/genai', async () => {
  const actual = await vi.importActual<typeof import('@google/genai')>('@google/genai');
  class MockGoogleGenAI {
    constructor(_config?: unknown) {}
  }
  return {
    ...actual,
    GoogleGenAI: MockGoogleGenAI as any
  };
});

vi.mock('../services/geminiMediaRuntime', () => ({
  generateImageWithModel: vi.fn(),
  generateVideoWithModel: generateVideoWithModelMock
}));

vi.mock('../services/storageService', async () => {
  const actual = await vi.importActual('../services/storageService');
  return {
    ...actual,
    createTrackedBlobUrl: createTrackedBlobUrlMock
  };
});

describe('geminiService video delegation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user_gemini_api_key', 'key-123');
    generateVideoWithModelMock.mockReset();
    createTrackedBlobUrlMock.mockReset();
    generateVideoWithModelMock.mockResolvedValue({ blobUrl: 'blob:video-1', videoUri: 'gs://video-1' });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('passes createTrackedBlobUrl into generateVideoWithModel', async () => {
    const { generateVideo } = await import('../services/geminiService');

    await generateVideo({
      prompt: '让人物动起来',
      aspectRatio: '16:9' as any,
      imageModel: 'gemini-3.1-flash-image-preview' as any,
      videoModel: 'veo-3.1-fast-generate-preview' as any,
      imageStyle: 'None' as any,
      videoStyle: 'None' as any,
      imageResolution: '1K' as any,
      videoResolution: '720p' as any,
      videoDuration: '4' as any,
      useGrounding: false
    } as any, vi.fn(), vi.fn(), new AbortController().signal);

    expect(generateVideoWithModelMock).toHaveBeenCalledTimes(1);
    expect(generateVideoWithModelMock.mock.calls[0][0]).toMatchObject({
      createTrackedBlobUrl: createTrackedBlobUrlMock
    });
  });
});

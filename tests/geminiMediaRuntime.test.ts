import { afterEach, describe, expect, it, vi } from 'vitest';
import { AspectRatio, ImageModel, TextModel, VideoModel, type GenerationParams } from '../types';
import { generateImageWithModel, generateVideoWithModel } from '../services/geminiMediaRuntime';
import { convertHistoryToNativeFormat, getRoleInstruction, resolveSmartAssetRole } from '../services/chatContentRuntime';

describe('geminiMediaRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final image and thought signatures from image generation response', async () => {
    const onStart = vi.fn();
    const onThoughtImage = vi.fn();
    const ai = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  thought: true,
                  inlineData: { data: 'draft-data', mimeType: 'image/png' },
                  thoughtSignature: 'draft-sig'
                },
                {
                  inlineData: { data: 'final-data', mimeType: 'image/png' },
                  thoughtSignature: 'final-sig'
                }
              ]
            }
          }]
        })
      }
    } as any;

    const asset = await generateImageWithModel({
      ai,
      params: {
        prompt: 'make a poster',
        imageModel: ImageModel.FLASH_3_1,
        aspectRatio: AspectRatio.SQUARE,
        imageResolution: '1K' as any,
        useGrounding: false,
        smartAssets: []
      } as GenerationParams,
      projectId: 'project-1',
      onStart,
      signal: new AbortController().signal,
      id: 'asset-1',
      convertHistoryToNativeFormat: vi.fn().mockReturnValue([]),
      buildGoogleSearchTools: vi.fn(),
      getRoleInstruction: vi.fn().mockReturnValue('[Image 1]'),
      resolveSmartAssetRole: vi.fn()
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onThoughtImage).not.toHaveBeenCalled();
    expect(asset.url).toBe('data:image/png;base64,final-data');
    expect(asset.metadata?.thoughtSignatures).toEqual([
      { partIndex: 0, signature: 'draft-sig' },
      { partIndex: 1, signature: 'final-sig' }
    ]);
  });

  it('keeps explicit smart assets as reference parts even when the same image already exists in chat history', async () => {
    const ai = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [
                { inlineData: { data: 'final-data', mimeType: 'image/png' } }
              ]
            }
          }]
        })
      }
    } as any;

    await generateImageWithModel({
      ai,
      params: {
        prompt: 'extend this weather anchor image',
        imageModel: ImageModel.FLASH_3_1,
        aspectRatio: AspectRatio.LANDSCAPE,
        imageResolution: '1K' as any,
        useGrounding: false,
        smartAssets: [{
          id: 'asset-1',
          mimeType: 'image/png',
          data: 'same-image-data',
          role: 'SUBJECT' as any
        }]
      } as GenerationParams,
      projectId: 'project-1',
      onStart: vi.fn(),
      signal: new AbortController().signal,
      id: 'asset-1',
      history: [{
        role: 'user',
        content: 'Use this anchor as reference',
        image: 'data:image/png;base64,same-image-data',
        timestamp: 1
      }] as any,
      convertHistoryToNativeFormat,
      buildGoogleSearchTools: vi.fn(),
      getRoleInstruction,
      resolveSmartAssetRole
    });

    const generateContentArgs = ai.models.generateContent.mock.calls[0][0];
    const contents = generateContentArgs.contents as any[];
    const historyParts = contents.slice(0, -1).flatMap(content => content.parts ?? []);
    const requestParts = contents[contents.length - 1].parts;

    expect(historyParts.some((part: any) => part.inlineData)).toBe(false);
    expect(requestParts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        inlineData: expect.objectContaining({
          mimeType: 'image/png',
          data: 'same-image-data'
        })
      }),
      expect.objectContaining({
        text: expect.stringMatching(/subject/i)
      })
    ]));
  });

  it('downloads the generated video and returns blob/video uris', async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const blob = new Blob(['video']);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob)
    });
    vi.stubGlobal('fetch', fetchMock);

    const ai = {
      models: {
        generateVideos: vi.fn().mockResolvedValue({
          done: true,
          response: {
            generatedVideos: [{ video: { uri: 'https://video.example.com/file.mp4?token=1' } }]
          }
        })
      }
    } as any;

    const result = await generateVideoWithModel({
      ai,
      params: {
        prompt: 'animate this',
        videoModel: VideoModel.VEO_FAST,
        videoResolution: '720p' as any,
        aspectRatio: AspectRatio.LANDSCAPE,
        videoDuration: '4',
        videoStyleReferences: []
      } as GenerationParams,
      onUpdate,
      onStart,
      signal: new AbortController().signal,
      createTrackedBlobUrl: vi.fn().mockReturnValue('blob:video-1'),
      getApiKey: () => 'key-123'
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://video.example.com/file.mp4?token=1&key=key-123');
    expect(result).toEqual({
      blobUrl: 'blob:video-1',
      videoUri: 'https://video.example.com/file.mp4?token=1'
    });
  });

  it('sends Veo video config in the format expected by the SDK', async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const generateVideos = vi.fn().mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [{ video: { uri: 'https://video.example.com/file.mp4?token=1' } }]
      }
    });

    const ai = {
      models: { generateVideos }
    } as any;

    await generateVideoWithModel({
      ai,
      params: {
        prompt: 'adult presenter walking and explaining the weather',
        videoModel: VideoModel.VEO_FAST,
        videoResolution: '720p' as any,
        aspectRatio: AspectRatio.LANDSCAPE,
        videoDuration: '4' as any,
        videoStyleReferences: []
      } as GenerationParams,
      onUpdate,
      onStart,
      signal: new AbortController().signal,
      createTrackedBlobUrl: vi.fn().mockReturnValue('blob:video-1'),
      getApiKey: () => 'key-123',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['video']))
      }) as any
    });

    expect(generateVideos).toHaveBeenCalledWith(expect.objectContaining({
      model: VideoModel.VEO_FAST,
      config: expect.objectContaining({
        durationSeconds: 4,
        personGeneration: 'allow_adult'
      })
    }));
  });

  it('continues video generation when the AI Studio bridge check fails', async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['video']))
    });

    (window as any).aistudio = {
      hasSelectedApiKey: vi.fn().mockRejectedValue(new Error('The message port closed before a response was received.')),
      openSelectKey: vi.fn()
    };

    const generateVideos = vi.fn().mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [{ video: { uri: 'https://video.example.com/file.mp4?token=1' } }]
      }
    });

    const result = await generateVideoWithModel({
      ai: { models: { generateVideos } } as any,
      params: {
        prompt: 'animate this anchor shot',
        videoModel: VideoModel.VEO_FAST,
        videoResolution: '720p' as any,
        aspectRatio: AspectRatio.LANDSCAPE,
        videoDuration: '4' as any,
        videoStyleReferences: []
      } as GenerationParams,
      onUpdate,
      onStart,
      signal: new AbortController().signal,
      createTrackedBlobUrl: vi.fn().mockReturnValue('blob:video-1'),
      getApiKey: () => 'key-123',
      fetchImpl: fetchMock as any
    });

    expect(generateVideos).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[Video] AI Studio bridge unavailable, continuing with configured API key.', expect.any(Error));
    expect(result).toEqual({
      blobUrl: 'blob:video-1',
      videoUri: 'https://video.example.com/file.mp4?token=1'
    });
  });

  it('logs and surfaces raw Veo operation errors before download handling', async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(generateVideoWithModel({
      ai: {
        models: {
          generateVideos: vi.fn().mockResolvedValue({
            done: true,
            error: {
              code: 400,
              message: 'Request contains an invalid argument.'
            }
          })
        }
      } as any,
      params: {
        prompt: 'animate this anchor shot',
        videoModel: VideoModel.VEO_FAST,
        videoResolution: '720p' as any,
        aspectRatio: AspectRatio.LANDSCAPE,
        videoDuration: '4' as any,
        videoStyleReferences: []
      } as GenerationParams,
      onUpdate,
      onStart,
      signal: new AbortController().signal,
      createTrackedBlobUrl: vi.fn(),
      getApiKey: () => 'key-123',
      fetchImpl: vi.fn() as any
    })).rejects.toThrow('Request contains an invalid argument.');

    expect(errorSpy).toHaveBeenCalledWith('[Video] generateVideos returned an operation error:', expect.objectContaining({
      code: 400,
      message: 'Request contains an invalid argument.'
    }));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AspectRatio, ImageModel, TextModel, VideoModel, type GenerationParams } from '../types';
import { generateImageWithModel, generateVideoWithModel } from '../services/geminiMediaRuntime';

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
});

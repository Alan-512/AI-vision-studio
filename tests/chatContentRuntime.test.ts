import { describe, expect, it } from 'vitest';
import { TextModel, type ChatMessage } from '../types';
import { convertHistoryToNativeFormat } from '../services/chatContentRuntime';

describe('chatContentRuntime', () => {
  it('wraps user text in input markers and strips tool planning noise', () => {
    const history: ChatMessage[] = [{
      role: 'user',
      content: 'make a poster\n[Using Tool: generate_image]\n!!! GENERATE_IMAGE {"prompt":"x"} !!!',
      timestamp: 1
    }];

    const contents = convertHistoryToNativeFormat(history, TextModel.FLASH);

    expect(contents[0].parts[0]).toMatchObject({
      text: '[USER INPUT]\nmake a poster\n[/USER INPUT]'
    });
  });

  it('keeps the latest image attachment and downgrades older images to visual history text', () => {
    const image = 'data:image/png;base64,ZmFrZQ==';
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'oldest image',
        image,
        timestamp: 1
      },
      {
        role: 'user',
        content: 'older image',
        image,
        timestamp: 2
      },
      {
        role: 'user',
        content: 'newer image',
        image,
        timestamp: 3
      },
      {
        role: 'user',
        content: 'latest image',
        image,
        timestamp: 4
      }
    ];

    const contents = convertHistoryToNativeFormat(history, TextModel.FLASH);
    const firstParts = contents[0].parts;
    const lastParts = contents[3].parts;

    expect(firstParts[0]).toMatchObject({
      text: '[Visual History: Reference image provided previously.]'
    });
    expect(lastParts[0]).toMatchObject({
      text: '\n[Attached Image ID: user-4-0]\n'
    });
    expect((lastParts[1] as any).inlineData).toMatchObject({
      mimeType: 'image/png',
      data: 'ZmFrZQ=='
    });
  });
});

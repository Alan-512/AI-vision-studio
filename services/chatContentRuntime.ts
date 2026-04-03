import type { Content, Part } from '@google/genai';
import { SmartAssetRole, type ChatMessage, type SmartAsset } from '../types';
import { getRoleInstruction as getSkillRoleInstruction } from './skills/promptRouter';

export const buildGoogleSearchTools = (includeImageSearch = false) => [{
  googleSearch: includeImageSearch
    ? {
      searchTypes: {
        webSearch: {},
        imageSearch: {}
      }
    }
    : {}
}] as any[];

export const resolveSmartAssetRole = (asset: SmartAsset): SmartAssetRole | null => {
  if (asset.role && Object.values(SmartAssetRole).includes(asset.role)) return asset.role;
  const legacyType = asset.type ? String(asset.type).toUpperCase() : '';
  switch (legacyType) {
    case 'STRUCTURE':
      return SmartAssetRole.COMPOSITION;
    case 'STYLE':
      return SmartAssetRole.STYLE;
    case 'SUBJECT':
      return SmartAssetRole.SUBJECT;
    case 'EDIT_BASE':
      return SmartAssetRole.EDIT_BASE;
    default:
      return null;
  }
};

export const getRoleInstruction = (role: SmartAssetRole, index: number): string => {
  return getSkillRoleInstruction(role, index);
};

export const convertHistoryToNativeFormat = (history: ChatMessage[], modelName: string): Content[] => {
  const isFlash = modelName.includes('flash');
  const maxImages = isFlash ? 3 : 5;

  let imagesKept = 0;
  const imageIndicesToKeep = new Set<string>();

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const imgCount = (msg.images?.length || 0) + (msg.image ? 1 : 0);

    if (imgCount > 0) {
      if (msg.images && msg.images.length > 0) {
        for (let j = msg.images.length - 1; j >= 0; j--) {
          if (imagesKept < maxImages) {
            imageIndicesToKeep.add(`${i}-${j}`);
            imagesKept++;
          }
        }
      } else if (msg.image && imagesKept < maxImages) {
        imageIndicesToKeep.add(`${i}-0`);
        imagesKept++;
      }
    }
  }

  return history.map((msg, index) => {
    const parts: Part[] = [];

    if (msg.images && msg.images.length > 0) {
      msg.images.forEach((img, imgIdx) => {
        const shouldKeep = imageIndicesToKeep.has(`${index}-${imgIdx}`);
        if (shouldKeep) {
          const matches = img.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const imgId = `${msg.role === 'user' ? 'user' : 'generated'}-${msg.timestamp}-${imgIdx}`;
            parts.push({ text: `\n[Attached Image ID: ${imgId}]\n` });
            const partData: any = { inlineData: { mimeType: matches[1], data: matches[2] } };
            const sig = msg.thoughtSignatures?.find(s => s.partIndex === imgIdx);
            if (sig) partData.thoughtSignature = sig.signature;
            parts.push(partData);
          }
        } else {
          parts.push({ text: `[Visual History: A previously generated image of ${msg.content.slice(0, 30)}...]` });
        }
      });
    } else if (msg.image) {
      const shouldKeep = imageIndicesToKeep.has(`${index}-0`);
      if (shouldKeep) {
        const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const imgId = `${msg.role === 'user' ? 'user' : 'generated'}-${msg.timestamp}-0`;
          parts.push({ text: `\n[Attached Image ID: ${imgId}]\n` });
          const partData: any = { inlineData: { mimeType: matches[1], data: matches[2] } };
          const sig = msg.thoughtSignatures?.find(s => s.partIndex === 0);
          if (sig) partData.thoughtSignature = sig.signature;
          parts.push(partData);
        }
      } else {
        parts.push({ text: `[Visual History: Reference image provided previously.]` });
      }
    }

    if (msg.content) {
      let textContent = msg.content
        .replace(/\[Using Tool:.*?\]/g, '')
        .replace(/\[SYSTEM_FEEDBACK\]:.*?(\n|$)/g, '')
        .replace(/\[PROTOCOL:.*?\]/g, '')
        .replace(/\[PLANNER\]:.*?(\n|$)/g, '')
        .replace(/\.\.\. \[Orchestrator\]:.*?(\n|$)/g, '')
        .replace(/!!!?\s*GENERATE_IMAGE\s*\{[\s\S]*?\}\s*!!!?/g, '')
        .replace(/<\s*thought\s*>[\s\S]*?<\s*\/\s*thought\s*>/gi, '')
        .replace(/<\s*thought\s*>[\s\S]*$/gi, '')
        .trim();

      if (textContent) {
        const markedText = msg.role === 'user' ? `[USER INPUT]\n${textContent}\n[/USER INPUT]` : textContent;
        const textPartData: any = { text: markedText };
        const textSig = msg.thoughtSignatures?.find(s => s.partIndex === -1);
        if (textSig) textPartData.thoughtSignature = textSig.signature;
        parts.push(textPartData);
      }
    }

    if (parts.length === 0) parts.push({ text: ' ' });
    const validRole = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'model';
    return { role: validRole, parts };
  });
};

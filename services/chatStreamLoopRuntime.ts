type StreamSource = { title: string; uri: string };
type StreamSignature = { partIndex: number; signature: string };
type PendingToolCall = { toolName: string; args: any };

export const executeChatStreamLoop = async ({
  result,
  signal,
  onChunk,
  onThoughtText,
  onThoughtImage,
  normalizeToolName,
  stripVisiblePlanningText
}: {
  result: AsyncIterable<any>;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  onThoughtText?: (text: string) => void;
  onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  normalizeToolName: (toolName?: string) => string | null;
  stripVisiblePlanningText: (text: string) => string;
}) => {
  let fullText = '';
  const sourcesSet = new Set<string>();
  const sourcesList: StreamSource[] = [];
  const collectedSignatures: StreamSignature[] = [];
  const pendingToolCalls: PendingToolCall[] = [];
  const assistantTurnParts: any[] = [];
  let chunkCount = 0;

  for await (const chunk of result) {
    chunkCount++;
    if (signal.aborted) break;

    if (chunk.candidates?.[0]?.content?.parts) {
      for (const part of chunk.candidates[0].content.parts as any[]) {
        if (part.text) {
          if (part.thought === true) {
            onThoughtText?.(part.text);
            assistantTurnParts.push({ text: part.text, thought: true, thoughtSignature: part.thoughtSignature });
          } else {
            fullText = stripVisiblePlanningText(fullText + part.text);
            assistantTurnParts.push({ text: part.text, thoughtSignature: part.thoughtSignature });
            onChunk(fullText);
          }
        }
      }
    }

    if (chunk.candidates?.[0]?.content?.parts) {
      for (const part of chunk.candidates[0].content.parts) {
        if (part.functionCall) {
          const normalizedToolName = normalizeToolName(part.functionCall.name);
          if (normalizedToolName) {
            assistantTurnParts.push({
              functionCall: { name: normalizedToolName, args: part.functionCall.args },
              thoughtSignature: part.thoughtSignature
            });
            pendingToolCalls.push({ toolName: normalizedToolName, args: part.functionCall.args });
          }
        }
      }
    }

    const chunkAny = chunk as any;
    if (chunkAny.groundingMetadata?.groundingChunks) {
      chunkAny.groundingMetadata.groundingChunks.forEach((groundingChunk: any) => {
        if (groundingChunk.web?.uri && groundingChunk.web?.title && !sourcesSet.has(groundingChunk.web.uri)) {
          sourcesSet.add(groundingChunk.web.uri);
          sourcesList.push({ title: groundingChunk.web.title, uri: groundingChunk.web.uri });
        }
      });
    }

    if (chunk.candidates?.[0]?.content?.parts) {
      chunk.candidates[0].content.parts.forEach((part: any, idx: number) => {
        if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
          onThoughtImage?.({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
            isFinal: !part.thought
          });
        }

        if (part.thoughtSignature && !collectedSignatures.find(signature => signature.signature === part.thoughtSignature)) {
          const partIndex = part.inlineData ? idx : -1;
          collectedSignatures.push({ partIndex, signature: part.thoughtSignature });
        }
      });
    }
  }

  return {
    fullText,
    sourcesList,
    collectedSignatures,
    pendingToolCalls,
    assistantTurnParts,
    chunkCount
  };
};

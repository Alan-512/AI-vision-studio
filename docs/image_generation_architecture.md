# 图像生成对话架构（按产品方案）

## 目标与范围

本方案用于「对话页面」的图像生成流程，满足以下需求：

- 用户与 AI 对话澄清需求，AI 确认后调用图像模型生成。
- LLM 对话模型可由用户手动选择：Flash / Thinking。
- 图像模型有两种：Flash（无联网）/ Pro（支持搜索）。
- 搜索开关是“权限”，AI 决定是否搜索。
- Auto 模式下 AI 自动选择图像模型与参数。
- 支持用户上传参考图，支持多轮编辑。

## 官方能力与约束（必须遵守）

基于官方文档（Gemini 3 JS / Image / Video）：

- `googleSearch` 不能与 `functionDeclarations` 同时使用。
- 图像多轮编辑建议使用同一 chat 会话，并携带 `responseModalities: ['TEXT','IMAGE']`。
- Pro 图像模型多轮编辑依赖 `thoughtSignature`，必须原样回传。

## 核心原则

1. 单一对话上下文：文本、图片、参考图、thoughtSignature 全部保存在同一对话历史中。
2. 搜索开关是“权限”，不是“强制搜索”。AI 仍需判断是否搜索。
3. 不走文本 fallback 触发生成，避免参数丢失。
4. 搜索只走一种通路，避免重复搜索和成本翻倍。

## 架构总览

```
UI(用户输入/上传/设置)
        |
        v
LLM 对话层 (Flash/Thinking)
  - 理解意图
  - 选择是否搜索
  - 选择图像模型与参数
        |
        +--> 搜索阶段(可选, googleSearch only)
        |
        v
生成阶段 (function call only)
  - generate_image(prompt, model, resolution, useGrounding, ...)
        |
        v
图像模型执行 (Flash/Pro)
  - 多轮编辑用同一 chat 会话
  - 维护 thoughtSignature
```

## 两段式流程（搜索开启时）

### 阶段 A：搜索阶段（仅 LLM + googleSearch）
用于“需要外部信息”的场景，例如地点、人物、实时事实。

- tools: `[{ googleSearch: {} }]`
- 禁止 function calling
- 输出：结构化“可生成 prompt + 参数建议”

### 阶段 B：生成阶段（仅 function call）

- tools: `[{ functionDeclarations: [generate_image] }]`
- 必须输出完整参数：`prompt`, `model`, `resolution`, `useGrounding`, `aspectRatio`, `numberOfImages`, `negativePrompt`, `reference_mode`

## 搜索策略（避免重复搜索）

定义一个搜索策略 `search_policy`，默认 **`llm_only`**：

- `llm_only`（默认）：LLM 搜索一次，图像模型 `useGrounding=false`。
- `image_only`：LLM 不搜索，图像模型 `useGrounding=true`（仅 Pro）。
- `both`：仅在用户明确要求“搜索+验证”时使用。

### llm_only 的结构化事实输出

当采用 `llm_only` 时，LLM 必须输出“结构化事实块”，再嵌入到最终 prompt：

```
[FACTS]
- item: "实时事实A"
  source: "URL or title"
- item: "实时事实B"
  source: "URL or title"
[/FACTS]
```

最终 prompt 必须包含该事实块或其等价改写，确保信息可追溯且不丢失。

## 模型选择规则（Auto）

优先级从高到低：

1. 用户锁定模型 → 强制使用该模型。
2. 需要搜索且 `search_policy=image_only` → 强制 Pro + `useGrounding=true`。
3. 需要搜索且 `search_policy=llm_only` → 可用 Flash 或 Pro，但 `useGrounding=false`。
4. 用户明确“高质量/Pro” → Pro。
5. 默认 Flash。

## 参考图与多轮编辑

- 参考图由同一对话上下文管理，不分离到独立 Image Chat。
- AI 使用 `reference_mode` 决定引用方式：
  - `USER_UPLOADED_ONLY`：重新生成或“不满意”时。
  - `LAST_GENERATED`：修改上一张图。
  - `ALL_USER_UPLOADED` / `LAST_N`：批量参考。
- 对图像模型多轮编辑必须携带 `thoughtSignature`。

## 参数契约（禁止缺省）

LLM 在生成阶段必须输出完整参数，不能仅输出 prompt：

```
generate_image({
  prompt,
  model,
  aspectRatio,
  resolution,
  useGrounding,
  numberOfImages,
  negativePrompt,
  reference_mode,
  reference_count
})
```

如缺参，由“参数解析层”进行补全，但不得覆盖用户锁定值。

## 场景示例

### 场景 1：Auto + 搜索需要外部信息
1) LLM 搜索 → 整理 prompt  
2) 生成阶段输出完整参数  
3) 视策略决定 `useGrounding`

### 场景 2：Auto + 搜索开启但不需要搜索
1) 跳过搜索  
2) 直接生成

### 场景 3：用户锁定 Flash + 搜索开启
1) 允许 LLM 搜索（仅补充 prompt）  
2) 生成阶段强制 Flash，`useGrounding=false`

### 场景 4：用户锁定 Pro + 搜索开启
1) 视需求选择搜索  
2) 若 `image_only` 策略则 `useGrounding=true`

## 实现步骤（落地指南）

1. 统一对话上下文结构  
   - 将文本消息、参考图、生成图、thoughtSignature 都写入同一 `chatHistory`。  
   - 不再区分 Text Chat / Image Chat 的历史来源。  

2. 分离“搜索阶段”和“生成阶段”  
   - 搜索阶段：只允许 `googleSearch`，不允许 function calling。  
   - 生成阶段：只允许 `generate_image`，不允许 `googleSearch`。  

3. 定义清晰的参数契约  
   - `generate_image` 必须包含：`prompt, model, aspectRatio, resolution, useGrounding, numberOfImages`。  
   - `reference_mode/reference_count` 明确参考图策略。  

4. 明确搜索策略  
   - `llm_only` 为默认策略。  
   - `image_only` 用于“让图像模型自行查证”的场景。  
   - `both` 仅在用户明确要求时启用。  

5. 参数解析与补全  
   - 先尊重用户锁定参数，再补齐 AI 缺省字段。  
   - 禁止默认覆盖用户选择的图像模型。  

6. 多轮编辑稳定性  
   - 将图像模型返回的 `thoughtSignature` 与图像 part 绑定保存。  
   - 下一轮图像生成必须回传签名。  

## 伪代码（核心路径）

```ts
// 输入：用户消息、当前设置
async function handleChatTurn(userMsg, uiState, chatHistory) {
  const { allowSearch, searchPolicy, textModel, imageModelLock } = uiState;

  // 1) LLM 决策
  const intent = await llmAnalyze(userMsg, chatHistory, textModel);

  // 2) 是否需要搜索
  const needSearch = allowSearch && intent.requiresExternalInfo === true;
  let searchResult = null;

  if (needSearch && searchPolicy !== 'image_only') {
    searchResult = await runSearchOnlyLLM({
      history: chatHistory,
      userMsg,
      textModel,
      tools: ['googleSearch']
    });
  }

  // 3) 生成阶段：LLM 输出完整参数
  const toolArgs = await runGenerateToolLLM({
    history: chatHistory,
    userMsg,
    textModel,
    tools: ['generate_image'],
    searchResult
  });

  // 4) 参数解析与补全
  const params = normalizeGenerateArgs({
    toolArgs,
    uiState,
    searchPolicy
  });

  // 5) 图像模型执行
  const image = await generateImageWithModel(params);

  // 6) 写回上下文（含 thoughtSignature）
  chatHistory.push(buildImageResponseMessage(image));
}

function normalizeGenerateArgs({ toolArgs, uiState, searchPolicy }) {
  const normalized = { ...toolArgs };

  // 用户锁定模型优先
  if (uiState.imageModelLock) {
    normalized.model = uiState.imageModelLock;
  }

  // 搜索策略决定 grounding
  if (searchPolicy === 'image_only' && normalized.model === 'gemini-3-pro-image-preview') {
    normalized.useGrounding = true;
  } else {
    normalized.useGrounding = false;
  }

  // 缺省补齐
  normalized.aspectRatio ||= '16:9';
  normalized.numberOfImages ||= 1;
  normalized.resolution ||= normalized.model === 'gemini-3-pro-image-preview' ? '1K' : '1K';

  return normalized;
}
```

## 伪代码（结构化事实解析与拼接）

```ts
function buildPromptWithFacts(rawPrompt, factsBlock) {
  if (!factsBlock || factsBlock.length === 0) return rawPrompt.trim();

  const factsText = factsBlock.map((fact, idx) => {
    const source = fact.source ? ` (source: ${fact.source})` : '';
    return `- ${idx + 1}. ${fact.item}${source}`;
  }).join('\n');

  return [
    rawPrompt.trim(),
    '',
    '[FACTS]',
    factsText,
    '[/FACTS]'
  ].join('\n');
}

// 示例: 解析 LLM 搜索输出
function parseFactsFromLLM(llmOutput) {
  // 假设 LLM 输出 JSON: { facts: [{ item, source }], promptDraft: "..." }
  const data = safeJsonParse(llmOutput);
  const facts = Array.isArray(data?.facts) ? data.facts : [];
  const promptDraft = typeof data?.promptDraft === 'string' ? data.promptDraft : '';
  return { facts, promptDraft };
}

// 生成阶段调用
const { facts, promptDraft } = parseFactsFromLLM(searchResult);
const finalPrompt = buildPromptWithFacts(promptDraft || userPrompt, facts);
```

## 失败与降级策略

- 禁止文本 fallback 触发生成。
- 如搜索阶段输出不可解析结构，提示用户重试并保留对话上下文。
- 如图像模型返回 400（thoughtSignature 缺失），提示用户重试并重新发送历史。

## 权衡与约束

- 两段式流程增加一次 LLM 调用，搜索场景会有额外延迟。
- `llm_only` 依赖 LLM 摘要，可能丢失细节；必须输出结构化事实并嵌入 prompt。
- 图像模型与文本模型是不同 SDK session，统一的是 `chatHistory` 数据结构。
- 多轮编辑需要保存并回传 `thoughtSignature`，否则会触发 400 错误。

## 与代码的映射（建议）

- 对话层：`services/geminiService.ts -> streamChatResponse`
- 生成层：`services/geminiService.ts -> generateImage`
- 参数层：`App.tsx -> handleAgentToolCall`
- UI：`components/ChatInterface.tsx`

## 官方文档参考

- Gemini 3 JS: https://ai.google.dev/gemini-api/docs/gemini-3?hl=zh-cn#javascript
- Image Generation: https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn
- Thought Signatures: https://ai.google.dev/gemini-api/docs/thought-signatures?hl=zh-cn

# Lumina Studio AI 助手架构升级方案：基于动态 Skill 注入的设计报告

## 1. 背景与痛点分析

当前 `lumina-studio` 项目的核心 AI 逻辑集中在 `services/geminiService.ts`。随着业务的迭代，该文件暴露出了典型的“提示词硬编码（Prompt Hard-coding）”问题。

### 1.1 核心痛点
1. **代码与 Prompt 严重耦合**：长达几百行的 System Instruction 和各类生成模式规则混杂在 TypeScript 代码中（例如行 351-403，655-723）。修改任何提示法（Prompt）都需要调整和重新编译核心业务逻辑。
2. **“填鸭式”上下文导致效果衰减（Context Degradation）**：无论用户是进行简单的问答还是复杂的图像生成，当前架构都会将所有（如 `CREATE_NEW`、`PRODUCT_SHOT`、`STYLE_TRANSFER`）的指导原则一次性塞给大模型。这不仅浪费 Token，更导致模型注意力分散，难以精准遵循当前特定任务的指令。
3. **扩展性极差**：想要新增一种生成模式（如新增视频动效专家模式），需要在巨型 `systemInstruction` 字符串中继续堆砌 `if-else` 分支，长此以往代码将变成一座无法维护的迷宫。

## 2. 目标方案：基于 Skill 的动态上下文注入架构

参考行业最佳实践（如 [Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) ），我们建议将原有的巨型单体 Prompt 架构，重构为**基于上下文路由的“Agent 应用商店”模式**。

### 2.1 核心理念
- **运行时动态知识注入 (Dynamic Injection)**：大模型出厂不仅依赖 System Prompt，更依赖一个动态的 Markdown“技能库”。针对每次请求，只挂载最对症的“技能说明书”。
- **标准化执行协议 (Execution Protocol)**：将复杂参数生成、JSONL存取或多图组合流，通过独立的 Skill 文件以类似于 SOP（标准作业程序）的形式约束模型。

## 3. 架构设计与重构步骤

本次重构无需改变项目所使用的前端框架或 Gemini API 结构，核心是添加一层 **Prompt Router（提示词路由层）** 和一个 **Skill Library（技能库）**。

### 3.1 目录结构规划

首先在项目中剥离提示词，建立独立的技能文本库：

```text
lumina-studio/
├── docs/
│   └── agent-architecture-upgrade.md     // 本方案文档
├── public/skills/                        // (或者放在前端/后端的配置目录) Agent 技能库
│   ├── _core-identity.md                 // 核心人设（所有请求必备，非常简短）
│   ├── mode-product-shot.md              // 产品摄影优化技能
│   ├── mode-style-transfer.md            // 风格迁移技能
│   ├── protocol-image-generation.md      // 调用生成图像 Tool 的强制协议
│   └── helper-context-optimization.md    // 当用户提示词极其模糊时的追问技巧
└── services/
    ├── promptRouter.ts                   // [新增] 负责分析意图并动态读取组装 Markdown
    └── geminiService.ts                  // [瘦身] 彻底移除长文本，只保留 API 发送逻辑
```

### 3.2 模块职责拆分

#### A. 核心身份设定（Base System Instruction）
抽离出 `_core-identity.md` 文件。无论何时，大模型只需要知道：
> "你是 AI Vision Studio 的专业 AI 创意助手（Creative Assistant）。你的唯一目标是协助用户完成图像和视频的创意生成和沟通。"

#### B. 动态意图识别与路由 (Prompt Router)
在接到用户输入 `prompt` 和当前 `mode`（如 AppMode.VIDEO / AppMode.IMAGE）时，执行轻量级判断：

1. **强规则匹配**：如果传入了 `assistant_mode`（如 `PRODUCT_SHOT`），路由器直接去文件系统或数据库拉取 `mode-product-shot.md` 和 `protocol-image-generation.md`。
2. **弱规则匹配（可选进阶）**：如果用户意图模糊，可以在主 LLM 处理前，过一遍小模型或规则引擎：“当前任务需要挂载哪些技能？”

#### C. 上下文按需组装 (Context Assembly)
`geminiService.ts` 拿到 Router 返回的 Markdown 文本数组后，简单拼装：
```typescript
const systemInstruction = `
${coreIdentityText}

[当前激活的执行协议 (Active Skills)]
${activeSkillTexts.join('\n\n')}

[历史对话上下文]
${contextSummary}
`;
```

## 4. 实施阶段（Milestones）

建议分 3 步平滑过渡：

**Phase 1: 物理剥离（解耦期）**
- 不做动态路由。直接将 `geminiService.ts` 里的两段大 Prompt（`optimizePrompt` 和 `streamChatResponse` 中的配置）复制出来，保存为 `/skills/` 目录下的 Markdown 或 JSON 配置文件。
- TypeScript 代码改为 `import` 或 `fs.readFileSync`（后端的话）读取这些文件内容。
- **收益**：提示词修改者无需再动 TS 代码，实现初步解耦。

**Phase 2: 领域拆分（瘦身期）**
- 把庞大的多用途说明书，拆解成垂直领域的 Skill。
- 例如：将“如何处理参考图”单独剥离成 `skill-reference-handling.md`；将“[PARAMETER CONTRACT]”剥离成 `skill-tool-calling-guard.md`。
- **收益**：提示词具备了复用性和局部测试能力。

**Phase 3: 动态路由与注入（应用商店形态）**
- 实现 `promptRouter.ts`。
- 完全废除全量挂载。根据 `params.assistant_mode` 和用户聊天历史，每次仅拼装 1 到 2 个最相关的 Skill 送给 Gemini API。
- **收益**：Token 消耗显著下降，模型指令遵循度（Instruction Adherence）大幅飙升，彻底解决“顾此失彼”的问题。

## 5. 极简落地优化方案 (Fast Implementation)

基于前端/全栈开发的实际工程体验，如果是追求快速落地且不想处理复杂的文件系统（fs）异步读取逻辑，我们可以引入**“极简落地优化方案”**，作为 Phase 1 的替代或补充。

### 5.1 Object Mapping (配置对象) 代替物理文件
不要直接创建 `.md` 文件，而是使用 TypeScript 的配置对象统一管理，享受 TS 类型检查和打包器的静态优化：

```typescript
// services/skillRegistry.ts
export const SKILLS = {
  CORE: "你是 Lumina Studio 创意助手...",
  PRODUCT_SHOT: "## 产品摄影技能\n- 优先使用三点布光描述\n- 强调材质纹理...",
  STYLE_TRANSFER: "## 风格迁移技能\n- 提取参考图色调...",
  CONTEXT_CLEANUP: "## 上下文清理协议\n- 忽略 3 轮之前的无关细节..."
};
```

### 5.2 隐性逻辑锚点 (Anchoring / Triggers)
放弃复杂的 if-else 或昂贵的意图识别模型，引入极其轻量级的**关键词数组触发**机制：

```typescript
const SKILL_TRIGGERS = {
  PRODUCT_SHOT: ['产品', '白底', '电商', '拍个图'],
  STYLE_TRANSFER: ['风格', '像这张', '变一下', '参照原图']
};

// 伪代码路由：
const activeSkills = [SKILLS.CORE];
Object.entries(SKILL_TRIGGERS).forEach(([key, triggers]) => {
  if (triggers.some(t => userMessage.includes(t))) {
    activeSkills.push(SKILLS[key as keyof typeof SKILLS]);
  }
});
```
这种隐式路由能极大降低耦合，同时让 Agent 显得“自主而聪明”。

### 5.3 “代码即提示词” (Code as Prompt)
针对需要结构化输出的场景（例如调用生成参数工具），**直接喂给模型 TypeScript Interface / Zod Schema，而不是口语化的规则解释**。模型天生具有代码敏感度。

```markdown
### Image Schema Protocol
当调用生成工具时，必须严格符合以下结构：
interface ImageParams {
  prompt: string; // 必须包含光影描述
  aspect_ratio: "16:9" | "1:1";
  negative_prompt?: string;
}
```

### 5.4 破冰实验：“影子技能” (Shadow Skill)
在全面重构前，**只需要做一件事**：从现有的 `systemInstruction` 中剥离出“[当提示词过于模糊时的追问技巧]”这一小块。
- **触发条件**：`if (prompt.length < 10) activeSkills.push(SKILLS.CONTEXT_OPTIMIZATION)`
- **验证目的**：直接感受“只有吃得少（按需加载），才能画得好（指令遵循度高）”的惊艳效果。

## 6. 核心落地细节补充 (Based on Code Review)

基于对当前 `geminiService.ts` 源码的深入 Review，原方案在逻辑上完全自洽，但在落地时必须补充以下具体执行层面的细节，才能无缝融入现有的前端架构。

### 6.1 必须提取的 3 处分散 Prompt
当前的 Prompt 并不是集中在 `systemInstruction` 这一处，在重构（Phase 1 和 2）时，必须同时清剿以下 3 个隐藏的硬编码点：
1. **`streamChatResponse`** (主要聊天引擎)：包含工作流、生成规则、以及 `searchInstruction`（搜索上下文提示）。
2. **`optimizePrompt`** (功能型 API)：包含分视频 (`isVideo`) 和图片 (`isImage`) 两种庞大的预处理和优化规则说明。
3. **`getRoleInstruction`** (资源处理)：虽然代码未完全展露，但目前必定存在用于解释“上传的图片扮演什么角色”的硬编码字符串（如 Mask, Base Image 等）。

### 6.2 现有系统状态的巧妙复用
我们不需要从零实现所有的 Trigger（触发器），可以完美复用现有的业务逻辑：
你的项目里已经存在了 `AssistantMode` 枚举（比如 `CREATE_NEW`, `PRODUCT_SHOT`, `STYLE_TRANSFER` 等）和 `getPlaybookDefaults` 函数。

**建议的 Skill 结构深度融合设计：**

```typescript
// services/skills/index.ts
import { AssistantMode } from '../types'; // 引入现有枚举

export const SKILLS = {
  // 1. 核心人设 (Base Identity) - 始终加载
  CORE_IDENTITY: `你是 AI Vision Studio 的专业 AI 创意助手...`,

  // 2. 模式 Skill (Mode-Specific) - 根据现有的 AssistantMode 动态加载
  [AssistantMode.PRODUCT_SHOT]: {
    triggers: ['产品', '白底', '电商', '拍个图'], // 作为 UI 强刷之外的备用触发
    content: `## 产品摄影技能...`
  },
  [AssistantMode.STYLE_TRANSFER]: {
    triggers: ['风格', '参考', '转绘'],
    content: `## 风格迁移协议...`
  },

  // 3. 全局工具协议 (Tool Protocol) - 在调用 generate_image 时强制附加
  PROTOCOL_IMAGE_GEN: `[PARAMETER CONTRACT]\nYou MUST call 'generate_image' with...`
};
```

### 6.3 最佳的注入时机 (Injection Point)
路由分发的逻辑必须插入在 `streamChatResponse` 内部组装 `systemInstruction` 的**最前置阶段**。

**伪代码示例：**
```typescript
// 在 streamChatResponse 中
export const streamChatResponse = async (
    history: ChatMessage[],
    newMessage: string, // 用于关键词 trigger 匹配
    mode: AppMode,
    assistantMode: AssistantMode, // 从 getPlaybookDefaults 或 UI 传入
    /* ... */
) => {
    // 1. 获取核心系统提示词
    const activeSkills = [SKILLS.CORE_IDENTITY];

    // 2. 基于现有架构强挂载模式特定技能
    if (SKILLS[assistantMode]) {
       activeSkills.push(SKILLS[assistantMode].content);
    } 
    // 3. [可选] 基于用户的 newMessage 隐蔽触发未被 UI 选中的额外技能
    
    // 4. 判断是否需要工具协议
    if (isImageMode) activeSkills.push(SKILLS.PROTOCOL_IMAGE_GEN);

    const injectedSystemInstruction = activeSkills.join('\n\n');
    
    // ... 后续逻辑使用 injectedSystemInstruction
}
```

## 7. 方案实施后的预期收益与产品感知变化 (Expected ROI & UX Impact)

将“庞大硬编码 Prompt”变为“按需动态挂载 Skill”后，不仅是底层工程师的开发体验变好，**核心产品指标和用户体验也会发生可感知的质变。**

### 7.1 产品使用上的直观感知变化 (UX Improvements)

1. **“Agent 好像突然变专心了！” (指令遵循度暴增)**
   - **痛点现状**：之前无论用户说什么，系统都给大模型长达大几百字的全量规则。大模型可能会因为注意力（Attention Window）被“产品摄影”、“工具调用规范”等无关信息占满，而**忽视了**用户在当前轮次里提出的“帮我把衣服颜色改成红色”这种具体指令。
   - **升级体验**：Agent 变得极其“听话”。因为它脑子里只有 `CORE_IDENTITY` 和当前激活的 `SKILL`。杂念清空后，对复杂长句或者极端细节的还原率（Instruction Adherence）会显著提高。

2. **“追问变得更聪明、更专业了！” (动态沟通策略)**
   - **痛点现状**：遇到简单模糊的指令（如“画个赛博朋克”）时，现有的粗放型 System Prompt 很难控制追问的尺度和专业度，导致一搜集素材时常常“泛泛而谈”。
   - **升级体验**：如果在特定流程（比如 `PRODUCT_SHOT` 或是弱提示词时）挂载了类似 `CONTEXT_OPTIMIZATION` 的 Skill。Agent 接收到模糊指令时，会基于极具专业素养的摄影/构图知识，反向询问用户（例如：“好的，为了让产品海报更有质感，您希望是硬光产生的锐利阴影，还是柔光箱效果？”），让 AI 助手真正像一个“专业美术指导”。

3. **“生成响应速度变快了！” (首字响应时间 TTFT 降低)**
   - **痛点现状**：每次请求都带上巨大的硬编码 Prompt（甚至包含搜索的几百字前置规则），几千个 Token 会增加 API 的耗时，还会加大遇到 Context Window 限制或限流（Rate Limit）的风险。
   - **升级体验**：Prompt 减肥（按需挂载）后，输入给大模型的 Prompt Token 数可能下降 30%-60%，API 响应速度（尤其是首字节返回时间 Time-To-First-Token）会产生可感知的加快。

### 7.2 技术与研发侧的预期收益 (Technical ROI)

1. **零成本热更新 (Prompt engineering as Data)**
   - 以前产品经理/美术/提示词工程师调出一个极佳的生成提示词，需要：提 PR -> 前端工程师改 `.ts` 文件 -> 重新编译打包项目。
   - 现在：直接修改 `skills/` 下的配置字典或 Markdown。改完刷新页面即刻生效。甚至未来可以为高级用户开放“自定义 Skill（Custom Prompt Plugins）”的接口。

2. **架构的高可扩展性与健壮性 (Highly Extensible Architecture)**
   - 新增视频生成能力 (Veo) 或文本分析功能？现有的 `geminiService.ts` 主干逻辑（流解析、工具调用、并发处理）**一行都不需要改**。只要在 `SKILLS` 注册表里加一个配置项即可。这正是企业级大语言模型系统对抗复杂度的最终解法。

---

## 8. 实施状态 (Implementation Status)

### ✅ 已完成 (Phase 1 & Phase 2)

| 阶段 | 任务 | 状态 |
|------|------|------|
| Phase 1 | 创建 Skill 类型定义 | ✅ `services/skills/types.ts` |
| Phase 1 | 创建 Skill 注册表 | ✅ `services/skills/index.ts` |
| Phase 1 | 提取 optimizePrompt 内容 | ✅ 已迁移到 SKILLS |
| Phase 1 | 提取 streamChatResponse 内容 | ✅ 已迁移到 SKILLS |
| Phase 1 | 提取 getRoleInstruction 内容 | ✅ 已迁移到 SKILLS |
| Phase 2 | 实现 Prompt Router | ✅ `services/skills/promptRouter.ts` |
| Phase 2 | 领域拆分 (按功能分类) | ✅ 11个独立Skill |
| Phase 2 | 关键词触发机制 | ✅ CONTEXT_OPTIMIZATION |
| - | 集成到 geminiService | ✅ 已完成 |
| - | 构建验证 | ✅ 通过 |

### 📋 创建的文件

```
services/skills/
├── types.ts           # Skill 类型定义
├── index.ts           # Skill 注册表 (11个技能)
└── promptRouter.ts    # 动态路由核心
```

### 🔄 修改的文件

- `services/geminiService.ts` - 集成 Skill 系统

### ✅ Phase 3 完成 (动态路由)

- 实现真正的按需加载 - `buildSystemInstruction` 函数
- 基于 assistant_mode 动态加载模式特定 Skill
- 基于关键词触发额外 Skill (限制最多2个)
- 按优先级排序技能

### 📋 新增的模式特定 Skill

| Skill ID | 触发条件 | 内容 |
|----------|----------|------|
| MODE_PRODUCT_SHOT | PRODUCT_SHOT 模式 | 产品摄影协议 |
| MODE_STYLE_TRANSFER | STYLE_TRANSFER 模式 | 风格迁移协议 |
| MODE_POSTER | POSTER 模式 | 海报设计协议 |
| MODE_EDIT_LAST | EDIT_LAST 模式 | 编辑上一张协议 |
| MODE_COMBINE_REFS | COMBINE_REFS 模式 | 合并参考协议 |
| SKILL_SEARCH | 搜索关键词 | 搜索与研究协议 |
| SKILL_CLARIFICATION | 模糊请求 | 澄清确认协议 |

### 🚧 待优化

- 添加 Skill 运行时调试/监控
- 性能测试与 Token 优化验证

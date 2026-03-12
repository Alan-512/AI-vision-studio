<div align="center">

# AI Vision Studio

[English](README.md) | **[中文](README_zh.md)**

一个浏览器优先的 AI 图像与视频创作工作室，基于 **Google Gemini** 和 **Veo** 构建。  
它把参数化的 Studio 工作区和对话式 AI 助手结合在一起，支持多轮生成、评审、修订和继续执行同一个图像任务。

</div>

## 项目简介

AI Vision Studio 适合既想要手动控制参数、又希望获得 agent 辅助创作体验的用户。你可以在 Studio 面板里精细设置参数，也可以直接在聊天中描述需求，让助手去编排图片生成、参考图复用、联网检索、本地记忆和多步骤修订流程。

这个仓库默认是前端优先、BYOK 的形态：API Key 保留在浏览器本地，项目历史保留在本地，不依赖专门的应用后端。如果部署环境需要代理能力，仓库中也内置了 `/api/*` 的 Cloudflare Pages Function。

## 功能特性

### 高级图像生成

- **Gemini 3.1 驱动**：支持 `gemini-3.1-flash-image-preview`（Nano Banana 2）和 `gemini-3-pro-image-preview`（Nano Banana Pro）。
- **专业级控制**：可精细调节宽高比（包括 1:4、1:8 等）、风格、分辨率（0.5K、1K、2K、4K）和负向提示词。
- **智能素材**：支持最多 14 张参考图（NB2），用于控制**角色一致性**、**结构/姿态/布局**和**风格氛围**。
- **Grounding**：内置 Google Search grounding，用于更准确地生成符合真实世界信息的画面（NB2）。

### 视频创作

- **Veo 模型集成**：使用 Google 最新的 `Veo` 模型（`veo-3.1`）生成高质量视频。
- **视频延长**：上传已有视频并进行无缝延长（720p）。
- **关键帧与参考控制**：使用图片引导起始/结束帧，或锁定视频中的角色一致性。

### 深度 Agent 助手

- **思考过程**：由 **Gemini 3.1 Pro**（`gemini-3.1-pro-preview`）驱动。AI 助手不只是回复，而是会思考、规划并执行复杂工作流。
- **自主控制**：Agent 可以根据自然语言请求，自主控制工作室界面、切换模型参数并发起生成。
- **智能选择**：具备自动模型选择逻辑，尽量为当前提示词选择更合适的输出路径。

### 编辑与局部重绘

- **画布编辑器**：集成蒙版与局部重绘编辑能力。
- **区域编辑**：可针对指定区域添加指令（例如“把这件衬衫变成红色”），同时保持其余部分不变。

### 隐私与 BYOK

- **自带密钥**：API Key 安全保存在浏览器本地存储中。
- **无中间人**：请求直接从浏览器发送到 Google 服务器，我们不会存储或查看你的密钥。

## 技术栈

- React 18 + TypeScript
- Vite
- 通过 [index.html](index.html) CDN 注入的 Tailwind CSS + 自定义样式
- `@google/genai`
- IndexedDB / 本地持久化服务
- Vitest + jsdom

## 快速开始

### 环境要求

- Node.js 18+
- Google AI Studio API Key

### 安装与启动

```bash
npm install
npm run dev
```

然后打开 `http://localhost:5173`，在应用设置中填入 API Key。

## 校验命令

```bash
npm run test:run
npm run build
```

## 部署方式

### 静态前端部署

大多数情况下，这个项目可以直接作为静态前端部署。

- 构建命令：`npm run build`
- 输出目录：`dist`

### Cloudflare Pages + 可选代理

仓库内置了 Cloudflare Pages Function，文件位于 [functions/api/[[catchall]].ts](functions/api/[[catchall]].ts)，可将 `/api/*` 请求代理到 Gemini 接口。

适合以下场景：

- 希望浏览器请求先走边缘代理
- 直连不稳定，希望增加一层代理路径
- 仍然保持前端优先的部署模型

项目也支持可选的 Deno 代理配置，用于更长时间的请求。

## 目录结构

```text
components/   React 界面组件
contexts/     共享上下文
functions/    Cloudflare Pages Functions
openspec/     架构变更与实施规范
services/     Gemini、agent、memory、storage、runtime 逻辑
tests/        Vitest 测试
docs/         架构文档
```

## 文档

长文档架构说明位于 [docs/architecture](docs/architecture)：

- `agent-architecture-upgrade.md`
- `image-generation-architecture.md`
- `long-term-memory-system-v1.md`
- `mask-editing-workflow.md`
- `playbook-agent-mode.md`

结构化的变更提案和实施记录位于 [openspec/](openspec/)。

## 许可证

MIT，详见 [LICENSE](LICENSE)。

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

- **基于 Gemini 的图像工作流**：使用 Google 最新支持图像能力的 Gemini 模型进行生成与编辑。
- **专业级控制项**：可在 Studio 界面中调整宽高比、质量、负向提示词以及任务相关参数。
- **参考图驱动生成**：复用上传参考图、历史输出和工件记录，尽量保持主体、结构和风格连续性。
- **搜索辅助提示**：当任务涉及品牌、产品或客观事实时，可引入搜索结果辅助生成。

### 视频创作

- **基于 Veo 的视频生成**：从文本和视觉条件出发生成视频内容。
- **续写工作流**：当任务需要延长已有视频时可继续生成。
- **参考驱动任务**：使用图片和历史输出引导视频方向与一致性。

### 深度 Agent 助手

- **对话优先编排**：直接用自然语言描述需求，让助手规划并触发合适的工作流。
- **多步骤图像 runtime**：助手会执行 `review -> revise -> requires_action`，而不是把图像生成当成一次性调用。
- **可继续当前任务**：当任务需要用户介入时，可以暂停后继续同一个图像 job，而不是从头开始。
- **以 artifact 为核心的上下文**：参考图、搜索结果和生成结果作为 runtime artifact 管理，而不只是保存在聊天记录里。

### 编辑与局部重绘

- **画布式编辑**：可直接在应用内进行图像编辑和蒙版更新流程。
- **局部修改**：只改特定区域，同时尽量保留其余构图和内容。
- **蒙版工作流**：基础图、蒙版和编辑指令在流程中分离处理。

### 记忆与上下文

- **滚动短期上下文**：最近几轮保持明确，较早对话压缩为摘要。
- **本地优先记忆**：长期偏好和项目上下文默认保存在本地，无需后端记忆服务。
- **按需检索记忆**：在需要时将记忆检索到同一轮推理中，而不是每次都固定注入大段提示词。

### 隐私与 BYOK

- **自带密钥**：API Key 仅存放在浏览器本地。
- **本地项目持久化**：项目、素材和记忆默认本地保存。
- **无需专门应用后端**：默认使用方式不依赖独立服务器。

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

# AI Vision Studio

一个浏览器优先的 AI 图像与视频创作工作室，基于 React、Vite、Google Gemini 和 Veo 构建。它把参数化的 Studio 工作区和对话式 AI 助手结合在一起，支持多轮生成、参考图复用、本地项目历史，以及多步骤图像任务流。

## 核心能力

- 基于 Gemini 图像模型的图片生成与编辑
- 基于 Veo 的视频生成与续写
- 对话式图像 agent runtime，支持 `review -> revise -> requires_action`
- 面向参考图和工件的图片任务流
- 本地优先的记忆与上下文管理
- BYOK 模式，API Key 仅保存在浏览器本地
- 可选的 Cloudflare Pages Function `/api/*` 代理

## 技术栈

- React 18 + TypeScript
- Vite
- 通过 [index.html](index.html) CDN 注入的 Tailwind CSS + 自定义样式
- `@google/genai`
- IndexedDB / 本地持久化服务
- Vitest + jsdom

## 本地启动

### 环境要求

- Node.js 18+
- Google AI Studio API Key

### 运行方式

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，然后在设置中填入 API Key。

## 校验命令

```bash
npm run test:run
npm run build
```

## 部署方式

### 静态前端部署

项目可以直接作为静态前端部署，这也是默认方式。

- 构建命令：`npm run build`
- 输出目录：`dist`

### Cloudflare Pages + 可选代理

仓库内置了 Cloudflare Pages Function，文件在 [functions/api/[[catchall]].ts](functions/api/[[catchall]].ts)，可将 `/api/*` 请求代理到 Gemini 接口。

适合以下场景：

- 需要前端请求走边缘代理
- 直连不稳定，希望增加一层代理
- 仍然保持前端为主的部署方式

项目也支持可选的 Deno 代理配置，用于更长时间的请求。

## 目录结构

```text
components/   React 界面组件
contexts/     共享上下文
functions/    Cloudflare Pages Functions
openspec/     架构变更与规范
services/     Gemini、agent、memory、storage、runtime 逻辑
tests/        Vitest 测试
docs/         架构文档
```

## 架构文档

主要文档已整理到 [docs/architecture](docs/architecture)：

- `agent-architecture-upgrade.md`
- `image-generation-architecture.md`
- `long-term-memory-system-v1.md`
- `mask-editing-workflow.md`
- `playbook-agent-mode.md`

架构变更提案和实施记录在 [openspec/](openspec/)。

## 许可证

MIT，详见 [LICENSE](LICENSE)。

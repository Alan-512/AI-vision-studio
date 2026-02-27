<div align="center">

# AI Vision Studio (影像创意工坊)

[English](README.md) | **[中文](README_zh.md)**

基于 **Google Gemini 3.1** (Flash/Pro) 和 **Veo** 模型的新一代 AI 视觉创作工作室。  
专业的 Agent 工作流，让你轻松**创建、编辑和动画化**内容。

[在线演示 (即将推出)] • [报告问题] • [功能建议]

</div>

## ✨ 功能特点

### 🎨 高级图像生成
- **Gemini 3.1 驱动**：全面支持 `gemini-3.1-flash-image-preview` (Nano Banana 2) 和 `gemini-3-pro-image-preview` (Nano Banana Pro)
- **专业级控制**：精细调节宽高比（新增 1:4, 1:8 等超宽比例）、风格、分辨率（0.5K, 1K, 2K, 4K）和负向提示词
- **智能素材**：最高支持 14 张参考图 (NB2)，独立控制**角色一致性**、**构图结构**和**风格氛围**
- **连网搜图**：内置 Google Search grounding，确保生成内容符合客观事实 (NB2)

### 🎥 电影级视频创作
- **Veo 模型集成**：使用 Google 最新的 `Veo` 模型 (`veo-3.1`) 生成高质量视频
- **视频延长**：上传现有视频并无缝延长（720p）
- **关键帧与参考控制**：使用图片引导起始/结束帧，或锁定视频中的角色一致性

### 🤖 深度 AI 助手
- **思考过程可视化**：由最新的 **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) 驱动。其不仅仅是回复，还会自发执行*思考*、规划并处理复杂工作流
- **自主控制**：Agent 可以自动控制工作室界面，根据自然语言请求更改模型、参数并发起生成
- **智能回落**：自动化的模型选择逻辑，确保您的指令始终由最合适的引擎执行

### 🖌️ 编辑器与局部重绘
- **画布编辑器**：集成的遮罩和局部重绘编辑器
- **区域编辑**：定义特定区域并给出指令（如"把这件衬衫变成红色"），同时保持图像其余部分不变

### 🛡️ 隐私与安全 (BYOK)
- **自带密钥**：您的 API Key 安全存储在浏览器的**本地存储**中
- **无中间人**：请求直接从您的浏览器发送到 Google 服务器，我们不会存储或查看您的密钥

## 🛠️ 技术栈

- **前端**：React 18、TypeScript、Vite
- **样式**：Tailwind CSS
- **AI SDK**：Google GenAI SDK (`@google/genai`)
- **图标**：Lucide React

## 🚀 快速开始

### 前置要求
- Node.js (推荐 v18 或更高版本)
- Google AI Studio API Key ([在这里获取](https://aistudio.google.com/app/apikey))

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/Alan-512/AI-vision-studio.git
   cd AI-vision-studio
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **本地运行**
   ```bash
   npm run dev
   ```

4. **打开浏览器**
   访问 `http://localhost:5173` 开始创作！

### 配置
首次启动时，点击**设置**（齿轮图标）或按照提示输入您的 **Google AI Studio API Key**。

## 📦 部署

AI Vision Studio 支持 **Cloudflare Pages** 一键部署。

1. 将仓库连接到 Cloudflare Pages
2. 设置构建命令：`npm run build`
3. 设置输出目录：`dist`
4. **部署成功！**（BYOK 模式无需服务器端环境变量）

## 📄 许可证

本项目基于 MIT 许可证开源 - 详见 [LICENSE](LICENSE) 文件。

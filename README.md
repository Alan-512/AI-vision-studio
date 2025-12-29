<div align="center">

# AI Vision Studio

**[English](README.md)** | [中文](README_zh.md)

A next-generation AI Vision Studio powered by **Google Gemini 3** (Flash/Pro) and **Veo** models.  
**Create, Edit, and Animate** with a professional, agentic workflow.

[Online Demo (Coming Soon)] • [Report Bug] • [Request Feature]

</div>

## ✨ Features

### 🎨 Advanced Image Generation
- **Powered by Gemini Models**: Support for `gemini-2.5-flash-image` (Nano Banana) and `gemini-3-pro-image-preview` (Nano Banana Pro).
- **Pro-Level Controls**: Fine-tune Aspect Ratio, Style, Resolution (up to 4K), and Negative Prompts.
- **Smart Assets**: Upload reference images to control **Identity (Character)**, **Structure (Pose/Layout)**, and **Style (Vibe)** independently.

### 🎥 Cinematic Video Creation
- **Veo Model Integration**: Generate high-quality videos using Google's latest `Veo` model (`veo-3.1`).
- **Video Extension**: Upload existing videos and extend them seamlessly (720p).
- **Keyframe & Reference Control**: Use images to guide the start/end frames or lock character consistency in videos.

### 🤖 Deep Agent Assistant
- **Thinking Process**: The AI Assistant doesn't just reply; it *thinks*, plans, and executes complex workflows.
- **Autonomous Control**: The Agent can autonomously control the studio interface, changing models, parameters, and initiating generation based on natural language requests.
- **Refinement**: Ask the agent to "Make it more cinematic" or "Fix the hands," and it will adjust prompts and settings for you.

### 🖌️ Editor & Inpainting
- **Canvas Editor**: Integrated editor for masking and inpainting.
- **Region-Based Editing**: Define specific regions with instructions (e.g., "Make this shirt red") while keeping the rest of the image intact.

### 🛡️ Privacy & Security (BYOK)
- **Bring Your Own Key**: Your API Key is stored securely in your browser's **Local Storage**.
- **No Middleman**: Requests go directly from your browser to Google's servers. We do not store or see your keys.

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **AI SDK**: Google GenAI SDK (`@google/genai`)
- **Icons**: Lucide React

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- A Google AI Studio API Key ([Get one here](https://aistudio.google.com/app/apikey))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Alan-512/AI-vision-studio.git
   cd AI-vision-studio
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run locally**
   ```bash
   npm run dev
   ```

4. **Open in Browser**
   Visit `http://localhost:5173` to start creating!

### Configuration
On first launch, click the **Settings** (Gear icon) or follow the prompt to enter your **Google AI Studio API Key**.

## 📦 Deployment

AI Vision Studio is ready for **Cloudflare Pages** deployment.

1. Connect your repository to Cloudflare Pages.
2. Set Build Command: `npm run build`
3. Set Output Directory: `dist`
4. **Deploy!** (No server-side environment variables needed for BYOK mode).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

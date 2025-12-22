# Lumina Studio 代码审查
日期：2025-12-21（已修复：2025-12-22）

## 范围
- 已审查：`App.tsx`、`components/*`、`services/*`、`contexts/LanguageContext.tsx`、`types.ts`、`index.html`、`README.md`、`vite.config.ts`、`manifest.json`、`global.d.ts`、`package.json`。
- 未审查：`node_modules/`、运行时基础设施、外部 API。

## 发现（按严重程度排序）

### 高
- ✅ ~~`services/geminiService.ts:456-465` `AbortSignal` 未传入 `chat.sendMessage`~~
  - **修复**: 添加了 pre-flight 和 post-flight abort 检查，最小化取消时的等待时间和成本浪费。
- ✅ ~~`services/storageService.ts:398-458` `trimBlobUrls()` 会撤销仍在 UI 使用的 blob URL~~
  - **修复**: 实现了引用计数系统 (`createTrackedBlobUrl`, `retainBlobUrl`, `releaseBlobUrl`)，智能清理只删除 refCount=0 的 URL，永不误删活跃资源。
- ✅ ~~`components/CanvasEditor.tsx:331-333` 矩形工具 `lastMouseEventRef.current!` 未做空值保护~~
  - **修复**: 添加了 null 检查，在无鼠标移动时回退使用 dragStartRef 坐标。

### 中
- ✅ ~~`services/agentService.ts:281-300` 与 `services/agentService.ts:334-347` 双重重试~~
  - **修复**: 移除了 `handleActionFailure()` 中的重试逻辑，现在只由 `executeWithRetry()` 负责重试，确保重试次数准确。
- ✅ ~~`components/ChatInterface.tsx:241-264` `agentMachine` 每次渲染重建~~
  - **修复**: 使用 `useRef` 存储 `onToolCall`，移除 `useMemo` 依赖，机器实例现在在组件生命周期内稳定存在。
- ✅ ~~`components/ChatInterface.tsx:291-299` 多图生成触发 `AWAITING_CONFIRMATION` 无对应 UI~~
  - **修复**: 修改 `shouldRequireConfirmation()`，多图生成不再要求确认（用户已明确表达意图时）。
- ✅ ~~`services/geminiService.ts:544-547` `generateVideo()` 未校验 `downloadLink` 或 `response.ok`~~
  - **修复**: 添加了三层校验：downloadLink 存在性、API key 非 undefined、HTTP response.ok。
- ✅ ~~`README.md:10-13` 文档写 `GEMINI_API_KEY`，代码读 `VITE_API_KEY`~~
  - **修复**: 更新 README 使用正确的 `VITE_API_KEY` 变量名，并说明仅供开发者本地测试。

### 低
- ✅ ~~`components/GenerationForm.tsx:308-322` 与 `375-389` `Promise.all` 单点失败~~
  - **修复**: 改用 `Promise.allSettled`，单个文件失败不会导致整体拒绝，有效文件仍会被处理。
- ✅ ~~`App.tsx:173-174` `generatingStates` 没有 setter~~
  - **修复**: 改用 `useMemo` 从 `tasks` 状态派生，现在 ProjectSidebar 正确显示生成指示器。
- ✅ ~~`App.tsx:698` 视频资产可触发比较，但 ComparisonView 只支持图片~~
  - **修复**: 添加了类型检查，选择视频时显示错误提示而非进入异常视图。

## 已确认的产品约束
- 生成必须使用用户自带 API Key；`VITE_API_KEY` 仅用于开发者本地测试。
- 比较功能仅限图片资产。

## 修复摘要
- 共修复 11 个问题（3 高、5 中、3 低）
- 主要影响文件：
  - `services/geminiService.ts`
  - `services/storageService.ts`
  - `services/agentService.ts`
  - `components/CanvasEditor.tsx`
  - `components/ChatInterface.tsx`
  - `components/GenerationForm.tsx`
  - `App.tsx`
  - `README.md`

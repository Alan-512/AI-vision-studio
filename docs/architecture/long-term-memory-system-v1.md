# Lumina Studio 长期记忆系统设计文档（V1.0）

## 1. 目标与范围

### 1.1 目标
构建一套“无后端、本地优先、人类可读、完全可控”的长期记忆系统，让 AI 在多轮对话与跨会话中保持稳定个性与项目连续性，同时保证隐私与可审计性。

### 1.2 范围（In Scope）
- 本地记忆存储（IndexedDB）。
- 记忆捕获、整合、注入三段式流程。
- 记忆可视化与人工编辑（设置页入口 + Inline Toast）。
- 导出/导入备份机制。
- 与现有聊天链路集成（`services/geminiService.ts`、`components/ChatInterface.tsx`、`App.tsx`）。

### 1.3 非范围（Out of Scope）
- 云端同步与多设备实时同步。
- 向量数据库与语义检索服务。
- 多用户账户体系。

## 2. 设计原则

- 本地优先：所有记忆默认只在浏览器本地存储。
- 人类可读：记忆主视图使用 Markdown 文本，可直接人工编辑。
- 稳定优先：避免“全量 AI 改写全文”，采用结构化增量合并。
- 可回滚：每次写入记录版本与快照，可恢复。
- 最小侵入：优先复用现有存储与 prompt 拼接架构。

## 3. 与当前项目的集成现状

已存在可复用能力：
- IndexedDB 基础设施与事务重试：`services/storageService.ts`。
- 持久化权限申请：`initStoragePersistence`（`services/storageService.ts`）。
- 聊天 system instruction 注入路径：`buildSystemInstruction` 与 `streamChatResponse`（`services/geminiService.ts`）。
- 项目级上下文摘要（`contextSummary`）已在 `App.tsx` 与 `geminiService.ts` 链路中传递。

结论：长期记忆系统可在现有代码上增量实现，不需要引入后端。

## 4. 存储架构

### 4.1 逻辑文件模型（虚拟 Markdown）
- 全局记忆：`.lumina/profiles/default.md`
- 项目记忆：`.lumina/memory/{projectId}.md`

说明：以上为逻辑路径，实际存储在 IndexedDB 中，以 `path` 字段映射。

### 4.2 IndexedDB Schema（建议 v4 升级）
新增 object store：`memory_docs`

字段建议：
- `id: string`（主键，建议 `${scope}:${targetId}`）
- `scope: 'global' | 'project'`
- `targetId: string`（global 固定 `default`；project 为 `projectId`）
- `path: string`（如 `.lumina/memory/xxx.md`）
- `content: string`（Markdown 文本）
- `version: number`（乐观锁版本）
- `updatedAt: number`
- `createdAt: number`
- `checksum?: string`（可选，导出校验）

可选新增 store：`memory_ops`
- 记录每次 patch 操作，便于审计与回滚。

### 4.3 记忆生命周期与孤儿管理

- **项目删除**：采用软删除策略。删除项目时，`memory_docs` 不立即物理删除，标记为 `isDeleted`。防止误删及便于后续恢复。
- **项目恢复**：清除 `isDeleted` 标记，重新绑定项目 ID 即可唤醒记忆。
- **物理清理**：在设置页提供“彻底清除记录”功能，或在磁盘配额预警时，按 LRU 策略物理删除已标记删除的项目记忆。

## 5. 记忆数据规范（Markdown + 结构化块）

为确保可读性与稳定 merge，采用“可读 Markdown + 轻量结构化约定”：

```md
# Lumina Memory

## User Profile
- name: Alice
- role: Product Designer
- language: zh-CN

## Stable Preferences
- code_style: concise
- ui_taste: minimal, high-contrast

## Project Decisions
- [2026-03-02] Use Tailwind CSS
- [2026-03-02] Image model default: gemini-3.1-flash-image-preview

## Guardrails
- Never store API keys, passwords, private credentials
```

约束：
- 仅允许白名单字段进入 `User Profile` / `Stable Preferences`。
- 高风险信息（密钥、证件号、账号）禁止入库。
- 每条决策可带时间戳，便于冲突处理。

## 6. 核心流程

### 6.1 Capture（记忆捕获）

触发来源：
- 显式指令（高置信）：如“记住我喜欢简洁代码”。
- 隐式事实（低置信）：如“以后都用 Tailwind”。

可靠性策略：
- 显式指令可直接进入“待应用 patch”。
- 隐式事实先进入候选队列，默认需要用户确认后落库。

实现建议：
- 在聊天工具层加入 `manage_memory` 意图，但不要在同一次 Gemini 请求中与 `googleSearch` 混用。
- 若开启搜索，记忆提取放在回复完成后异步执行。

### 6.2 Consolidation（记忆整合）

关键原则：
- AI 只输出结构化 patch，不直接改写整篇 Markdown。
- 合并由程序执行，保证确定性。

Patch 示例：
```json
{
  "ops": [
    {"op": "upsert", "section": "Stable Preferences", "key": "code_style", "value": "concise"},
    {"op": "append", "section": "Project Decisions", "value": "[2026-03-02] Use Tailwind CSS"}
  ],
  "confidence": 0.92,
  "reason": "explicit_user_command"
}
```

冲突规则：
- 同 key 冲突：新值覆盖旧值，并记录旧值到 `memory_ops`。
- 项目决策冲突：按时间戳后写优先；若无时间戳按版本后写优先。
- 合并前校验 `version`；不一致则重读后重放 patch（CAS）。

### 6.3 Injection（记忆注入）

注入位置：
- 每次聊天请求，记忆内容插入 system instruction 顶部（高优先级）。

推荐方式（避免 prompt 膨胀）：
- 不注入全文。
- 注入“全局核心偏好 + 当前项目 top-k 相关决策”。

建议拼接模板：
```text
[LONG-TERM MEMORY]
- user.language: zh-CN
- user.code_style: concise
- project.decision: Use Tailwind CSS
...
```

上限建议：
- 注入字符数上限 1200~2000 字符。
- 超出时按优先级裁剪（profile > stable preferences > latest project decisions）。

## 7. UI/交互设计

### 7.1 设计原则：静默运行，按需可见

参考 Claude Code、OpenClaw 等成熟方案，记忆系统应**默认在后台静默运行**，用户无需感知其存在。AI 自动记、自动用。

### 7.2 候选记忆确认（Inline Toast）

当 AI 从对话中提取到隐式记忆候选时，不跳转到专门面板，而是在聊天区域底部弹出轻量气泡：
- 内容示例："AI 想记住：您偏好简洁代码风格 [✓ 确认] [✗ 忽略]"
- 自动消失：若用户未操作，30 秒后自动折叠（不入库）。
- 显式指令（如"记住我喜欢..."）可跳过确认，直接入库。

### 7.3 记忆管理入口（设置页二级页面）

入口：设置页 → "管理 AI 记忆"（非侧栏显眼入口）。

能力：
- 预览模式：渲染 Markdown。
- 编辑模式：可直接修改原文并保存。
- 快速操作：
  - `Rollback`（回退到上一版本）
  - `Export` / `Import`

交互约束：
- 保存前执行 schema lint（必填 section、非法敏感词检测）。
- 保存失败时展示原因，不覆盖旧版本。

## 8. 安全与隐私

- 数据默认仅本地存储，不上传云端。
- 启动时检测并申请 `navigator.storage.persist()`。
- 敏感词拦截：API key、密码、token、身份证号等模式匹配，禁止写入记忆。
- 导出文件默认不加密；若后续支持加密导出，需用户显式输入密码。

## 9. 可靠性风险与对策

### 9.1 风险清单
- 误记忆：把一次性需求写成长期偏好。
- 漂移：AI 合并导致历史偏好反复被改写。
- 并发覆盖：多标签页同时写入。
- 注入失控：记忆过长导致模型响应不稳。
- 浏览器清理：未持久化时被系统回收。

### 9.2 对策
- 显式/隐式双通道，隐式通过 inline toast 确认后入库。
- 结构化 patch + 程序合并 + 版本锁。
- 字符上限与分级注入。
- 周期性快照与一键导出（设置页入口）。
- 启动提示持久化状态（可复用现有 `StorageStatusBanner` 机制）。

## 10. 实施计划（分阶段）

### 阶段 1：存储层与服务层
- 新建 `services/memoryService.ts`。
- 扩展 `services/storageService.ts`：DB v4，新增 `memory_docs`（可选 `memory_ops`）。
- API：
  - `getMemoryDoc(scope, targetId)`
  - `saveMemoryDoc(doc, expectedVersion)`
  - `applyMemoryPatch(scope, targetId, patch)`
  - `exportMemoryBundle()` / `importMemoryBundle()`

验收：
- 可创建/读取/更新 global + project 两类记忆文档。
- 版本冲突可检测并重试。

### 阶段 2：注入链路
- 在 `services/geminiService.ts` 请求构建阶段插入 memory snippet。
- 避免与 `googleSearch` + functionDeclarations 冲突：记忆捕获改为异步后处理。

验收：
- 每次聊天前可稳定注入记忆摘要。
- search on/off 两种模式下无工具冲突异常。

### 阶段 3：捕获与整合
- 新增 `manage_memory` 处理器（建议在应用层而非同请求工具混合）。
- 实现候选记忆队列与确认流。

验收：
- 显式指令可自动入库。
- 隐式候选需人工确认后入库。

### 阶段 4：UI 与运维能力
- 聊天区新增 inline toast 候选确认组件。
- 设置页新增"管理 AI 记忆"二级页面，支持编辑、回滚、导出导入。

验收：
- 隐式候选通过 toast 确认后入库。
- 用户可在设置页查看、纠错、回滚历史。
- 导出 zip 可重新导入并通过校验。

## 11. 测试计划

### 11.1 单元测试
- Markdown parser/formatter。
- patch 合并与冲突处理。
- version CAS 逻辑。
- 敏感信息拦截。

### 11.2 集成测试
- 聊天发送 -> 注入记忆 -> 响应一致性。
- search 开关与记忆流程并存。
- 多项目切换时记忆隔离。

### 11.3 回归测试
- 不影响现有图像工具调用链路。
- 不影响项目保存/加载与聊天历史。

## 12. 验收标准（Definition of Done）

- 记忆仅本地可见，刷新后可恢复。
- 用户可在 UI 中看到并修改记忆文本。
- 模型回答可体现稳定偏好（同类请求一致性提高）。
- 工具链路无冲突、无明显性能回退。
- 提供导出能力，并可成功导入恢复。

## 13. 后续版本建议（V1.1+）

- 记忆质量评分（最近命中率、冲突率）。
- 项目模板化记忆（如“电商海报项目模板偏好”）。
- 可选本地加密（用户密码派生密钥）。

---

## 附录 A：建议新增文件清单

- `services/memoryService.ts`
- `components/MemoryEditor.tsx`
- `utils/memoryMarkdown.ts`
- `utils/memoryPatch.ts`
- `tests/memoryService.test.ts`
- `tests/memoryPatch.test.ts`

## 附录 B：与现有代码的关键挂载点

- `services/storageService.ts`：DB schema 升级与 memory store。
- `services/geminiService.ts`：请求前注入 memory snippet。
- `components/ChatInterface.tsx`：候选记忆 inline toast 确认组件。
- `App.tsx`：设置页记忆管理入口、项目级记忆与项目 ID 绑定。

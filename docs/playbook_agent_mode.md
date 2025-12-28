# Playbook 自动模式方案（Lumina Chat Image）

## 目标

- 在不增加额外 API 调用的前提下，让图像生成更稳定、可控、可复现。
- 保持 Chat/Studio 参数隔离，仍由 Chat 侧自动决策与触发生成。
- 让“模式选择”进入工具参数，便于调试与后续扩展。

## 当前实现的问题（简述）

- Chat 端 `generate_image` 由模型直接决定全部参数，存在不稳定与漂移风险。
- 参考图策略（`reference_mode`）依赖模型推断，容易误判导致错图引用。
- 缺少统一的“任务类型 / 模式”定义，无法在日志层面快速定位问题。

## 方案概述

采用 **Playbook 自动模式**：
- 模型在调用 `generate_image` 时必须给出 `assistant_mode`（枚举）。
- 前端在 `handleAgentToolCall` 里根据 `assistant_mode` 应用预定义策略。
- 只补默认值与约束，不覆盖用户显式参数，保证灵活度。
- 不增加调用次数，仍保持单次请求、低延迟。

## Playbook 模式定义（v1）

建议先保留 4-6 个高价值模式：

| assistant_mode | 典型场景 | 核心策略 |
| --- | --- | --- |
| CREATE_NEW | 纯文本生成新画面 | `reference_mode=NONE`，风格自由 |
| STYLE_TRANSFER | 用上传图作为画风参考 | `reference_mode=USER_UPLOADED_ONLY`，强调风格一致 |
| EDIT_LAST | 修改上一张生成图 | `reference_mode=LAST_GENERATED`，保持主体一致 |
| COMBINE_REFS | 多图融合 | `reference_mode=ALL_USER_UPLOADED` |
| PRODUCT_SHOT | 产品图/电商 | 限制风格漂移、背景干净、光照规范 |
| POSTER | 海报/视觉设计 | 固定构图规范，允许文案/留白 |

> v1 可以先做 4 个模式：CREATE_NEW / STYLE_TRANSFER / EDIT_LAST / COMBINE_REFS。

## 模型侧判断规则（写入系统指令）

在系统指令中明确：
- 必须从枚举中选择 `assistant_mode`。
- 判断依据：用户意图关键词、是否上传图、是否要求修改上一张等。
- 同时继续输出原有 `reference_mode` / `reference_count`，但最终会被 Playbook 兜底修正。

示例规则（文字即可，不需要额外 API）：
- “新建/生成/创建” → CREATE_NEW
- “风格/画风/参考这张/像这张” → STYLE_TRANSFER
- “修改/改成/继续/基于上一张” → EDIT_LAST
- “融合/组合/多张” → COMBINE_REFS

## 参数映射策略（Playbook 应用层）

在 `App.tsx` 的 `handleAgentToolCall` 中应用：
- 若用户显式指定某个参数，优先用户参数。
- 若未指定，则使用 Playbook 默认值。
- 关键约束（必要时强制）：
  - `EDIT_LAST` 强制 `reference_mode=LAST_GENERATED`
  - `STYLE_TRANSFER` 强制 `reference_mode=USER_UPLOADED_ONLY`
  - `CREATE_NEW` 强制 `reference_mode=NONE`

## 代码改动清单

### 1) `services/geminiService.ts`

- 在 `generateImageTool` 中新增参数：
  - `assistant_mode`（enum）
- 在系统指令中加入“必须输出 assistant_mode”的要求。
- 可选：将 `assistant_mode` 写入 tool call 的日志，便于调试。

### 2) `types.ts`

- 新增 `AssistantMode` enum（或字符串联合类型）。
- 如果需要记录到历史：扩展 `ToolCallRecord` 或 `ChatMessage` 的 metadata。

### 3) `App.tsx`

- 在 `handleAgentToolCall` 解析 `assistant_mode`。
- 新增 `applyPlaybookDefaults(...)`：
  - 输入：工具参数、当前 chatParams
  - 输出：合并后的生成参数
- 保证 Chat/Studio 参数隔离（只影响 Chat 触发生成）。

### 4) （可选）UI 提示

- 在 Chat 工具调用状态里显示 `assistant_mode`。
- 提示用户当前“模式判断结果”，便于手动纠错。

## 兼容与回退

- 若 `assistant_mode` 缺失：回退到当前逻辑（不应用 Playbook）。
- 只应用“兜底默认值”，避免破坏现有自由度。
- 保持现有 Gemini 工具调用结构不变，避免影响搜索/工具调用限制。

## 风险与对策

- **模型误判模式**：可在 UI 提示当前模式，允许用户用自然语言纠正。
- **参数冲突**：用户显式参数优先，Playbook 只作为缺省值与约束。
- **调试难度**：记录 `assistant_mode` 到日志与 toolCallStatus。

## 交付与验证

- 验证场景：
  1) 纯文本生成 → CREATE_NEW / reference_mode=NONE
  2) 上传参考图 + “按这个风格” → STYLE_TRANSFER / USER_UPLOADED_ONLY
  3) “把上一张改成…” → EDIT_LAST / LAST_GENERATED
  4) 上传多图 + “融合” → COMBINE_REFS / ALL_USER_UPLOADED
- 观察调试日志与生成结果一致性。


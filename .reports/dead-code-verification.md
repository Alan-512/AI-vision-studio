# 死代码分析验证报告

> 生成时间: 2026-03-04
> 验证方式: 全局代码搜索

---

## 验证摘要

| 类别 | 原始报告 | 验证结果 | 可删除 |
|------|----------|----------|--------|
| 未使用文件 | 6 | 2个确认未使用 | ✅ 是 |
| 未使用依赖 | 4 | 4个确认未使用 | ✅ 是 |
| 未使用导出函数 | 26 | 19个确认未使用 | ✅ 部分 |

---

## ✅ 确认可安全删除

### 1. 组件文件 (2个)

| 文件 | 状态 | 说明 |
|------|------|------|
| `components/LightboxViewer.tsx` | 🔴 未使用 | 不在 App.tsx 导入列表中，无其他文件导入 |
| `components/StorageStatusBanner.tsx` | 🔴 未使用 | 不在 App.tsx 导入列表中，无其他文件导入 |

**验证命令**:
```bash
# LightboxViewer 搜索结果:
# - 只在自身文件和 report 中出现
# - App.tsx 中没有导入

# StorageStatusBanner 搜索结果:
# - 只在自身文件和 report 中出现
# - App.tsx 中没有导入
```

### 2. 未使用的依赖 (4个)

```json
{
  "dependencies": [
    "@ai-sdk/google",  // ✅ 未使用
    "ai",              // ✅ 未使用
    "zod"              // ✅ 未使用
  ],
  "devDependencies": [
    "@testing-library/react"  // ✅ 未使用（项目只用 jest-dom）
  ]
}
```

**删除命令**:
```bash
npm uninstall @ai-sdk/google ai zod @testing-library/react
```

### 3. 确认未使用的导出函数 (19个)

#### services/skills/ (3个)
| 函数 | 文件 | 状态 |
|------|------|------|
| `getSkillsByTriggerType` | index.ts:329 | 🔴 只有定义，无外部导入 |
| `buildSimpleSystemInstruction` | promptRouter.ts:134 | 🔴 只有定义，无外部导入 |
| `getActiveSkills` | promptRouter.ts:157 | 🔴 只有定义，无外部导入 |

**注意**: 虽然 `buildSystemInstruction` (没有 Simple) 被使用，但 `buildSimpleSystemInstruction` 未被使用。

#### utils/memoryPatch.ts (6个)
| 函数 | 行号 | 状态 |
|------|------|------|
| `createMemoryPatch` | 38 | 🔴 只有定义，无外部使用 |
| `detectConflict` | 201 | 🔴 只有定义，无外部使用 |
| `mergePatches` | 219 | 🔴 只有定义，无外部使用 |
| `validatePatch` | 241 | 🔴 只有定义，无外部使用 |
| `createPatchFromCommand` | 290 | 🔴 只有定义，无外部使用 |
| `generateMemoryDiff` | 357 | 🔴 只有定义，无外部使用 |

**验证结果**: 这些函数只有定义，没有任何文件导入它们。

#### utils/memoryMarkdown.ts (5个)
| 函数 | 行号 | 状态 |
|------|------|------|
| `getSectionFromMarkdown` | 237 | 🔴 只有定义，无外部使用 |
| `updateKeyInMarkdown` | 245 | 🔴 只有定义，无外部使用 |
| `appendDecisionToMarkdown` | 272 | 🔴 只有定义，无外部使用 |
| `validateMemoryMarkdown` | 296 | 🔴 只有定义，无外部使用 |
| `extractFlatMemory` | 326 | 🔴 只有定义，无外部使用 |

**验证结果**: 这些函数只有定义，没有任何文件导入它们。

#### services/memoryService.ts (5个)
| 函数 | 行号 | 状态 | 说明 |
|------|------|------|------|
| `rollbackMemory` | 428 | 🔴 未使用 | 只有定义，无外部使用 |
| `getAllProjectMemories` | 582 | 🔴 未使用 | 只有定义，无外部使用 |
| `getTopicContent` | 647 | 🔴 未使用 | 只有定义，无外部使用 |
| `clearCompletedTasks` | 864 | 🔴 未使用 | 只有定义，StorageStatusBanner 也未使用 |
| `initStoragePersistence` | 17 | 🟡 间接使用 | 被 StorageStatusBanner 使用，但组件未使用 |

### 4. 未使用的类型导出 (5个)

| 类型 | 文件 | 状态 |
|------|------|------|
| `AgentEvent` | services/agentService.ts:59 | 🟢 可移除 export |
| `JobStep` | types.ts:246 | 🟢 可移除 export |
| `JobArtifact` | types.ts:257 | 🟢 可移除 export |
| `MemorySections` | utils/memoryPatch.ts:412 | 🟢 可移除 export |
| `MemorySectionItem` | utils/memoryPatch.ts:412 | 🟢 可移除 export |

---

## 🟢 必须保留的文件

| 文件 | 说明 |
|------|------|
| `functions/api/[[catchall]].ts` | Cloudflare Pages Function，代理 Gemini API 给国内用户使用 |

---

## 🟡 内部使用的函数（保留，但可取消 export）

以下函数只在定义文件内部使用，**可以被其他函数调用，但没有被外部文件导入**。
建议取消 `export` 关键字以减少公共 API 表面积。

### services/memoryService.ts
| 函数 | 行号 | 使用情况 |
|------|------|----------|
| `containsSensitiveData` | 53 | 内部使用 (127, 564行) |
| `filterSensitiveData` | 60 | 内部使用 (127, 177, 226, 502行) |
| `getMemorySnippet` | 255 | 内部使用 (397, 404行) |
| `restoreMemory` | 553 | 内部使用 (554行)，包装 restoreMemoryDoc |

---

## 📋 建议的清理操作

### 阶段 1: 安全删除 (立即执行)

1. **删除未使用的组件文件**:
   ```bash
   rm components/LightboxViewer.tsx
   rm components/StorageStatusBanner.tsx
   ```

2. **卸载未使用的依赖**:
   ```bash
   npm uninstall @ai-sdk/google ai zod @testing-library/react
   ```

### 阶段 2: 清理导出 (代码审查后)

3. **移除未使用的导出函数** (在对应文件中删除 `export` 关键字):
   - `services/skills/index.ts`: `getSkillsByTriggerType`
   - `services/skills/promptRouter.ts`: `buildSimpleSystemInstruction`, `getActiveSkills`
   - `utils/memoryPatch.ts`: 全部6个函数
   - `utils/memoryMarkdown.ts`: 全部5个函数
   - `services/memoryService.ts`: `rollbackMemory`, `getAllProjectMemories`, `getTopicContent`, `clearCompletedTasks`

4. **取消内部使用函数的 export**:
   - `services/memoryService.ts`: `containsSensitiveData`, `filterSensitiveData`, `getMemorySnippet`, `restoreMemory`

### 阶段 3: 清理类型导出

5. **移除未使用的类型 export**:
   - `services/agentService.ts`: `AgentEvent`
   - `types.ts`: `JobStep`, `JobArtifact`
   - `utils/memoryPatch.ts`: `MemorySections`, `MemorySectionItem`

---

## ⚠️ 风险提示

1. **LightboxViewer** 和 **StorageStatusBanner** 可能是为将来功能准备的组件
2. **memoryPatch** 和 **memoryMarkdown** 的函数可能是 MemoryEditor 的高级功能，当前未启用
3. 建议删除前运行完整测试套件确认没有破坏功能

---

## 验证使用的命令

```bash
# 检查组件使用
rg "LightboxViewer" --type tsx
rg "StorageStatusBanner" --type tsx

# 检查函数使用
rg "getSkillsByTriggerType|buildSimpleSystemInstruction|getActiveSkills" --type ts
rg "createMemoryPatch|detectConflict|mergePatches|validatePatch|createPatchFromCommand|generateMemoryDiff" --type ts
rg "getSectionFromMarkdown|updateKeyInMarkdown|appendDecisionToMarkdown|validateMemoryMarkdown|extractFlatMemory" --type ts
rg "rollbackMemory|getAllProjectMemories|getTopicContent|clearCompletedTasks|initStoragePersistence" --type ts

# 检查类型使用
rg "AgentEvent|JobStep|JobArtifact|MemorySections|MemorySectionItem" --type ts
```

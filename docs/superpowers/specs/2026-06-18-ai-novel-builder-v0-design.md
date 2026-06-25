# AI 驱动的小说创作器 v0 — 设计

日期:2026-06-18
范围:v0(编辑流优先)
状态:已批准,等待实现计划

## 1. 目标与非目标

### 1.1 目标(v0)
为单作者提供本地优先的 AI 小说创作环境,核心闭环是:

1. 创建项目与三级大纲(卷 / 章 / 场景)
2. 在富文本编辑器中写作
3. 调用 AI 完成续写 / 润色 / 重写 / 扩写 / 压缩
4. 内容自动保存并可恢复(快照)
5. 项目文件可被外部编辑器(例如 Obsidian、VS Code)直接打开

### 1.2 非目标(显式排除,留到后续 spec)
- 人物 / 世界观 / 时间线数据库
- AI 一致性检查与风格控制
- 协作与多用户
- 跨设备同步
- 发布与导出格式(epub 等)
- 桌面端打包
- 版本对比 UI

## 2. 技术栈

| 关注点 | 选型 | 理由 |
|--------|------|------|
| 前端框架 | React 18 + Vite | DX 优秀,TipTap 文档齐全 |
| 编辑器 | TipTap(ProseMirror) | 选区/光标模型与 AI 手势契合 |
| 前端状态 | TanStack Query(远端)+ Zustand(本地 UI) | 各司其职,避免膨胀 |
| 后端运行时 | Node.js + TypeScript strict | 前后端共享类型 |
| 后端框架 | Fastify | 性能、类型、流式友好 |
| 数据库 | better-sqlite3 | 本地优先、零运维、强类型 |
| AI | 多供应商插件(OpenAI 兼容为默认) | 用户可控、不锁定 |
| 日志 | pino | 结构化、零开销 |
| 校验 | zod | 入参/出参校验统一 |
| 测试 | Vitest + RTL + Playwright | 全栈覆盖 |
| 工具链 | pnpm workspace、ESLint、Prettier | 单仓多包 |

## 3. 仓库布局

```
novel-build/
├── apps/
│   ├── server/              Fastify AI/数据后端
│   │   ├── src/
│   │   │   ├── routes/      HTTP/SSE 路由
│   │   │   ├── ai/          Provider 接口与实现
│   │   │   ├── storage/     SQLite 仓储 + Markdown IO
│   │   │   ├── snapshots/   内容寻址对象库
│   │   │   ├── prompts/     默认提示词模板
│   │   │   └── server.ts    入口
│   │   └── package.json
│   └── web/                 Vite SPA
│       ├── src/
│       │   ├── features/    project / outline / editor / ai / settings
│       │   ├── components/  共享 UI
│       │   ├── api/         fetch 客户端 + SSE 消费
│       │   ├── hooks/
│       │   └── main.tsx
│       └── package.json
└── packages/
    └── shared/              共享 TS 类型 + 默认 prompt 模板
```

## 4. 数据模型与存储

### 4.1 用户项目目录

```
~/Novels/<project-slug>/
├── novel.db                 SQLite(元数据 + 索引)
├── manuscripts/             每场景一个 .md 文件
│   └── <volume-slug>/<chapter-slug>/<scene-slug>.md
└── .snapshots/              内容寻址对象库
    └── <sha256>.md.z
```

应用配置存于 `~/.novel/config.json`(权限 0600),日志 `~/.novel/logs/server.log`(7 天滚动)。

### 4.2 SQLite schema

```sql
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  current_volume_id INTEGER
);

CREATE TABLE volumes (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  order_index  INTEGER NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE TABLE chapters (
  id           INTEGER PRIMARY KEY,
  volume_id    INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  order_index  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',  -- draft | revising | done
  UNIQUE(volume_id, slug)
);

CREATE TABLE scenes (
  id           INTEGER PRIMARY KEY,
  chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  order_index  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  target_words INTEGER,
  notes        TEXT,                            -- Markdown,场景大纲
  content_hash TEXT NOT NULL,                   -- SHA-256 of .md file
  entity_refs  TEXT NOT NULL DEFAULT '[]',      -- JSON 数组,供 v0.1 人物/世界观扩展
  UNIQUE(chapter_id, slug)
);

CREATE TABLE ai_settings (
  project_id   INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider_id  TEXT NOT NULL,
  model        TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  context_prev_chars INTEGER NOT NULL DEFAULT 1500
);

CREATE TABLE snapshots_meta (
  hash         TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                  -- 'auto' | 'manual'
  scene_id     INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  parent_hash  TEXT
);
```

### 4.3 正文真源

正文以 Markdown 存于 `manuscripts/<vol-slug>/<chap-slug>/<scene-slug>.md`。
- `scenes.content_hash` 是该文件最近一次成功保存的 SHA-256。
- 应用与外部编辑器都可能写入该文件;`fs.watch` + 定时扫描负责检测外部变更。

### 4.4 快照对象库

`.snapshots/<sha256>.md.z` —— zlib 压缩纯文本,只追加。
- 写入:计算 SHA-256(zlib(text));如不存在则写入文件;`snapshots_meta` 插入/更新行。
- Diff:v0 只存全文,LCS 在前端实现。
- 触发时机:
  - 手动保存点(用户在 UI 点 "Snapshot")
  - 硬快照每 5 分钟(若内容有变化)
  - 外部修改被合并时打旧内容快照

### 4.5 写事务顺序

所有"保存场景"操作:
1. 写文件到磁盘,fsync
2. 计算新 SHA-256
3. 写 SQLite(更新 scenes 行 + 必要时插入 snapshots_meta)
4. 任一步失败:回滚文件写(从临时文件恢复或删除)、不动数据库

## 5. AI 子系统

### 5.1 Provider 接口

```ts
// packages/shared/src/ai.ts
export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage { role: ChatRole; content: string }

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: true
  signal?: AbortSignal
}

export interface AiProvider {
  id: string                                  // 'openai-compatible'
  label: string
  complete(req: CompletionRequest): AsyncIterable<string>
}
```

接口只暴露流式实现;非流式调用由消费方 `for await` 后合并。

### 5.2 OpenAI 兼容 Provider(v0 默认)

`apps/server/src/ai/openai-compatible.ts`
- POST `${baseUrl}/chat/completions`
- Headers: `Authorization: Bearer ${apiKey}`,`Content-Type: application/json`
- 解析 SSE 行 `data: {...}`,提取 `choices[0].delta.content`,结束哨兵 `data: [DONE]`
- `req.signal` 触发时关闭底层 fetch

### 5.3 Provider 注册表

- `~/.novel/config.json` 形如:
  ```json
  {
    "providers": [
      { "id": "openai-1", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-..." }
    ],
    "defaultProviderId": "openai-1"
  }
  ```
- 前端通过 `GET /api/ai/providers` 只能看到 `id + label`,**永不见 apiKey**。
- 切换 provider 后,`ai_settings.provider_id` 跟随更新。

### 5.4 路由

`POST /api/ai/complete`
- 入参(zod 校验):
  ```ts
  {
    sceneId: number
    mode: 'continue' | 'polish' | 'rewrite' | 'expand' | 'condense'
    selection?: { from: number, to: number, text: string }    // TipTap 文档位置(整数,基于 ProseMirror 索引)
    overrideMessages?: ChatMessage[]                          // 手动覆盖上下文
  }
  ```
- 出参:`Content-Type: application/x-ndjson`,每行:
  - `{"delta": "..."}` 流式片段
  - `{"done": true, "usage": { "promptTokens": ..., "completionTokens": ... }}` 正常收尾
  - `{"error": "...", "recoverable": true}` 异常收尾
- 后端流程:
  1. 加载 `ai_settings`
  2. 加载场景、上 N 字、notes
  3. 拼装 messages(系统 + 上下文 + 当前 selection 或整段)
  4. 调用 Provider 流,直接转发到 NDJSON
  5. 计数 usage,写日志

### 5.5 上下文拼装

**默认自动**(无 `overrideMessages`):
1. system:`ai_settings.system_prompt`(用户可在 settings 编辑)
2. user:场景大纲 + 章节标题 + 上一场景末尾 K 字(`ai_settings.context_prev_chars`,默认 1500)
3. user:当前场景已有正文 / 用户选中文本(取决于 mode)

**手动覆盖**:`overrideMessages` 整数组替换 user 部分;后端只补 system 与长度截断。

各 mode 的默认行为:
| mode | 输入 | 输出 |
|------|------|------|
| continue | 当前光标位置 | 续写若干段(默认 ≤ 400 字) |
| polish | 选中文本 | 同长度润色 |
| rewrite | 选中文本 | 同长度重写 |
| expand | 选中文本 | 1.5x~2x 扩写 |
| condense | 选中文本 | 0.5x 压缩 |

具体长度限制(每 mode 默认 maxTokens、扩写/压缩倍率)与提示词模板存于 `packages/shared/src/prompts.ts`。v0 模板不可在 settings 编辑;只可在代码层调整。

### 5.6 限流

- 全局并发流上限:2(可配)
- 超过上限的请求入队;`signal` 触发时移除队列项
- 任何流式响应都必须支持中途 abort

## 6. 编辑器

### 6.1 TipTap 配置

扩展:`StarterKit` + `Placeholder` + `Markdown`(序列化)+ 自定义 `AiSuggestion` mark。
- `AiSuggestion`:临时高亮 AI 提议文本;接受后转为正式节点、拒绝后删除。
- 序列化:JSON ↔ Markdown 走 remark 统一转换,**双向转换在测试中固定**,差异超出白名单时提示"原始 Markdown 模式"。

### 6.2 AI 手势

| 手势 | 触发 | 反馈 |
|------|------|------|
| 续写 | 光标在段末,点工具栏或 `Cmd+L` | 幽灵文本,`Tab` 接受、`Esc` 拒绝 |
| 选中改写 | 选中 + 右侧面板按钮 | 选中区替换,接受前原文本保留为 mark |
| 手动上下文 | 拖选多段,点 "作为上下文",再选模式 | 完全跳过默认拼装 |

### 6.3 自动保存

- 编辑器变化 debounce 800ms → `PUT /api/scenes/:id`
- 每 5 分钟若内容变化,触发硬快照
- `Cmd+S` 强制立即保存 + 打手动快照

### 6.4 外部修改

- 启动时 + 每 60s 扫描 `manuscripts/`,对比 `content_hash`
- 差异时:若无未保存编辑,直接刷新;若有,弹 422 三选项(放弃本地 / 以外部为准 / 打开差异视图)

### 6.5 快捷键

| 键 | 行为 |
|----|------|
| `Tab` / `Esc` | 接受 / 拒绝 AI 建议 |
| `Cmd+L` | 在光标处续写 |
| `Cmd+K` | 打开 AI 命令面板 |
| `Cmd+S` | 强制保存 + 手动快照 |

## 7. 前端结构

| 路径 | 视图 |
|------|------|
| `/projects` | 项目列表(创建/打开) |
| `/projects/:id` | 三栏:大纲 / 编辑器 / AI 面板 |
| `/settings` | Provider 配置 + 默认模型 + 系统提示词 |

三栏布局:
- 左 240px:卷/章/场景树(可拖拽排序、inline 重命名)
- 中:TipTap 编辑器,顶部场景标题 + 字数统计 + 状态切换
- 右 360px:AI 面板 + 上下文预览 + 操作按钮

路由使用 React Router 6,数据用 TanStack Query 缓存。

## 8. 错误处理

### 8.1 全局错误格式

```ts
type ApiError = { code: string, message: string, hint?: string, details?: unknown }
```

HTTP 映射:
- 400 入参校验失败
- 404 资源不存在
- 409 slug 冲突 / 顺序冲突
- 422 语义冲突(外部修改 / AI 输入异常)
- 429 流并发超限
- 500 内部错误

### 8.2 AI 流中断

收尾行 `{"error": "...", "recoverable": true}`;前端在 AI 面板显示重试按钮与简短提示。

### 8.3 文件冲突

PUT 场景时,服务端比对请求中的 `baseHash` 与磁盘哈希:
- 一致 → 写入
- 不一致 → 422 + `{ code: 'external_change', externalHash }`,前端三选项 UI

## 9. 测试

### 9.1 后端(vitest)
- `storage/`:Markdown IO、SQLite CRUD、迁移
- `snapshots/`:内容寻址、LCS diff、压缩往返
- `ai/`:Provider fake(可控延迟 + 错误注入),覆盖拼装/截断/abort/限流
- `routes/`:fastify.inject 集成测,临时项目目录

### 9.2 前端(vitest + RTL)
- 大纲树组件、AI 面板 hook、Markdown ↔ TipTap 转换器
- useAiStream:fake SSE 测正常流、错误流、取消

### 9.3 E2E(Playwright)
- 启动后端 + Vite dev
- 项目创建 → 新建场景 → 输入正文 → 触发续写(fake provider)→ 接受 → 强制保存 → 重启后内容仍在

### 9.4 覆盖率
- 核心模块 line ≥ 70%

## 10. 风险登记

| # | 风险 | 缓释 |
|---|------|------|
| 1 | TipTap ↔ Markdown 往返语义偏差 | 固定测试用例 + "原始 Markdown"切换 UI |
| 2 | AI 高延迟 + 多次触发打爆额度 | 并发限流 2 + 队列 + abort |
| 3 | 本地文件被外部编辑器修改 | fs.watch + 60s 扫描 + 422 三选项 |
| 4 | v0.1 加人物/世界观/时间线时 schema 迁移 | scenes 预留 `entity_refs` JSON |
| 5 | 大文件快照膨胀 | zlib 压缩 + 仅哈希去重 |
| 6 | 未来切多用户时鉴权缺失 | v0 绑定 localhost,只接受 127.0.0.1 连接 |

## 11. 实施步骤

实现阶段由 `writing-plans` 技能拆解为任务,本 spec 不展开。
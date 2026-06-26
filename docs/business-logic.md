# novel-build 业务逻辑梳理与潜在漏洞

> 这份文档梳理 novel-build 当前的关键业务流程，并在每一处指出**已知的逻辑漏洞 / 边界场景 / 未文档化的行为**。
> 代码基线：见 `git log`，最近几次改动见文末「变更日志」一节。
> 标识含义：
> - 🔴 **真实漏洞**：可被用户感知到 / 可能丢数据
> - 🟡 **边界 case**：罕见但合法路径会触发，行为可能不直观
> - 🟢 **已修复**：本仓库近期已处理
> - ⚪ **误判**：调研中曾怀疑但实际安全

---

## 1. AI 生成流程

### 1.1 服务端 POST /api/ai/complete
入口 [apps/server/src/routes/ai.ts:55-195](apps/server/src/routes/ai.ts#L55)。

**正常路径**：
1. Zod 校验 body（sceneId, mode, model, inputText, 可选 overrideMessages + draftId）
2. 检查默认 provider 配置（[ai.ts:63](apps/server/src/routes/ai.ts#L63)），缺失返回 409
3. `buildContext()` 拼装上下文（[context.ts:78](apps/server/src/ai/context.ts#L78)）
4. 解析 project_id（skeleton 模式从 body.draftProjectId 读，其他从 scene 链读）
5. 写 200 + NDJSON 头
6. **草稿生命周期**（[ai.ts:126-148](apps/server/src/routes/ai.ts#L126)）：
   - 客户端传 draftId 且 status='streaming' → 重连：状态重置为 streaming（无操作）
   - 客户端传 draftId 且 status in ('done'/'error'/'aborted') → 新建草稿
   - 未传 draftId → 新建草稿
7. 推 limiter slot（max 2 并发，[limiter.ts](apps/server/src/ai/limiter.ts)）
8. 流式循环：每收到 provider delta 就写 NDJSON frame + 每 ~200ms 落库一次（`appendText`）+ emit `done` 或 `error` 帧

### 1.2 已知的真实漏洞 / 边界

🔴 **`/api/ai/complete` 重连路径产生并发双写**
[ai.ts:127-130](apps/server/src/routes/ai.ts#L127) 在重连时把 status 从 'streaming' 重置为 streaming，**没有检查 server 侧这个流是否还在跑**。如果用户刷新页面后立即点重试，客户端会再发一次 `POST /complete` 带相同 draftId，server 把 status 重置再启一次 `for await (provider.complete(...))`。两条流同时跑，同时往同一个 draft 行 append text，**草稿内容翻倍**。客户端不持久化 draftId（[useAiStream.ts:63](apps/web/src/hooks/useAiStream.ts#L63) 只在内存里），所以**日常使用不会触发**；但如果客户端代码未来给 draftId 加 localStorage 持久化，这个洞就立刻暴露。

🔴 **Limiter 队列无超时**
[limiter.ts](apps/server/src/ai/limiter.ts) 队列里无限累积 promise。两个 stream 永远 hang 住（如 provider 雪崩），后续请求全部排队，**没有超时也没有上限**。客户端 abort 时 promise reject，但服务端如果挂在 `provider.complete` 的网络 IO 上，**资源不会立即释放**。

🟢 **`generate_novel_skeleton` 客户端传 dummy sceneId=1**
已通过移除 `generate_novel_skeleton` 模式解决（2026-06-25）。`StoryArcGenerator` 替代了 `SkeletonGenerator`，使用 `plan_story_arc` 模式直接生成 Markdown 故事弧线笔记，不再需要 JSON 提取或 dummy sceneId。

🟡 **`applyAcceptedText` 默认分支不发 toast**
[EditorPage.tsx:541-625](apps/web/src/features/editor/EditorPage.tsx#L541) 重构后，AI panel 的 onAccept 在默认分支（continue / polish / rewrite 等）才会发 "已应用到编辑器"，其他模式（plan_story_arc / analyze_voice / generate_chapter）在内部已经发过 toast。**但恢复横幅的接受按钮**走的是同一个 `applyAcceptedText`，对 plan_story_arc 模式**不会**重新发 toast——这是符合预期的，但对一个恢复场景，draft 里 plan_story_arc 是罕见路径，行为未测。

🟢 **`recoverFromDraft` prop 链路已文档化**
之前 `recoverFromDraft` 从 EditorPage 传到 AiPanel 但 AiPanel 内部未消费；现在 [AiPanel.tsx:28-37](apps/web/src/features/ai/AiPanel.tsx#L28) 的注释明确说明此 prop 仅在 `useAiStream` 初始化时消费，恢复流程由 EditorPage 处理。

### 1.3 草稿存储

[apps/server/src/ai/draftStore.ts](apps/server/src/ai/draftStore.ts) 默认 TTL 7 天，每小时 [server.ts:60-69](apps/server/src/server.ts#L60) 跑一次 `purgeExpired`。

🟡 **streaming 草稿在 TTL 过期时被直接删**
没有「只删 done/aborted/error 状态」的保护。如果一个流跑了 8 天（不太可能但理论上可行），会在下一次 purge 时被删，**正在 append 的 provider 写到一半发现 row 不存在**会抛 SQLite 错误。

⚪ **`recoverFromDraft` 不会被自动应用**
[useAiStream.ts:40-50](apps/web/src/hooks/useAiStream.ts#L40) 只在初始化时读 `recoverFromDraft`。EditorPage 顶部的 `useAiStream({ persist: true })` 不传 `recoverFromDraft`，**所以恢复路径完全由恢复横幅独立处理**——`aiState.text` 永远是空。这是有意的，但意味着 panel 里看不到 draft 内容。

---

## 2. 草稿保存（manuscript save）

### 2.1 正常路径
[apps/server/src/manuscripts/service.ts:52-94](apps/server/src/manuscripts/service.ts#L52) `saveScene`：
1. SELECT scenes row
2. **baseHash guard**（line 57）：`!force && scene.content_hash !== input.baseHash` → 抛 422 external_change
3. 计算字数 delta（line 63-66）——从磁盘读旧文本
4. `writeManuscript` 原子写入：temp 文件 + fsync + rename + `recordSelfWrite`（[io.ts:19-30](apps/server/src/manuscripts/io.ts#L19)）
5. 自动 snapshot（默认 createSnapshot=true）
6. UPDATE scenes.content_hash
7. 字数写入 daily_word_log（ON CONFLICT DO UPDATE SET words_added = words_added + delta）

### 2.2 已修复（最近几轮）

🟢 **diffScanner 自写回环（外修改检测误报）**
之前 60 秒一次的 [diffScanner.ts](apps/server/src/manuscripts/diffScanner.ts) 会把 server 自己的写入误判为外部修改，覆盖 DB hash 导致下次 PUT 422。新增 [selfWriteRegistry.ts](apps/server/src/manuscripts/selfWriteRegistry.ts)：`writeManuscript` 后注册 5 秒窗口；`diffScanner` 检测到匹配则跳过。5s 窗口与 60s 周期在 `syncDiskHashes` 的 re-read 兜底下互不冲突。**已修复**。

🟢 **rewrite 后正文丢失**
曾经 `runReview` 用 `content`（编辑器当前文本）作为待改写的源，重写后写入 server 时 baseHash 是当前文本算的——逻辑混乱。现在锁定 `reviewTargets[0].id` 重新从服务端读 scene 内容作为改写源。**已修复**。

### 2.3 真实漏洞

🔴 **concurrent saveScene 的 daily_word_log 重复计数**
两个客户端几乎同时 PUT 同一个 scene：
- 都读 `content_hash = H1`
- 都通过 baseHash guard（H1 == H1）
- 都从磁盘读 oldText 并计算相同的 `delta = newWords - oldWords`
- 都 INSERT 到 daily_word_log，**delta 被加两次**

修复需要：要么把字数量计算改为「与上次记录对比」而不是「与磁盘对比」，要么加 unique idempotency key（如 request_id），要么把 saveScene 整个包在 `BEGIN IMMEDIATE` 事务里串行化。**目前未修**。

🔴 **force:true 静默覆盖外部修改**
[service.ts:57](apps/server/src/manuscripts/service.ts#L57) `!input.force` 跳过 baseHash guard。**这条路径被审稿应用、restore 等多个地方使用**（[EditorPage.tsx:649](apps/web/src/features/editor/EditorPage.tsx#L649)、[snapshots.ts:90](apps/server/src/routes/snapshots.ts#L90)）。如果用户在审稿触发 force 写入前几秒在 VSCode 改了文件，**审稿结果会无警告覆盖外部修改**。

🟡 **saveScene 没有事务**
读 oldText（line 63）→ writeManuscript（line 70）→ UPDATE content_hash（line 76）→ 写 daily_log（line 80-90）四步间没有事务包裹。任意一步失败会导致中间状态：例如 UPDATE 成功但 daily_log 写失败 → 字数统计漏掉；或 writeManuscript 成功但 UPDATE 失败 → 下次 PUT 的 baseHash 还是旧值，**直接 422 误报外部修改**（这正是外修改检测修复前的现象）。

🟡 **writeManuscript 不 fsync 目录**
[io.ts:23-27](apps/server/src/manuscripts/io.ts#L23) 只 fsync 了 temp 文件，**没有 fsync 父目录**。极端断电场景（数仓用得起这个 app 的话）下 rename 可能不持久化。在本地 dev 工具下基本无影响。

🟡 **snapshot 和 save 不是原子的**
[service.ts:71-74](apps/server/src/manuscripts/service.ts#L71) `await SnapshotService.snapshotScene(...)` 与 [line 70](apps/server/src/manuscripts/service.ts#L70) 的 writeManuscript + [line 76](apps/server/src/manuscripts/service.ts#L76) 的 UPDATE 不是原子操作。理论上 snapshot 可能在 write 之前失败但 UPDATE 仍然成功，导致 hash 指向不存在的 snapshot 文件。**罕见但未保护**。

⚪ **slug 唯一性约束已存在**
[migrations.ts:19,28,41](apps/server/src/db/migrations.ts#L19) 三处有 `UNIQUE(volume_id, slug)` / `UNIQUE(chapter_id, slug)` / `UNIQUE(project_id, slug)`。**之前怀疑没有约束是误判**。碰撞时 SQLite 抛 UNIQUE 错误，被 Fastify 错误处理器返回 `500 internal_error`——**虽然不会丢数据，但前端体验差**（应该是 409）。生成章节时 `titleToSlug` 末尾加 6 位 base36 随机串（[sceneSplitter.ts:73-87](apps/web/src/features/ai/sceneSplitter.ts#L73)），碰撞概率极低（36^6 ≈ 21 亿），日常安全。

🔴 **sceneId 唯一约束意味着 UNIQUE 错误会传到前端**
[errors.ts:34](apps/server/src/errors.ts#L34) 非 ApiError 一律返 500。前端只能看到 "创建失败"，用户不知道是 slug 撞了还是别的。

### 2.4 orderIndex 竞争（理论）

[repo.ts:95-132](apps/server/src/projects/repo.ts#L95) 创建 volume/chapter/scene 时 `order_index = MAX(order_index) + 1`。两个并发请求会读到同一个 MAX，得到相同 orderIndex。SQLite 没有 `(parent_id, order_index)` 的 UNIQUE 约束，**两个 row 会有相同 order_index**——大纲渲染顺序非确定。**UI 层用 prompt 阻止了并发添加**（用户需输入标题），所以日常不触发，但 API 路径存在。

---

## 3. 审稿 / 提取流程

### 3.1 正常路径
- **审稿（scene / chapter）**：从 snapshotted `reviewTargets` 读取 AI 输出，写回原目标 scene。Chapter 级是 N 个 scene 循环重写。
- **提取设定**：解析 JSON，按 character / worldElement / timeline / foreshadow / conflict 分支写入世界数据库。

### 3.2 已修复

🟢 **审稿目标漂移（场景切换后应用错地方）**
旧代码 scene-level 应用时读当前 `sceneId`，用户切到别的 scene 再点"应用"会写到错的地方。新代码 `runReview` 在两种 scope 下都锁定 `reviewTargets`，`applyReview` 完全不读 `sceneId`，只用 snapshot id。**已修复**。

🟢 **applyCompleted 状态机耦合审稿/提取**
旧代码审稿应用完按钮变成"提取设定到数据库"——这是伪状态机，提取走的是空 reviewText。新代码彻底删除 `applyCompleted` state，Dialog 内审稿模式只显示"应用"、提取模式只显示"保存到设定"。**已修复**。

### 3.3 真实漏洞

🔴 **applyReview 的 force:true + 当前 scene 编辑器状态**
[EditorPage.tsx:649](apps/web/src/features/editor/EditorPage.tsx#L649) 等审稿应用分支走 `PUT /api/scenes/:id` 带 `force: true`。如果用户审稿时打开的 scene **就是** reviewTargets[0]，则 server 写入会用 force 跳过 baseHash guard，**覆盖用户当前编辑器里正在打的字**（debounced save 还没保存的）。

修复需要：审稿应用前先 flush 当前 scene 的 pending save；或审稿目标 == 当前 scene 时用 baseHash 而非 force，并 422 时告诉用户「编辑器有未保存改动，请先保存」。

🔴 **章节级审稿应用失败时 partial state**
[EditorPage.tsx:636-666](apps/web/src/features/editor/EditorPage.tsx#L636) 循环对每个 scene 调 `runAiFetch('rewrite', ...)` + `PUT`。**循环 try/catch 只 console.error**（line 660），不 toast、不标记失败 scene。10 个 scene 中 3 个失败，用户只看到 "已应用到 7 个场景"，**不知道是哪 3 个**。

🟡 **`applyAcceptedText` 在 selection mode 下用 `content.replace(selectionText, text)`**
[EditorPage.tsx:618](apps/web/src/features/editor/EditorPage.tsx#L618)。如果 `selectionText` 在用户接受前已经被其他操作改了（比如 AI 在 panel 里流式生成时，`content` 也被更新过），`replace` 可能不命中或命中错位置。**实际触发条件很罕见**（panel 操作期间选区文本改变），但未保护。

🔴 **`handleSaveToWorld` N+1 查询**
[AiPanel.tsx:166](apps/web/src/features/ai/AiPanel.tsx#L166) 对每个 character 都重新 `worldApi.listCharacters(projectId)`，**每个 character 多发一次 list 请求**。worldElement / timeline / foreshadow / conflict 同理。AI 返回 10 个人物 + 8 个设定 + 5 个时间线事件 = 23 次冗余 list 请求。

🟡 **重复 AI 提取 → character.notes 累积**
[AiPanel.tsx:171](apps/web/src/features/ai/AiPanel.tsx#L171) `mergedNotes = existingNotes + '\n\n---\n\n' + newNotes`。两次提取后 notes 变 `a\n\n---\n\nb\n\n---\n\nc`，无去重。**用户问过类似问题**：当前 voiceProfile 是覆盖模式（你已选），但 notes 字段是追加模式，两套策略不一致。

🟡 **`extract` 空 reviewText 不会报错**
[EditorPage.tsx:629](apps/web/src/features/editor/EditorPage.tsx#L629) 已有 `if (!reviewText || !sceneId) return` 静默 return。**用户点"保存到设定"按钮后没反应**，不知道是按钮坏了还是 reviewText 是空。

⚪ **chapter 审稿 + 切换章节 应用顺序**
新代码用 `reviewTargets` snapshot，应用顺序与 snapshot 时一致，**与当前 chapter 无关**。这是正确行为。

---

## 4. 恢复横幅流程

### 4.1 数据来源
[EditorPage.tsx:107-119](apps/web/src/features/editor/EditorPage.tsx#L107) 在 scene.data?.id 变化时 fetch 该 scene 的 streaming 草稿列表，取第一个设到 `recoverDraft`。

### 4.2 已修复

🟢 **「恢复」只打开空 AI Panel**
之前 `recoverFromDraft` 链路死了，恢复按钮调 `handleOpenAi()` 只是打开空 panel，**已生成内容完全不可见**。现在恢复横幅扩展为完整面板：显示文本预览 + 「丢弃」「接受（X 字）」双按钮；接受走 `applyAcceptedText`（与 AI sidebar 接受共用路径）。AI 编辑功能已迁移为常驻 `AiSidebar`（2026-06-26），所以「重新生成」按钮被移除 — 用户直接在 sidebar 重新触发即可。**已修复**。

### 4.3 真实漏洞

🔴 **scene 快速切换 → 旧 scene 的 `listByScene` 回调覆盖新 scene 的 `recoverDraft`**
[EditorPage.tsx:113-115](apps/web/src/features/editor/EditorPage.tsx#L113) 是 fire-and-forget（`void draftsApi.listByScene(...).then(...)`），**没有 AbortController 也没有 cleanup**。如果用户从 scene A 切到 scene B：
1. scene A 切走，effect 跑（旧 scene 流程）：`setRecoverDraft(undefined)`
2. scene B 切到，effect 跑（新 scene 流程）：fetch B 的 drafts（pending）
3. 如果此时用户在 A 切到 B 之前就触发了新草稿（A 上还有 streaming draft），A 的 listByScene 回调**可能在 B 之后返回**，用 A 的 inflight 覆盖 B 的 recoverDraft

修复：把 sceneId 闭包到 effect 的 cleanup 检查里，或用 AbortController 中断旧请求。

🟡 **多 streaming 草稿时只显示一个**
[draftsApi.listByScene](apps/web/src/features/ai/draftsApi.ts#L37) 返回数组，代码 `drafts.find((d) => d.status === 'streaming')`（line 114）只取第一个。**两个并行 streaming draft 时第二个不可见**。日常 UI 上不容易触发（Limiter max 2 但通常只有 1 个在跑），但理论上存在。

🟡 **新生成完成后未自动清除 recoverDraft**
如果 `recoverDraft` 已显示，用户在 AI Panel 里开始新一轮生成（[handleOpenAi](apps/web/src/features/editor/EditorPage.tsx#L124) 同样查 streaming drafts 并设置），**新草稿会覆盖旧草稿**，旧草稿如果还在 server 是 orphan 状态无人清理。

⚪ **recoverDraft 与 AI Panel 状态的关系**
两边独立，互不影响。AI Panel 不会消费 recoverDraft（[AiPanel.tsx:28-37](apps/web/src/features/ai/AiPanel.tsx#L28) 注释已明确）。

---

## 5. 世界面板 / 角色流程

### 5.1 角色 CRUD
[apps/web/src/features/world/WorldPanel.tsx](apps/web/src/features/world/WorldPanel.tsx) 路径有三条：
1. 用户手动：`CharacterForm` → `worldApi.createCharacter / updateCharacter`
2. AI 生成新角色：WorldPanel `AiGenerateSection mode="generate_character"` → `handleAiGenerated`（line 191）→ createCharacter
3. AI 从场景提取：AiPanel `handleSaveToWorld`（[AiPanel.tsx:140](apps/web/src/features/ai/AiPanel.tsx#L140)）→ updateCharacter / createCharacter

### 5.2 真实漏洞

🔴 **N+1 查询（与 3.3 重复）**
见 3.3 节。

🔴 **手动保存与 AI 同时写同一角色**
无乐观锁、无版本号、last-write-wins。用户手动编辑角色时如果 AI 提取也在跑同一角色，**任一方的更改可能丢失**。

🟡 **`handleSaveToWorld` 的 `notes` 追加逻辑**
[AiPanel.tsx:171](apps/web/src/features/ai/AiPanel.tsx#L171) 已分析。多次提取累积 `---` 分隔的 notes，没有去重/语义合并。

🟡 **`analyze_voice` mode 不在 extract 流程里走 voiceProfile 字段**
[AiPanel.tsx](apps/web/src/features/ai/AiPanel.tsx) `handleSaveToWorld` 不处理 `analyze_voice` mode——所以通过 AI Panel 跑的 analyze_voice **不会**走到世界数据库（只能通过 EditorPage 的 [EditorPage.tsx:1270-1297](apps/web/src/features/editor/EditorPage.tsx#L1270) 处理）。AI Panel 的 mode 列表里也没有 analyze_voice，所以实际不会触发。但属于**未文档化的语义**——开发者以为 analyze_voice 跟其他生成模式一样支持保存，实际不行。

---

## 6. 大纲 CRUD

### 6.1 已修复

🟢 **`addVolume` 实际存在**
之前怀疑 OutlineTree 调用了未定义的 addVolume；实际 [EditorPage.tsx:353-368](apps/web/src/features/editor/EditorPage.tsx#L353) 定义了 `addVolume` mutation，`onAddVolume={() => addVolume.mutate()}`（[line 977](apps/web/src/features/editor/EditorPage.tsx#L977)）合法。**已确认无问题**。

### 6.2 真实漏洞

🔴 **slug 撞了 → 500 而非 409**
[errors.ts:34](apps/server/src/errors.ts#L34) 未捕获 SQLite UNIQUE 错误，统一返 500。`addChapter` 用 `'ch-' + Date.now().toString(36)`（[line 278](apps/web/src/features/editor/EditorPage.tsx#L278)）同毫秒连点会撞，但**对话框输入有自然节流**，日常不触发。

🟡 **orderIndex 没有唯一约束**
见 2.4。SQLite 没有 `(parent_id, order_index)` UNIQUE，理论并发添加可制造非确定性顺序。

🟡 **`createScene` 没有事务**
INSERT scenes + 返回 row 不在事务里。如果 INSERT 成功但后续 `getScene(id)` 返回 undefined（极小概率，但 SQLite 没 promise），调用方拿到 undefined，**后续 PUT 会因为找不到 scene 失败**。

---

## 7. 自动保存 / 防抖保存

### 7.1 正常路径
[apps/web/src/hooks/useDebouncedSave.ts](apps/web/src/hooks/useDebouncedSave.ts) 800ms 防抖 + 5 分钟自动 snapshot。

### 7.2 真实漏洞

🔴 **baseHash 拿到的是「最近一次成功 save 时的 hash」**
[EditorPage.tsx:217](apps/web/src/features/editor/EditorPage.tsx#L217)（`setBaseHash`）只在 save success 时更新。**如果中间发生任何 422（外修改检测）**，baseHash 不会更新，下一次防抖 save 用旧 baseHash 仍然 422。**用户被迫手动 reload**——这是「外部修改检测」修复前的根本问题；现在虽然不会弹窗，但 422 错误处理路径可能静默失败。

🔴 **手动保存与防抖保存可并发触发**
[EditorPage.tsx:236-238](apps/web/src/features/editor/EditorPage.tsx#L236) `saveNow` 与 debounce timer 都会调 `save(content)`，**没有互斥**。两个请求并发 → saveScene 收到两次相同内容，两次 daily_log 累加（与 2.3 同问题）。

🔴 **`useDebouncedSave` 在 AI 流式生成期间也触发**
AI Panel 流式输出期间如果用户切换场景，[useDebouncedSave.ts:18](apps/web/src/hooks/useDebouncedSave.ts#L18) 会用「编辑器当前 content」（旧 scene 的内容）触发 PUT，**不会**写入新场景。但 baseHash 还是旧 scene 的值，**有可能写到错误的 scene**（取决于 fetch 时机）。

🟡 **5 分钟自动 snapshot 计时器**
[EditorPage.tsx:254-267](apps/web/src/features/editor/EditorPage.tsx#L254) `setInterval` 5 分钟。**未在 unmount 时清理**（依赖 cleanup），多个组件实例时多个 timer。

🟡 **`saveState` 状态被并发 save 互相覆盖**
两个 save 并发时，第二个的 success 把第一个的 `saving` 状态覆盖为 `saved`，**第一个的真实失败被吞掉**。

---

## 8. 骨架生成流程（已移除）

🟢 **整个骨架生成流程已移除（2026-06-25）**
`SkeletonGenerator` 和 `generate_novel_skeleton` 模式已被移除。替代方案是 `StoryArcGenerator`，使用 `plan_story_arc` 模式直接生成 Markdown 故事弧线笔记（保存到 `projects.story_arc_notes`），不再需要 JSON 提取、dummy sceneId 或 `noSceneNeeded` 特殊路径。

所有相关漏洞已通过移除功能解决：
- 🔴→🟢 dummy sceneId=1 风险
- 🟡→🟢 骨架 JSON 解析失败无重试
- 🟡→🟢 骨架生成的 character/setting 没去重

---

## 9. Provider / 配置

[apps/server/src/ai/registry.ts](apps/server/src/ai/ai/registry.ts) Provider 注册中心。

### 9.1 真实漏洞

🔴 **`registry.load()` 不捕获 JSON 解析错误**
[registry.ts:14](apps/server/src/ai/registry.ts#L14) `JSON.parse(...)` 抛错不被 try/catch 包裹（只 catch ENOENT）。**配置文件被损坏时 server 启动失败**——这是部署期的问题，但启动失败后恢复路径不友好。

🟡 **`removeProvider` 不会清理 in-flight stream**
[registry.ts:66-75](apps/server/src/ai/registry.ts#L66) 删了默认 provider 后**正在跑的流**还在用已删除的 provider 对象继续发送请求；新请求会拿到 409 但旧请求不受影响。**长期不释放的资源**。

⚪ **`FakeAiProvider` 不可达**
[registry.ts:42](apps/server/src/ai/registry.ts#L42) 当 provider 不存在时返回 FakeAiProvider fallback，**但 ai.ts:64 已经抛 409**。fallback 是死代码。可考虑删除以避免误导后续维护者。

---

## 10. 变更日志（影响逻辑的近期修复）

| 轮次 | 主题 | 关键文件 |
| --- | --- | --- |
| 1 | 外部修改检测误报（diffScanner 自写回环） | [selfWriteRegistry.ts](apps/server/src/manuscripts/selfWriteRegistry.ts)、[diffScanner.ts](apps/server/src/manuscripts/diffScanner.ts)、[io.ts](apps/server/src/manuscripts/io.ts) |
| 2 | 人物增加独立 voiceProfile 字段 | [migrations.ts:189](apps/server/src/db/migrations.ts#L189)、[world.ts](apps/server/src/routes/world.ts)、[prompts.ts](packages/shared/src/prompts.ts) |
| 3 | 三处交互痛点（骨架一致性 / 审稿目标漂移 / 提取与审稿耦合） | [context.ts](apps/server/src/ai/context.ts)、[EditorPage.tsx](apps/web/src/features/editor/EditorPage.tsx) |
| 4 | AI 中断恢复横幅扩展 | [EditorPage.tsx](apps/web/src/features/editor/EditorPage.tsx)、[AiPanel.tsx](apps/web/src/features/ai/AiPanel.tsx) |

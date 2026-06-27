import type { ChatMessage, CompletionMode } from './ai.js'

export interface ModePrompt {
  system: string
  buildUser: (inputText: string, contextText: string) => string
  /**
   * Soft upper bound on the *output* size, in tokens, for this mode. Used
   * for two things:
   * - The web client's progress bar (`state.progressPct`) needs a denominator
   *   to convert streamed text length into a percentage. Without this, the
   *   bar sits at 0% for the whole stream and only jumps to 100% at the end.
   * - Server can optionally pass this through to the provider's `max_tokens`
   *   parameter to cap runaway generation.
   *
   * Tuned to ~1.3 tokens per Chinese character (typical CJK tokenization)
   * with 50% headroom over the prompt's stated word cap so the bar reaches
   * 100% at the prompt's natural endpoint rather than running off the top.
   */
  maxOutputTokens: number
}

const COMMON_SYSTEM =
  'You are a skilled Chinese-language novel writing assistant. Stay in the established style, POV, and tense. Do not output meta commentary. Output only the requested prose.'

export const MODE_PROMPTS: Record<CompletionMode, ModePrompt> = {
  continue: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Continue the scene below in the same style. Do not repeat prior text. Keep it under 400 Chinese characters.\n\n[Context]\n${ctx}\n\n[Continue from]\n${input}`,
    maxOutputTokens: 800,
  },
  polish: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Polish the following passage. Keep the meaning, voice, and approximate length. Do not add new plot points.\n\n[Context]\n${ctx}\n\n[Passage]\n${input}`,
    maxOutputTokens: 4000,
  },
  rewrite: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Rewrite the following passage with the same meaning and length, but with fresher wording.\n\n[Context]\n${ctx}\n\n[Passage]\n${input}`,
    maxOutputTokens: 4000,
  },
  expand: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Expand the following passage to roughly 1.5x–2x its length by adding sensory detail, interiority, and pacing. Keep all existing plot beats.\n\n[Context]\n${ctx}\n\n[Passage]\n${input}`,
    maxOutputTokens: 8000,
  },
  condense: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Condense the following passage to roughly half its length while keeping the essential beats.\n\n[Context]\n${ctx}\n\n[Passage]\n${input}`,
    maxOutputTokens: 2000,
  },
  generate_scene: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `Write a complete scene based on the description below. Match the style and tone of the existing story context. Write 800–1500 Chinese characters. Output only the scene prose, no headings or commentary.\n\n[Story Context]\n${ctx}\n\n[Scene Description]\n${input}`,
    maxOutputTokens: 3000,
  },
  generate_chapter: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `根据下面的大纲写一个完整章节。

**严格遵循以下格式**：
- 每个场景以一行 \`### <场景标题>\` 开头
- 紧接场景标题后是该场景的正文段落
- 段落之间用空行分隔
- 场景之间用空行分隔
- 不要使用 # 或 ## 标题，只用 ### 标记场景
- 不要任何前言、后记或元注释
- 必须按照输入中指定的场景数量输出场景（一个 \`###\` 标题对应一个场景）

**示例格式**：

### 客栈初见

狂风卷着黄沙拍打窗棂，李逍遥握紧手中的剑。
他刚踏入这家破旧客栈，便感到几道锐利的目光投来。

### 暗流涌动

柜台后掌柜的嘴角微微上扬，手指轻敲桌面的暗号。
角落里，一个黑袍人缓缓抬起头，露出一双金色瞳孔。

[故事背景]
${ctx}

[章节大纲]
${input}`,
    maxOutputTokens: 8000,
  },
  consistency_check: {
    system:
      'You are a novel world-building extraction assistant. Your sole task is to read the provided scene/chapter text and extract entities into a strict JSON object. Do NOT perform consistency analysis, evaluation, or critique. Do NOT write prose or commentary. Output ONLY the JSON object — your entire response must start with `{` and end with `}`.',
    buildUser: (input, ctx) =>
      `任务:从以下小说文本中,提取可保存到世界观数据库的结构化信息,输出严格的 JSON。

【核心约束】
- 这是**提取任务**,不是分析任务,不是评估任务。
- **不要做一致性分析**（不要输出"通过/注意/不一致"之类的判断,不要 report 字段）。
- 字段缺失时填空数组(空数组),不要用散文解释。
- 所有字段用中文。

【输出 Schema】

{
  "characters": [
    { "name": "姓名", "aliases": [], "appearance": "外貌(从文本中直接提取)", "personality": "性格(从文本中直接提取)", "background": "背景(从文本中直接提取)", "relationships": "关系(从文本中直接提取)", "voiceProfile": "语音档案:说话风格 / 用词特征 / 语气特点 / 口头禅 / 句式习惯 / 情感表达方式" }
  ],
  "worldElements": [
    { "name": "名称", "category": "location/organization/item/concept/rule", "description": "描述(从文本中直接提取)" }
  ],
  "timeline": [
    { "title": "事件标题", "era": "时间标记", "description": "事件描述(从文本中直接提取)" }
  ],
  "foreshadows": [
    { "title": "伏笔标题", "description": "描述", "status": "planted/revealed/resolved" }
  ],
  "conflicts": [
    { "title": "冲突标题", "type": "person_vs_person/person_vs_self/person_vs_society/person_vs_nature/person_vs_fate", "description": "冲突概述", "setup": "铺垫", "escalation": "升级", "climax": "高潮", "resolution": "解决" }
  ]
}

【提取规则】
- characters:从文本中明确列出的人物提取(姓名 + 性格 + 关系等字段)。未提及的字段填空字符串。没列出的人物不要造。
- worldElements:从文本中提到的地点/组织/物品/概念/规则提取,未提及的不要造。
- timeline:从文本中提到的时间标记(年份、季节、相对时间)提取事件。
- foreshadows/conflicts:从文本中暗示或明示的伏笔/冲突线索提取。

【注意】
- 只输出 JSON,不要 markdown 代码块。
- 不要任何前言、后记、评估报告。
- 不要使用 \`thinking\` / \`<think>\` 等标签。
- 如果文本中没有可提取的信息,所有数组输出空数组。

【已有设定(用于去重参考,不要重复提取已在设定中的内容)】
${ctx}

【文本内容】
${input}`,
    maxOutputTokens: 16000,
  },
  generate_character: {
    system: 'You are a novel character designer. Output valid JSON only, no markdown code blocks.',
    buildUser: (input, ctx) =>
      `根据以下描述和故事背景，生成一个详细的人物卡。输出严格的JSON格式（不要markdown代码块）：

{
  "name": "姓名",
  "aliases": ["别名1", "别名2"],
  "appearance": "外貌描写",
  "personality": "性格特点",
  "background": "人物背景",
  "relationships": "与其他人物的关系",
  "voiceProfile": "语音档案：说话风格 / 用词特征 / 语气特点 / 口头禅 / 句式习惯 / 情感表达方式"
}

[故事背景]
${ctx}

[人物描述]
${input}`,
    maxOutputTokens: 2000,
  },
  generate_world: {
    system: 'You are a novel worldbuilding assistant. Output valid JSON only, no markdown code blocks.',
    buildUser: (input, ctx) =>
      `根据以下描述和故事背景，生成一个世界观设定。输出严格的JSON格式（不要markdown代码块）：

{
  "name": "设定名称",
  "category": "location/organization/item/concept/rule",
  "description": "详细描述",
  "notes": "补充说明"
}

[故事背景]
${ctx}

[设定描述]
${input}`,
    maxOutputTokens: 2000,
  },
  generate_timeline: {
    system: 'You are a novel timeline designer. Output valid JSON only, no markdown code blocks.',
    buildUser: (input, ctx) =>
      `根据以下描述和故事背景，生成一个时间线事件。输出严格的JSON格式（不要markdown代码块）：

{
  "title": "事件标题",
  "era": "时间标记（如：第一章、三年前、古代）",
  "description": "事件详细描述",
  "notes": "补充说明"
}

[故事背景]
${ctx}

[事件描述]
${input}`,
    maxOutputTokens: 1500,
  },
  generate_foreshadow: {
    system: 'You are a novel plot designer specializing in foreshadowing. Output valid JSON only, no markdown code blocks.',
    buildUser: (input, ctx) =>
      `根据以下描述和故事背景，生成一个伏笔/线索。输出严格的JSON格式（不要markdown代码块）：

{
  "title": "伏笔标题",
  "description": "伏笔内容描述",
  "status": "planted",
  "notes": "伏笔的预期揭示方式和时机"
}

[故事背景]
${ctx}

[伏笔描述]
${input}`,
    maxOutputTokens: 1500,
  },
  generate_conflict: {
    system: 'You are a novel conflict designer specializing in dramatic tension. Output valid JSON only, no markdown code blocks.',
    buildUser: (input, ctx) =>
      `根据以下描述和故事背景，生成一个冲突/矛盾。输出严格的JSON格式（不要markdown代码块）：

{
  "title": "冲突标题",
  "type": "person_vs_person/person_vs_self/person_vs_society/person_vs_nature/person_vs_fate",
  "description": "冲突概述",
  "setup": "冲突的铺垫阶段",
  "escalation": "冲突的升级阶段",
  "climax": "冲突的高潮阶段",
  "resolution": "冲突的解决阶段",
  "notes": "补充说明"
}

[故事背景]
${ctx}

[冲突描述]
${input}`,
    maxOutputTokens: 2000,
  },
  suggest_next_chapter: {
    system: COMMON_SYSTEM,
    buildUser: (input, ctx) =>
      `你是一个小说编辑。请根据以下信息，为下一章生成一个简要的大纲。

**要求：**
- 输出下一章的概要（3-5 句话）
- 说明本章要推进的主要情节
- 标注涉及的关键人物和冲突
- 保持与当前故事的连贯性

**输出格式（纯文本，不要 JSON）：**
[章节标题]
[一句话标题]

[概要]
[3-5 句话的章节概要]

[关键冲突]
[本章要推进的冲突]

[涉及人物]
[出场的主要人物]

[故事背景]
${ctx}

[当前章节内容摘要]
${input}`,
    maxOutputTokens: 1000,
  },
  auto_review: {
    system: 'You are a senior novel editor providing detailed, constructive feedback. Write all feedback in Chinese.',
    buildUser: (input, ctx) =>
      `请审阅以下场景内容，从多个维度给出专业反馈。用中文回答。

[故事背景]
${ctx}

[待审阅场景]
${input}

请从以下几个维度进行审阅，每个维度给出具体分析和改进建议：

## 一致性检查
检查场景与已有世界观、人物设定、时间线是否矛盾。

## 节奏分析
分析场景的节奏感：是否有张弛有度？对话与叙述的比例是否合适？是否有拖沓或过于仓促的部分？

## 人物刻画
评估人物的言行是否符合其性格设定？是否有出戏或不符合角色的表现？

## 伏笔与冲突
评估场景中的伏笔埋设和冲突推进是否到位？是否有机会加强？

## 改进建议
给出 2-3 条具体的修改建议，每条建议包含：问题描述 + 修改方向 + 示例`,
    maxOutputTokens: 4000,
  },
  plan_story_arc: {
    system: 'You are a master novelist and story architect. Write all output in Chinese.',
    buildUser: (input, ctx) =>
      `根据以下已有的故事设定和大纲信息，规划一个完整的多卷多章故事弧线。用中文输出。

要求：
- 规划 3-5 卷，每卷 3-5 章
- 每章用 2-3 句话概述情节
- 标注每卷的核心冲突和高潮
- 标注伏笔的埋设和揭示位置
- 标注人物成长的关键转折点
- 标注各卷的情绪节奏（紧张/舒缓交替）

请用以下格式输出：

# 故事弧线规划

## 第一卷：[卷名]
**核心冲突**：[一句话]
**情绪节奏**：起-承-转-合

### 第1章：[章标题]
[概述]

### 第2章：[章标题]
[概述]
...

## 伏笔布局
- [伏笔1] → 埋设于第X卷第Y章，揭示于第X卷第Y章
- [伏笔2] → ...

## 人物成长线
- [角色名]：[成长弧线描述]

[故事背景]
${ctx}

[已有大纲]
${input}`,
    maxOutputTokens: 8000,
  },
  analyze_voice: {
    system: 'You are a dialogue specialist and character voice analyst. Write all output in Chinese.',
    buildUser: (input, ctx) =>
      `分析以下场景中每个人物的对话风格，生成「语音档案」。

请为每个有对话的人物输出以下格式：

## [人物名]

**说话风格**：[整体风格描述，如：正式/口语化/文雅/粗犷/幽默/严肃]

**用词特征**：[偏好的词汇类型，如：喜欢用成语/爱用俚语/经常夹杂方言]

**语气特点**：[常见的语气，如：温柔/强硬/犹豫/自信]

**口头禅**：[人物常用的口头语或习惯用语]

**句式习惯**：[说话的句式特征，如：喜欢用反问句/经常用短句/喜欢长篇大论]

**情感表达方式**：[如何表达情感，如：含蓄内敛/直接外放/冷幽默]

---

如果某个人物没有对话或对话较少，简要说明即可。

[故事背景]
${ctx}

[待分析场景]
${input}`,
    maxOutputTokens: 6000,
  },
}

export function buildMessages(
  mode: CompletionMode,
  systemOverride: string,
  contextText: string,
  inputText: string,
): ChatMessage[] {
  const p = MODE_PROMPTS[mode]
  return [
    { role: 'system', content: systemOverride.trim() || p.system },
    { role: 'user', content: p.buildUser(inputText, contextText) },
  ]
}

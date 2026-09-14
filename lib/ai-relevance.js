// AI 相关性词表（2026-09-14：实时流=AI 信息实时流，从全源只挑 AI 相关内容）
// 共享模块：api/[...slug].js（/api/hot 过滤）与 tools/collect-turso.js（翻译优先级 P1）同用一份，改动必须同步语义。
// 口径：AI 主题分组源全收；其余源按标题命中词表。
// LIKE（大小写不敏感）只放无歧义长词；短缩写走 GLOB（大小写敏感）防误伤——RAG 不匹配 garage；
// 裸「AI」走词边界 GLOB，防匹配 SAID/CHAIR/EMAIL 等。
const AI_GROUP_COND = "(UPPER(COALESCE(g.name,'')) LIKE '%AI%' OR g.name LIKE '%人工智能%')";
const AI_KW_LIKE = [
  // 中文主题词
  '人工智能', '大模型', '大语言模型', '智能体', '具身智能', '机器学习', '深度学习', '神经网络',
  '多模态', '文生图', '文生视频', '图生视频', '提示词', '推理模型', '开源模型', '预训练', '扩散模型',
  '世界模型', '强化学习', '数字人', '蒸馏', '算力',
  // AI+场景复合词（AI 开头的中文复合词无歧义）
  'AI编程', 'AI 编程', 'AI应用', 'AI 应用', 'AI助手', 'AI 助手', 'AI搜索', 'AI视频', 'AI 视频',
  'AI绘画', 'AI生成', 'AI智能', 'AI时代', 'AI创业', 'AI产品', 'AI公司', 'AI芯片', 'AI眼镜',
  'AI玩具', 'AI短剧', 'AI音乐', 'AI医疗', 'AI教育', 'AI安全', 'AI治理', 'AI落地', 'AI爆发',
  // 品牌/产品/人物（Distinctive，子串误伤≈0）
  'OpenAI', 'ChatGPT', 'Claude', 'Anthropic', 'Gemini', 'DeepSeek', 'Qwen', '通义', 'Llama',
  'Mistral', 'Copilot', 'Midjourney', 'Suno', 'Runway', 'Pika', 'Kling', '可灵', '即梦', '豆包',
  '文心', '混元', '智谱', 'Kimi', '月之暗面', 'Grok', 'Perplexity', 'Hugging Face', 'HuggingFace',
  'Codex', 'Cursor', 'Manus', 'Windsurf', '商汤', '讯飞', 'Ollama', 'LangChain', 'Transformer',
  'ComfyUI', 'SGLang', 'Veo', 'Imagen', 'ElevenLabs', 'HeyGen', '阶跃星辰', 'MiniMax', '面壁智能',
  '百川智能', '零一万物', 'Cohere', 'Altman', '黄仁勋', 'Karpathy', '李飞飞', 'Hassabis',
  'Sutskever', '吴恩达', '何恺明', 'Jim Fan', '杨植麟',
];
const AI_KW_GLOB = ['GPT', 'LLM', 'RAG', 'MCP', 'AGI', 'AIGC', 'VLM', 'LoRA', 'RLHF', 'MoE', 'Sora', 'vLLM'];
// 裸 AI 边界形态：句首/句尾/两侧空白/常见中英标点
const AI_BARE_GLOB = ['AI *', '* AI', '* AI *', '*AI:*', '*AI：*', '*AI、*', '*AI·*', '*AI-*', '*-AI *', '*「AI*', '*AI」*'];

// SQLite 表达式树深度上限 100（坑 #31）：上百个 OR 连成左深链会爆
//（SQLITE_UNKNOWN: Expression tree is too large）→ 平衡二叉树拼接，深度 ≈ log2(N)+2
function orTree(parts) {
  if (!parts.length) return '1=0';
  if (parts.length === 1) return parts[0];
  const mid = parts.length >> 1;
  return `(${orTree(parts.slice(0, mid))} OR ${orTree(parts.slice(mid))})`;
}

// 生成「字段命中 AI 词表」的 SQL 片段（平衡树），args 副作用收集绑定参数
function aiTitleConds(field, args) {
  const parts = [];
  for (const kw of AI_KW_LIKE) { parts.push(`${field} LIKE ?`); args.push(`%${kw}%`); }
  for (const kw of AI_KW_GLOB) { parts.push(`${field} GLOB ?`); args.push(`*${kw}*`); }
  for (const p of AI_BARE_GLOB) { parts.push(`${field} GLOB ?`); args.push(p); }
  return orTree(parts);
}

// 完整 AI 相关条件（分组全收 OR 标题命中）；调用方需保证 sources 别名 s、groups 别名 g 已 JOIN
function aiRelevanceCond(args) {
  return `(${AI_GROUP_COND} OR ${aiTitleConds('a.title', args)})`;
}

module.exports = { AI_GROUP_COND, AI_KW_LIKE, AI_KW_GLOB, AI_BARE_GLOB, orTree, aiTitleConds, aiRelevanceCond };

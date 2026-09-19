// 每日早报的栏目表 —— **唯一实现**（B10 + AGENTS §1 三端口径）
//
// 为什么要抽出来：同一张表此前抄了三份，且三份已经漂了——
//   api/daily-generate.js 与 tools/collect-turso.js 写 desc='课程/训练营/社群招募'，
//   server/services/ai/daily.js 却写 desc='Codex、Claude、豆包…等动向'（把关键词数组复述一遍）。
//   本地那份生成的报告同步进云端后，线上 AI 版早报就显示着"关键词版栏目注解"（= 用户批注 B10）。
// 口径：desc 是**给人看的栏目说明**，不是关键词清单；关键词只用于匹配，不参与呈现。
const DEFAULT_COLUMNS = [
  {
    id: 'c1',
    name: '培训课程发布',
    desc: '新公开的课程、训练营与社群招募',
    keywords: ['课程', '训练营', '社群', '招募', '培训'],
  },
  { id: 'spotlight', name: '重点更新', special: 'spotlight' },
  {
    id: 'c2',
    name: 'AI技术',
    desc: '模型、Agent 与工程链路的技术动向',
    keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'],
  },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];

// 同一批三端副本里的另两项：入报源类型集合（此前也各抄一份，改一处必漏两处）
const ARTICLE_SOURCE_TYPES = ['wechat', 'rss', 'x'];
const VIDEO_SOURCE_TYPES = ['bilibili', 'douyin', 'youtube'];

module.exports = { DEFAULT_COLUMNS, ARTICLE_SOURCE_TYPES, VIDEO_SOURCE_TYPES };

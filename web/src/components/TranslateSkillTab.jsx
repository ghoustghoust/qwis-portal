// 翻译 Skill（T3-8 批次5：按用户已拍 C 方案改为只读展示+指引）
// 之前是可写壳：保存提示词/批量翻译/功能开关全走 /api/ai/translate/*，云端无这些路由（仅本地
// Express 提供），点了必 404——"改了它会什么都不写的控件不进界面"，写操作全部摘除。
// 云端化翻译配置端点（C+A 的 A 半）待立项，立项后本区块恢复可写。
export default function TranslateSkillTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold t-text">翻译</h2>
        <p className="text-sm t-muted">只读 · 配置入口在本地端管理台</p>
      </div>

      <section className="card p-5 space-y-3 text-sm leading-relaxed">
        <h3 className="font-semibold t-text text-sm">翻译现在怎么跑</h3>
        <ul className="list-disc pl-5 space-y-1.5 t-text">
          <li>翻译跑在 <strong>GH runner 的采集批次</strong>里（tools/collect-turso.js 翻译档），直写云端库；云端读层没有翻译配置的路由。</li>
          <li>提示词只有一份实现，由统一 AI 通道按管线加载（api/_ai.js 的 loadPrompt）；本地端管理台可编辑。</li>
          <li>配额优先级：早报 / 周刊生成 <strong>&gt; 翻译</strong>——生成窗口前后翻译批次自动缩小上限（可为 0），窗口外恢复。</li>
          <li>调用统计（次数 / 失败 / 耗时）进统一 AI 通道的统计环，看「AI 配置」板块的「各管线用量」。</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3 text-sm leading-relaxed">
        <h3 className="font-semibold t-text text-sm">要改配置去哪</h3>
        <ul className="list-disc pl-5 space-y-1.5 t-text">
          <li>提示词编辑、翻译开关、自动翻译：<strong>本地端管理台</strong>的翻译页（server/routes/ai.js 提供）。</li>
          <li>云端管理台暂不提供翻译配置写入口——不是坏了，是云端化改造（A 半）待立项；立项后本区块恢复可写。</li>
        </ul>
      </section>
    </div>
  );
}

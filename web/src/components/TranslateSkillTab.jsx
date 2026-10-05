// 翻译配置（T3-9 云端化落地）：云端管理台直接配置——开关/自动翻译/runner 三档提示词
// （translate / translate-refine / translate-polish）。写面按 BL9 同口径：审计+变更告警。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import InfoTip from './InfoTip.jsx';

const PROMPT_TABS = [
  { key: 'promptTranslate', field: 'translate', label: '初翻', note: '原文 → 初译' },
  { key: 'promptRefine', field: 'refine', label: '精翻', note: '初译 → 术语对齐' },
  { key: 'promptPolish', field: 'polish', label: '润色', note: '术语对齐 → 成稿' },
];

export default function TranslateSkillTab() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [promptTab, setPromptTab] = useState('promptTranslate');

  const load = useCallback(async () => {
    try {
      setCfg(await api.get('/api/ai/translate/config'));
    } catch (e) {
      toast('加载失败: ' + e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setBusy('save');
    try {
      await api.put('/api/ai/translate/config', patch);
      toast('已保存');
      await load();
    } catch (e) {
      toast('保存失败: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  if (!cfg) return <div className="py-8 text-center text-sm t-muted">加载中…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold t-text">翻译</h2>
        <p className="text-sm t-muted">云端管理台直接配置 · 改动即写云端，下一批翻译生效</p>
      </div>

      {/* 开关 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">开关</h3>
          <InfoTip
            what="翻译功能的总开关与自动翻译开关。关掉后新内容不再翻译，存量译文保留。"
            how="点开关即写云端，无需再保存。"
            effect="下一个翻译批次生效（runner 每 15 分钟出队）。"
          />
        </div>
        <div className="mt-3 space-y-2.5 text-[13px]">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.enabled !== false}
              disabled={busy === 'save'}
              onChange={(e) => save({ enabled: e.target.checked })}
            />
            <span className="t-text">启用翻译功能</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.autoTranslate !== false}
              disabled={busy === 'save'}
              onChange={(e) => save({ autoTranslate: e.target.checked })}
            />
            <span className="t-text">抓到英文内容时自动翻译</span>
          </label>
        </div>
      </section>

      {/* 三档提示词 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">提示词（runner 批量翻译三档）</h3>
          <InfoTip
            what="翻译管线的三段式提示词：初翻（原文→初译）、精翻（初译→术语对齐）、润色（术语对齐→成稿）。"
            how="选档 → 改文本 → 保存。保存即写云端，下一批翻译生效；改坏可以清空内容恢复默认（留空=用系统默认提示词）。"
            effect="改动只影响新翻译的内容，已翻好的不变。"
          />
        </div>
        <div className="mt-3 flex gap-1.5 border-b t-border pb-2">
          {PROMPT_TABS.map((t) => (
            <button
              key={t.key}
              className={`pill !px-3 !py-1.5 !text-xs cursor-pointer ${promptTab === t.key ? 'on' : ''}`}
              onClick={() => setPromptTab(t.key)}
            >
              {t.label}
              <span className="ml-1 text-[10px] t-muted">{t.note}</span>
            </button>
          ))}
        </div>
        {PROMPT_TABS.map((t) => (
          promptTab === t.key && (
            <div key={t.key} className="mt-3">
              <textarea
                className="input w-full font-mono !text-xs"
                rows={10}
                defaultValue={cfg.prompts?.[t.field] || ''}
                placeholder={`${t.label}提示词（留空=系统默认）`}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (cfg.prompts?.[t.field] || '')) save({ [t.key]: v });
                }}
              />
              <div className="mt-1.5 text-[11px] t-muted">改动在失焦时自动保存；清空内容=恢复系统默认提示词。</div>
            </div>
          )
        ))}
      </section>

      {/* 现状说明 */}
      <section className="card p-5 text-sm leading-relaxed">
        <div className="text-xs t-muted space-y-1.5">
          <div>翻译跑在 GH runner 的采集批次里（每 15 分钟出队）；生成窗口内翻译批次自动让路给早报/周刊。</div>
          <div>本地端「翻译」页（精翻档）与这里的三档互不相通——本地页编辑的是阅读器精翻，这里的三档管 runner 批量翻译。</div>
          <div>调用统计（次数/失败/耗时）看「AI 配置 → 各管线用量」。</div>
        </div>
      </section>
    </div>
  );
}

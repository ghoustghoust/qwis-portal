import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import InfoTip from './InfoTip.jsx';
import TriggerButton from './TriggerButton.jsx';

// T3-8 批次2：我的早报子板块——推送开关、探索强度、兴趣画像（只读，ADR-23）、Domain 篇数配额
// （各块自原 BriefCenterTab 迁移，逻辑未改；新增页头真触发入口）
export default function MyBriefPanel() {
  const [hist, setHist] = useState(null);
  const [mybriefCfg, setMybriefCfg] = useState(null);
  const [quotas, setQuotas] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, st] = await Promise.all([
        api.get('/api/brief/history').catch(() => null),
        api.get('/api/settings').catch(() => null),
      ]);
      setHist(h);
      setMybriefCfg(st?.mybrief || {});
      setQuotas(h?.domainQuotas || {});
    } catch (e) {
      toast('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveCfg = async (section, patch) => {
    setBusy(true);
    try {
      await api.put('/api/settings', { [section]: patch });
      toast('已保存');
      load();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-sm t-muted">加载中…</div>;

  return (
    <div className="space-y-5">
      {/* 页头：真触发入口（T3-8 批次2） */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold t-text">生成管理</div>
            <InfoTip
              what="手动触发一次我的早报重生成（含阅读足迹刷新），跑在 GitHub runner 上。"
              how="点「重新生成我的早报」并确认。改完订阅或修完配置后用它即时验证，不用等晚间批次。"
              effect="触发后几十分钟内出新一期；进度见 GitHub Actions 的 collect 运行。"
            />
          </div>
          <TriggerButton mode="mybrief" label="重新生成我的早报" confirmText="确认触发我的早报重生成？生成需几十分钟，AI 额度照常消耗。" />
        </div>
        <div className="text-[11px] t-muted">订阅源在「源库」组合视图/批量条中加入订阅（订阅轴与重点轴各自独立）；探索位按多样性选内容，不改动你的订阅集合。</div>
      </section>

      {/* 我的早报设置（原块迁移） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">推送与探索</h3>
          <InfoTip
            what="生成后是否推送到飞书（含导语与头条 3 条），以及补充阅读里来自未订阅源内容的条数。"
            how="推送是开关，保存即写库；探索强度分低/中/高（对应 2/4/6 条）。"
            effect="下一个生成批次生效。"
          />
        </div>
        <label className="mt-3 flex items-center gap-2.5 text-[13px] cursor-pointer">
          <input
            type="checkbox"
            checked={mybriefCfg?.pushEnabled !== false}
            disabled={busy}
            onChange={(e) => saveCfg('mybrief', { ...mybriefCfg, pushEnabled: e.target.checked })}
          />
          生成后推送到飞书（含导语与头条 3 条）
        </label>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[13px] t-text">探索强度：</span>
          {[['low', '低（2 条）'], ['mid', '中（4 条）'], ['high', '高（6 条）']].map(([k, label]) => (
            <button
              key={k}
              className={`pill !py-1 !px-2.5 cursor-pointer ${String(mybriefCfg?.exploreStrength || 'mid') === k ? 'on' : ''}`}
              disabled={busy}
              onClick={() => saveCfg('mybrief', { ...mybriefCfg, exploreStrength: k })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* 行为画像 + Domain 篇数配额（T3-1 R5，原块迁移） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">兴趣画像（近 30 天阅读行为驱动）</h3>
          <InfoTip
            what="由你的阅读行为算出的兴趣权重，只影响「我的早报」的排序，不改变收录；系统产出、用户不可改。"
            how="无需设置——只读展示。"
            effect="每晚随早报自动更新；★ 标签参与排序加权（每命中 +8，上限 +24）。"
          />
        </div>
        {(hist?.profile?.tags || []).length === 0 ? (
          <p className="mt-2 text-xs t-muted">暂无画像——阅读文章后自动积累标签权重（每晚随早报更新）</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hist.profile.tags.map((t, i) => (
              <span key={t.tag} className="pill on !cursor-default text-[11px]" title={`权重 ${t.weight}`}>
                {t.tag}<span className="t-muted ml-1">{Math.round(t.weight)}</span>
                {i < 5 && <span className="ml-1 t-accent" title="参与我的早报排序加权">★</span>}
              </span>
            ))}
          </div>
        )}

        {(hist?.profile?.tags || []).length > 0 && (
          <div className="mt-4">
            <div className="text-[13px] font-medium t-text">Domain 篇数配额（主标签每日入报上限，留空不限）</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {hist.profile.tags.slice(0, 8).map((t) => (
                <label key={t.tag} className="flex items-center gap-1.5 text-[12px]">
                  <span className="t-muted truncate max-w-[120px]" title={t.tag}>{t.tag}</span>
                  <input
                    type="number" min="0" max="20"
                    className="input !w-16 !py-1 !text-xs"
                    value={quotas[t.tag] ?? ''}
                    placeholder="不限"
                    onChange={(e) => setQuotas((prev) => {
                      const next = { ...prev };
                      const v = e.target.value;
                      if (v === '') delete next[t.tag]; else next[t.tag] = Math.max(0, Number(v));
                      return next;
                    })}
                  />
                </label>
              ))}
            </div>
            <button
              className="btn-ghost !py-1 !px-2.5 mt-3"
              disabled={busy}
              onClick={async () => {
                try { await api.put('/api/settings', { mybrief: { ...mybriefCfg, domainQuotas: quotas } }); toast('Domain 配额已保存（次日凌晨生成生效）'); load(); }
                catch (e) { toast(e.message); }
              }}
            >
              保存配额
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import InfoTip from './InfoTip.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 订阅源卡片网格（与 DailySettingsTab 的 SelectedAvatars 同形态——图标+名字，默认收起 12 个+展开全部）
function SubGrid({ items, onManage }) {
  const [expanded, setExpanded] = useState(false);
  if (!items || !items.length) return null;
  const shown = expanded ? items : items.slice(0, 12);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
        {shown.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={onManage}
            title={`${x.name}（点按进选源器管理）`}
            className="card !p-2 flex items-center gap-1.5 min-w-0 hover:border-[var(--accent)] transition-colors cursor-pointer text-left"
          >
            <SourceAvatar name={x.name} avatar={x.avatar} size={18} />
            <span className="text-[11px] t-text truncate flex-1 min-w-0">{x.name}</span>
          </button>
        ))}
      </div>
      {items.length > 12 && (
        <button type="button" className="mt-1.5 text-[11px] t-muted hover:t-accent" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起 ▴' : `展开全部 ${items.length} 个 ▾`}
        </button>
      )}
    </div>
  );
}
import TriggerButton from './TriggerButton.jsx';
import SourcePickerModal from './SourcePickerModal.jsx';

// T3-8 批次2：我的早报子板块——推送开关、探索强度、兴趣画像（只读，ADR-23）、Domain 篇数配额
// （各块自原 BriefCenterTab 迁移，逻辑未改；新增页头真触发入口）
// 10-05 功能隔离（用户验收反馈）：订阅集合的勾选入口从源库迁到本板块——「我的早报」的源
// 在「我的早报」里管；源库只管源本身（采集/健康/分组）。
export default function MyBriefPanel() {
  const [hist, setHist] = useState(null);
  const [mybriefCfg, setMybriefCfg] = useState(null);
  const [quotas, setQuotas] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subPicker, setSubPicker] = useState(false);
  const [libItems, setLibItems] = useState([]);
  const [subscribedIds, setSubscribedIds] = useState(null); // null=未加载（区别于真 0）
  const [subPreview, setSubPreview] = useState([]); // 订阅源预览（头像堆叠用，含 name/avatar）
  const [contrib, setContrib] = useState(null); // 源贡献榜（10-05 用户点单⑥）

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, st, cb] = await Promise.all([
        api.get('/api/brief/history').catch(() => null),
        api.get('/api/settings').catch(() => null),
        api.get('/api/sources/contribution').catch(() => null),
      ]);
      setHist(h);
      setMybriefCfg(st?.mybrief || {});
      setQuotas(h?.domainQuotas || {});
      setContrib(cb);
    } catch (e) {
      toast('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 订阅集合数据（选源器打开时拉取；生效口径与我的早报消费同源——/api/sources/library 的 subscribed）
  // 订阅源预览常驻拉取（用户 10-06：不进弹窗也要看到订阅了什么的头像堆叠）
  const loadSubscribed = async () => {
    try {
      const d = await api.get('/api/sources/library');
      const items = d.items || [];
      setLibItems(items);
      const sub = items.filter((s) => s.subscribed);
      setSubscribedIds(sub.map((s) => s.id));
      setSubPreview(sub); // 含 name/avatar 供头像堆叠
    } catch { /* 拉不到不阻断 */ }
  };
  useEffect(() => { loadSubscribed(); }, []);

  const openSubPicker = async () => {
    try {
      await loadSubscribed();
      setSubPicker(true);
    } catch (e) {
      toast('加载源列表失败: ' + e.message);
    }
  };

  async function applySubscription(ids) {
    const cur = new Set(subscribedIds);
    const next = new Set(ids);
    const add = ids.filter((id) => !cur.has(id));
    const del = [...cur].filter((id) => !next.has(id));
    if (!add.length && !del.length) { setSubPicker(false); return; }
    try {
      if (add.length) {
        await api.post('/api/sources/batch', { ids: add, action: 'subscribe' });
        toast(`已订阅 ${add.length} 个源`);
      }
      if (del.length) {
        await api.post('/api/sources/batch', { ids: del, action: 'unsubscribe' });
        toast(`已退订 ${del.length} 个源`);
      }
      setSubPicker(false);
      await openSubPicker(); // 保存后刷新计数（对抗审查 D：header 别停在旧值）
    } catch (e) {
      toast('订阅更新失败: ' + e.message);
    }
  }

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
  if (!hist) return <div className="py-12 text-center text-sm t-muted">数据加载失败，请刷新重试</div>;

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
        <div className="text-[11px] t-muted">探索位按多样性选内容，不改动你的订阅集合。</div>
      </section>

      {/* 订阅来源（10-05 功能隔离迁入：从源库迁来——「我的早报」的源在这里管） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">订阅来源</h3>
          <InfoTip
            what="「我的早报」从哪些源取内容——生效口径与生成批次消费完全同源。"
            how="点「管理订阅来源」打开选源器：搜索、筛选、批量勾选，确认即生效（无需再保存）。"
            effect="保存后下一批生成即按新集合取内容；当前靠「重点」兜底进订阅的源，在你第一次保存勾选后会以本次勾选为准。"
          />
          <span className="flex-1" />
          <span className="text-xs t-muted tabular-nums">当前生效 {subscribedIds === null ? '…' : subscribedIds.length} 个</span>
          <button className="btn-primary !py-1.5 !px-4 !text-xs" onClick={openSubPicker}>管理订阅来源</button>
        </div>
        {/* 订阅源卡片网格（用户 10-06：像个栏目铺开看到订了哪些，默认收起 12 个+展开全部） */}
        <SubGrid items={subPreview} onManage={openSubPicker} />
      </section>

      {/* 源贡献榜（10-05 用户点单⑥）：近 7 天谁喂了「我的早报」——低贡献=退订候选 */}
      {contrib && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">源贡献榜（近 7 天）</h3>
            <InfoTip
              what="近 7 天各源喂进「我的早报」的条数（按每日早报生成产物聚合，已排热榜/聚合源）。"
              how="只读，随批次自动更新。"
              effect="低贡献或零贡献的订阅源就是退订候选——订阅了没喂报的源列在下方；要退订去上方「管理订阅来源」。"
            />
          </div>
          {contrib.sources.length === 0 ? (
            <div className="mt-3 text-sm t-muted">近 7 天无入报条目</div>
          ) : (
            <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {contrib.sources.map((t, i) => (
                <div key={t.name} className="flex items-center gap-2 text-xs py-1 border-b t-border/40">
                  <span className="t-muted tabular-nums w-5 flex-none">{i + 1}</span>
                  <span className="t-text truncate flex-1" title={t.name}>{t.name}</span>
                  <span className="t-muted tabular-nums flex-none">{t.count} 条</span>
                </div>
              ))}
            </div>
          )}
          {contrib.subZeroCount > 0 && (
            <div className="mt-3 pt-3 border-t t-border text-xs t-muted">
              订阅了但近 7 天零贡献（{contrib.subZeroCount}/{contrib.subscribedTotal}）：{contrib.subZero.map((x) => x.name).join('、')}{contrib.subZeroCount > 20 ? ' 等' : ''}——可去「管理订阅来源」里清掉。
            </div>
          )}
        </section>
      )}

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

      {/* 订阅选源器（打开时才拉源列表；确认即生效） */}
      <SourcePickerModal
        open={subPicker}
        title="管理订阅 ·「我的早报」来源"
        note="作用对象：「我的早报」（订阅集合）。每日早报的来源范围是另一份配置，在「每日早报」板块的来源勾选里改——两处各管各的报。"
        sources={libItems}
        selectedIds={subscribedIds === null ? [] : subscribedIds}
        showSpotlight={false}
        instantApply
        onClose={() => setSubPicker(false)}
        onConfirm={(ids) => {
          if (!window.confirm(`把订阅集合更新为 ${ids.length} 个源（现生效 ${subscribedIds === null ? '?' : subscribedIds.length} 个）？\n\n保存后「我的早报」只认本次勾选；当前靠「重点」兜底进订阅的源若未勾选将退出订阅。`)) return;
          applySubscription(ids);
        }}
      />
    </div>
  );
}

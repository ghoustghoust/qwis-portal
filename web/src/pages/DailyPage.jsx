import { useCallback, useEffect, useRef, useState } from 'react';
import { IconRail } from '../main.jsx';
import { api } from '../api';
import { toast } from '../toast';
import DailyHeader from '../components/DailyHeader.jsx';
import StatCards from '../components/StatCards.jsx';
import ColumnSection from '../components/ColumnSection.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';

// 每日情报日报页（/daily/，F13~F20）：报纸风页头 + 统计卡 + 栏目 + 快速学习弹窗
// 设置入口已下线（第二期迁入管理后台），日报设置仅剩管理后台可改
export default function DailyPage() {
  const [report, setReport] = useState(undefined); // undefined=加载中，null=尚未生成
  const [dailySettings, setDailySettings] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [autoGen, setAutoGen] = useState(false); // T13/F3：stale 打开即补的「正在生成」态
  const [notice, setNotice] = useState(''); // 生成后顶部提示条（F19）
  const [studyItem, setStudyItem] = useState(null);
  const autoGenRef = useRef(false); // 每次 mount 只自动补一次

  const regenerate = useCallback(async (isAuto) => {
    setRegenerating(true);
    if (isAuto) setAutoGen(true);
    try {
      const data = await api.post('/api/daily/regenerate');
      setReport(data?.report ?? null);
      setNotice('已生成今日情报日报。');
    } catch (e) {
      toast(e.message);
    } finally {
      setRegenerating(false);
      setAutoGen(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/daily');
      setReport(data?.report ?? null);
      // T13/F3：打开即补——今日生成时间已过且今日无日报时自动触发生成
      if (data?.stale === true && !autoGenRef.current) {
        autoGenRef.current = true;
        regenerate(true);
      }
    } catch (e) {
      setReport(null); // 后端未就绪/无日报 → 空态引导
    }
    api
      .get('/api/settings/daily')
      .then((d) => setDailySettings(d?.settings || d))
      .catch(() => setDailySettings(null));
  }, [regenerate]);

  useEffect(() => {
    load();
  }, [load]);

  const windowHours = report?.window_hours ?? dailySettings?.windowHours ?? 48;

  return (
    <div className="flex h-screen t-bg t-text overflow-hidden">
      <IconRail />
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-[1080px] mx-auto px-8 py-10">
          {/* 生成提示条（F19） */}
          {notice && (
            <div
              className="mb-6 flex items-center rounded-xl border px-4 py-2.5 text-[13px]"
              style={{
                borderColor: 'var(--green)',
                color: 'var(--green)',
                background: 'color-mix(in srgb, var(--green) 7%, var(--surface))',
              }}
            >
              <span className="flex-1">{notice}</span>
              <button className="icon-btn !w-6 !h-6 text-xs" onClick={() => setNotice('')}>
                ✕
              </button>
            </div>
          )}

          <DailyHeader
            report={report || null}
            regenerating={regenerating}
            onRegenerate={() => regenerate(false)}
          />

          {/* T13/F3：stale 打开即补的进行中提示 */}
          {autoGen && (
            <div className="mt-6 card px-6 py-10 text-center text-[13px] t-muted">
              正在生成今日情报…（会先补抓到期的订阅源，请稍候）
            </div>
          )}

          <div className="mt-8 border-t-2" style={{ borderColor: 'var(--text)' }} />

          <div className="mt-6">
            <StatCards stats={report?.stats} windowHours={windowHours} />
          </div>

          {report === undefined && (
            <div className="py-20 text-center text-sm t-muted">加载中…</div>
          )}

          {/* 空态引导 */}
          {report === null && (
            <div className="mt-6 card px-6 py-16 text-center">
              <div className="serif text-xl font-bold t-text">还没有生成日报</div>
              <div className="mt-3 text-[13px] t-muted leading-relaxed">
                点击右上角「重新生成」按钮，立即生成第一份每日情报；
                <br />
                之后每天会按「每日生成时间」自动生成。
              </div>
              <button
                className="btn-primary mt-6"
                style={{ background: 'var(--green)' }}
                disabled={regenerating}
                onClick={() => regenerate(false)}
              >
                {regenerating ? '生成中…' : '重新生成'}
              </button>
            </div>
          )}

          {/* 栏目区（F15） */}
          {report && (
            <div className="mt-8 flex flex-col gap-10">
              {(report.sections || []).map((sec, i) => (
                <ColumnSection
                  key={`${sec.column}-${i}`}
                  section={sec}
                  onOpen={setStudyItem}
                />
              ))}
              {(!report.sections || report.sections.length === 0) && (
                <div className="card px-4 py-10 text-center text-xs t-muted">
                  这一栏暂时没有命中内容
                </div>
              )}
            </div>
          )}

          <div className="h-16" />
        </div>
      </main>

      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}

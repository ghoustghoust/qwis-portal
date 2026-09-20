// 评测产物的 schema 事实（B127，2026-09-21）。
// `tools/eval-e2e.cjs`（写方）与 `tools/eval-process-checks.cjs`（读方）共用这一份，
// 因为 B127 登记的坑正是**两边各认一套 schema**：
//   · e2e 的产物是 `<轮次>/report.json`（`summary` + `cases` + 同级 `screens/`，无 `commands`）；
//   · 过程层检查（F1~F8）要的是 `docs/eval/runs/<ts>.json`（`commands` + `events` + `reportPath`）。
// 上一轮拿 `--report` 去校验 e2e 产物，造出 `check_screenshot_taken` / `check_report_generated` 两条假红，
// 而它们的 `code` 是 `fail_env` —— 读起来像"评测产物不诚实"，实际是**喂错了文件**（坑 #45/#59 同族）。
// 所以这里既写"喂错要说清"的判据，也写"过程层过了要落进产物"的形态。
'use strict';

const E2E_REPORT_SCHEMA = 'e2e-report/v1';
const RUN_SCHEMA = 'process-run/v1';

/** 过程层产物 schema：`run.commands` 必须是**非空数组**（缺它＝喂错文件，不是产品红也不是环境红） */
function checkInputShape(run) {
  if (!run || typeof run !== 'object') return { ok: false, why: '输入不是对象（空文件或纯文本）' };
  const has = (k) => Array.isArray(run[k]) && run[k].length > 0;
  const missing = [];
  if (!has('commands')) missing.push('commands（非空数组）');
  if (!has('cases')) missing.push('cases（非空数组）');
  if (!run.reportPath) missing.push('reportPath');
  if (!missing.length) return { ok: true, why: `schema ${run.schema || RUN_SCHEMA} 形态齐` };
  // 认错了文件要把**认成了什么**说出来，否则下一个人只会去改判据
  const looksLike = run.summary && run.cases ? 'e2e 的 <轮次>/report.json（有 summary/cases、无 commands/events，截图在同级 screens/）'
    : Array.isArray(run.probes) ? '某工具的 --self-test 输出' : '未知形态';
  return {
    ok: false,
    missing,
    why: `喂错了文件：缺 ${missing.join('、')}；这份输入看着像 ${looksLike}。`
      + `过程层检查（F1~F8）要的是 run 产物 docs/eval/runs/<ts>.json（schema ${RUN_SCHEMA}），`
      + `e2e 那套轮次报告请由 eval-e2e 自己的过程层落账（report.json.process 字段）读。`,
  };
}

/**
 * 把一轮 F1~F8 的结果收成可落盘的段落。
 * 「全绿时什么都不写」就是 B127 的原病：事后无法证明过程层跑过。
 */
function buildProcessSection(entries, finalExitCode) {
  const results = entries.map(([name, r]) => ({ name, ok: !!(r && r.ok), code: r && r.code, why: r && r.why }));
  const failed = results.filter((r) => !r.ok);
  return {
    ran: true,
    at: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failProduct: failed.filter((r) => r.code && r.code !== 'fail_env').length,
    failEnv: failed.filter((r) => r.code === 'fail_env').length,
    failedNames: failed.map((r) => r.name),
    finalExitCode: finalExitCode,
    results,
  };
}

/** 读回产物时的判据：过程层没过/没落账，都不许当"验收过"（供 `npm run eval:process` 与交付说明用） */
function readProcessSection(report) {
  if (!report || !report.process) return { ok: false, why: 'report.json 里没有 process 字段（F1~F8 没落账＝本轮不算跑过）' };
  const p = report.process;
  if (!p.ran) return { ok: false, why: 'process.ran 不为 true' };
  if (p.passed !== p.total) return { ok: false, why: `过程层 ${p.passed}/${p.total} 通过，未过：${(p.failedNames || []).join(' ')}` };
  return { ok: true, why: `过程层 ${p.passed}/${p.total} 全过，落账于 ${p.at}` };
}

module.exports = { E2E_REPORT_SCHEMA, RUN_SCHEMA, checkInputShape, buildProcessSection, readProcessSection };

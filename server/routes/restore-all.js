// POST /api/sources/restore-all —— 一键批量恢复熔断源（P3）
// 功能：批量解冻所有 fail_count>=3 的源 → 清零失败计数 → 可选立即刷新
// 支持 type 过滤（bilibili/douyin/rss/youtube 等），适用于大规模账号批量恢复场景
const express = require('express');
const { db } = require('../db');
const { fetchSource } = require('../services/collectors/store');
const log = require('../util/log');

log.info('[批量恢复] 路由加载完成'); // ✅ 确保导入 log

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { type, refreshImmediately = false } = req.body || {}; // type: 按类型过滤，refreshImmediately: 是否立即刷新
    
    // Step 1: 查找所有熔断源（fail_count >=3 AND enabled=0）
    let conds = ['fail_count >= 3 AND enabled=0'];
    let args = [];
    
    if (type) {
      conds.push('type=?');
      args.push(type);
    }
    
    const frozenSources = db.prepare(`SELECT id, name, type, fail_count, extra FROM sources WHERE ${conds.join(' AND ')} ORDER BY fail_count DESC`).all(...args);
    
    if (!frozenSources.length) {
      return res.json({ ok: true, message: '无熔断源需要恢复', restored: 0 });
    }
    
    // Step 2: 批量解冻——统一走 store.unfreezeSource(enabled=1, fail_count=0, status='ok', 清错误字段保留 extra 配置)
    const { unfreezeSource } = require('../services/collectors/store');
    const results = [];
    // P3 一致性：整批解冻包 db.transaction()——中途异常全回滚，不留「部分解冻」中间态（仍可幂等重跑）
    const applyRestore = db.transaction(() => {
      for (const s of frozenSources) {
        if (!unfreezeSource(s.id)) continue; // 源已被并发删除时跳过,不虚报 restored
        results.push({ id: s.id, name: s.name, type: s.type, failCount: s.fail_count, restored: true });
        log.info(`[批量恢复] 已解冻 [${s.type}] ${s.name} (原 fail_count=${s.fail_count})`);
      }
    });
    applyRestore();
    
    // Step 3: 如果请求立即刷新，则串行抓取所有已恢复的源
    let refreshedCount = 0;
    let failedCount = 0;
    
    // P2 韧性：refreshImmediately 加软上限——单请求内串行 fetch N 源，每源全文补抓最坏数十秒，
    // 无上限会让 HTTP 请求挂起数分钟至客户端超时；超限的源本轮不刷新（已解冻，交调度器按 next_fetch_at 自然补抓）
    const REFRESH_CAP = 20;
    if (refreshImmediately) {
      const refreshTargets = results.slice(0, REFRESH_CAP);
      const deferredCount = results.length - refreshTargets.length;
      if (deferredCount > 0) for (const r of results.slice(REFRESH_CAP)) r.deferred = true;
      log.info(`[批量恢复] 开始立即刷新 ${refreshTargets.length} 个已恢复的源${deferredCount > 0 ? `（软上限 ${REFRESH_CAP}，其余 ${deferredCount} 个交调度器自然刷新）` : ''}...`);
      
      for (const r of refreshTargets) {
        try {
          const source = db.prepare('SELECT * FROM sources WHERE id=?').get(r.id);
          await fetchSource(source);
          r.refreshed = true;
          refreshedCount++;
        } catch (err) {
          r.refreshed = false;
          r.error = String(err.message || err).slice(0, 200);
          failedCount++;
          
          // 注意：这里即使刷新失败也不重新熔断（因为是刚解冻的）
          log.warn(`[批量恢复] 刷新失败 [${r.type}] ${r.name}: ${err.message}`);
        }
      }
    }
    
    res.json({
      ok: true,
      message: `成功解冻 ${results.length} 个熔断源`,
      restored: results.length,
      refreshed: refreshImmediately ? refreshedCount : null,
      failed: refreshImmediately ? failedCount : null,
      results,
    });
    
  } catch (err) {
    log.error('[批量恢复] 异常:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

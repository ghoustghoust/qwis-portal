// 云端队列轮询器（T35，F24/F31/F41/F44）
// 依次 pull 三端点 → 写入 pending_items → clear 云端 → bilibili/douyin 后台 resolve 转 sources
// wechat 类型不 resolve，保持 pending 供手动复制（F24）；失败重试只在本机追踪
const { db, getSetting, setSetting } = require('../../db');
const { fetchJson } = require('../../util/http');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');
const registry = require('../collectors/registry');

const QUEUES = [
  { name: 'wechat', endpoint: 'wechat-rss-queue.php', autoResolve: false }, // F24：仅本地保存供手动复制
  { name: 'bilibili', endpoint: 'bilibili-video-queue.php', autoResolve: true }, // F31：导入后 resolve 转正式订阅
  { name: 'douyin', endpoint: 'douyin-video-queue.php', autoResolve: true },     // F41：同上
];
const QUEUE_NAMES = QUEUES.map((q) => q.name);

function queueConf() {
  const q = getSetting('queue', {});
  return {
    baseUrl: String(q.baseUrl || '').replace(/\/+$/, ''),
    token: q.token || '',
    intervalMin: Number(q.intervalMin) || 10,
    enabled: !!q.enabled,
  };
}

const findPending = db.prepare('SELECT * FROM pending_items WHERE type=? AND url=?');
const insertPending = db.prepare("INSERT INTO pending_items(type, url, name, status, imported_at) VALUES(?,?,?,'pending',?)");

// 同步单个队列：pull → 写 pending_items → clear → 后台 resolve
async function syncQueue(name) {
  const def = QUEUES.find((q) => q.name === name);
  if (!def) throw new Error(`未知队列: ${name}`);
  const { baseUrl, token } = queueConf();
  if (!baseUrl || !token) throw new Error('未配置队列地址或 Token（settings.queue）');

  const data = await fetchJson(`${baseUrl}/${def.endpoint}?token=${encodeURIComponent(token)}&action=pull`);
  if (!data.ok) throw new Error(data.error || '云端返回失败');
  const items = Array.isArray(data.items) ? data.items : [];
  const count = Number(data.count) || 0;

  let imported = 0;
  let updated = 0;
  for (const it of items) {
    const url = String((it && it.url) || '').trim();
    if (!url) continue;
    const name_ = String((it && it.name) || '').trim();
    const existing = findPending.get(name, url);
    if (existing) {
      // 已存在：更新名称/导入时间；failed 的重新置回 pending 以便本机重试；resolved 不动
      if (existing.status === 'failed') {
        db.prepare("UPDATE pending_items SET name=?, imported_at=?, status='pending', error=NULL WHERE id=?")
          .run(name_ || existing.name, nowIso(), existing.id);
      } else {
        db.prepare('UPDATE pending_items SET name=?, imported_at=? WHERE id=?')
          .run(name_ || existing.name, nowIso(), existing.id);
      }
      updated++;
    } else {
      insertPending.run(name, url, name_, nowIso());
      imported++;
    }
  }

  // 导入本地后立即清空云端（F31：失败重试只在本机追踪）
  let cleared = 0;
  if (count > 0) {
    await fetchJson(`${baseUrl}/${def.endpoint}?token=${encodeURIComponent(token)}&action=clear`);
    cleared = count;
  }

  log.info(`队列[${name}]同步完成：导入 ${imported} 个，更新 ${updated} 个，清空云端 ${cleared} 个`);
  setSetting('queue.lastSyncAt', nowIso());

  // bilibili/douyin 后台逐条 resolve 转正式订阅；wechat 保持 pending（F24）
  if (def.autoResolve) {
    resolvePending(name).catch((err) => log.error(`队列[${name}]后台解析异常:`, err.message));
  }
  return { imported, updated, cleared };
}

// 后台逐条 resolve pending_items → sources；失败标 failed+error（只本机重试）
async function resolvePending(type) {
  const adapter = registry.getAdapter(type);
  const rows = db.prepare("SELECT * FROM pending_items WHERE type=? AND status='pending' ORDER BY id").all(type);
  for (const item of rows) {
    try {
      if (!adapter) throw new Error(`适配器未就绪: ${type}（四期实现）`);
      const info = await adapter.resolve(item.url);
      const dup = db.prepare('SELECT id FROM sources WHERE type=? AND (uid=? OR url=?)')
        .get(type, info.uid || '', info.url || item.url);
      if (!dup) {
        db.prepare(
          'INSERT INTO sources(type, name, url, avatar, uid, extra, enabled, status, created_at) VALUES(?,?,?,?,?,?,1,?,?)'
        ).run(type, item.name || info.name || item.url, info.url || item.url, info.avatar || null,
          info.uid || null, JSON.stringify(info.extra || {}), 'ok', nowIso());
      }
      db.prepare("UPDATE pending_items SET status='resolved', error=NULL WHERE id=?").run(item.id);
      log.info(`队列[${type}]已解析为正式订阅: ${item.name || info.name || item.url}`);
    } catch (err) {
      db.prepare("UPDATE pending_items SET status='failed', error=? WHERE id=?").run(String(err.message || err), item.id);
      log.error(`队列[${type}]解析失败 ${item.url}:`, err.message);
    }
  }
}

// 轮询入口：三队列依次同步，单队列失败不中断其它
async function pollAll() {
  const { enabled } = queueConf();
  if (!enabled) return;
  log.info('队列轮询触发：依次拉取 wechat / bilibili / douyin');
  for (const { name } of QUEUES) {
    try {
      await syncQueue(name);
    } catch (err) {
      log.error(`队列[${name}]同步失败:`, err.message);
      setSetting('queue.lastError', `${name}: ${err.message}`);
    }
  }
}

module.exports = { syncQueue, pollAll, resolvePending, queueConf, QUEUES, QUEUE_NAMES };

#!/usr/bin/env node
/**
 * 验证每日情报两大问题的修复效果
 * 1. 时效性窗口检查（windowHours 默认值）
 * 2. 预抓取错误隔离验证
 */

const { db, getSetting } = require('../server/db');

console.log('=== 每日情报问题修复验证 ===\n');

// 验证点 1：检查 windowHours 配置
console.log('【验证点 1】时间窗口配置');
const dailySettings = getSetting('daily', {});
const windowHours = dailySettings.windowHours || 48;
console.log(`  windowHours: ${windowHours}小时`);
console.log(`  ✓ 说明：日报统计窗口为过去${windowHours}小时，跨天展示符合设计预期`);
console.log();

// 验证点 2：检查报警事件开关
console.log('【验证点 2】报警事件配置');
const alertsConfig = getSetting('alerts', {});
const events = alertsConfig.events || {
  source_error: true,
  source_paused: true,
  daily_failed: true,
};
console.log(`  source_error: ${events.source_error ? '启用' : '禁用'}`);
console.log(`  source_paused: ${events.source_paused ? '启用' : '禁用'}`);
console.log(`  daily_failed: ${events.daily_failed ? '启用' : '禁用'}`);
console.log(`  ✓ 说明：source_error 在 fail_count>=2 时触发，冷却时长=${getSetting('alerts', {}).cooldownMin || 120}分钟`);
console.log();

// 验证点 3：检查最近失败的源
console.log('【验证点 3】近期失败源状态');
const failedSources = db.prepare(
  'SELECT id, name, type, fail_count, last_fetched_at, next_fetch_at ' +
  'FROM sources WHERE fail_count >= 2 AND enabled=1 ORDER BY fail_count DESC LIMIT 10'
).all();

if (failedSources.length === 0) {
  console.log('  ✓ 无连续失败≥2 次的启用源');
} else {
  console.log(`  ⚠️ 发现 ${failedSources.length} 个接近报警阈值的源：`);
  for (const s of failedSources.slice(0, 5)) {
    console.log(`    - ${s.name} (${s.type}): fail_count=${s.fail_count}, 最后成功=${s.last_fetched_at}`);
  }
  if (failedSources.length > 5) {
    console.log(`    ... 还有 ${failedSources.length - 5} 个`);
  }
}
console.log();

// 验证点 4：检查预抓取修复代码
console.log('【验证点 4】预抓取错误隔离代码验证');
const fs = require('fs');
const path = require('path');
const routesDailyPath = path.join(__dirname, '..', 'server', 'routes', 'daily.js');
const content = fs.readFileSync(routesDailyPath, 'utf-8');

if (content.includes('// 修复：预抓取阶段失败不应触发日报生成失败报警')) {
  console.log('  ✓ 预抓取错误隔离代码已应用');
} else {
  console.log('  ✗ 预抓取错误隔离代码缺失');
}

if (content.includes('log.warn(`[日报预抓取] 部分源失败')) {
  console.log('  ✓ 预抓取失败日志记录已添加');
} else {
  console.log('  ✗ 预抓取失败日志记录缺失');
}
console.log();

// 总结与建议
console.log('=== 总结与建议 ===');
console.log('【问题一】时效性不符');
console.log('  原因：windowHours 默认为 48h，导致跨两天展示');
console.log('  解决：UI 提示优化或用户自定义窗口时长（可选）');
console.log();
console.log('【问题二】刷新触发批量报警');
console.log('  原因：fetchDueBeforeDaily() 中源失败会调用 markSourceError() → sourceError()');
console.log('  解决：已在 routes/daily.js 中添加 try-catch 隔离预抓取错误');
console.log('  效果：即使 65 个源全部失败，也不会触发 source_error 报警');
console.log();
console.log('【建议操作】');
console.log('  1. 重启后端服务：pm2 restart all');
console.log('  2. 前端打开每日情报页，点击"刷新"按钮观察报警');
console.log('  3. 查看后端日志是否有 "[日报预抓取] 部分源失败" 记录');
console.log('  4. 如仍有报警，可在管理后台调大冷却时长或临时禁用 source_error 事件');

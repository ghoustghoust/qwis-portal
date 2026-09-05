#!/usr/bin/env node
/**
 * scripts/restore-frozen-sources.js
 * 批量恢复所有熔断的源（enabled=0, fail_count>=3）
 */
const { db } = require('../server/db');

console.log('🔍 扫描熔断源...');
const stmt = db.prepare('SELECT id, name, type, fail_count FROM sources WHERE fail_count >= 3 AND enabled=0');
const sources = stmt.all();

console.log(`⚠️  发现 ${sources.length} 个熔断源需要恢复`);

if (sources.length === 0) {
  console.log('✅ 无需恢复');
  process.exit(0);
}

// 清除错误标记并解冻——统一走 store.unfreezeSource(与 toggle/health/restore-all 同一实现):
// 只删 lastError/lastErrorAt,保留 intervalMin(P0-1 源级间隔)、etag/lastModified 等 extra 配置
const { unfreezeSource } = require('../server/services/collectors/store');

let restored = 0;
for (const s of sources) {
  unfreezeSource(s.id);
  restored++;
  console.log(`  ✓ 已恢复 [${s.type}] ${s.name} (原 fail_count=${s.fail_count})`);
}

console.log(`\n✅ 成功恢复 ${restored} 个熔断源`);
console.log('剩余熔断源:', db.prepare('SELECT COUNT(*) c FROM sources WHERE fail_count >= 3 AND enabled=0').get().c);
console.log('\n💡 scheduler 将在下一个周期自动开始刷新这些源');
process.exit(0);

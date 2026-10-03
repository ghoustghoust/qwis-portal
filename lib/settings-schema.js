// H41①：设置面"什么算合法键"的唯一判定（settings-plane.md §六：不许三端各一份——
// 此前本地连清单都没有、云端只有保留键清单，未知区/未知键静默假保存是唯一会主动骗人的形态）。
// 两端的 PUT /api/settings 用 checkWritableKeys 拒未知区与闭集区里的未知键，400 并点名。
// 开放集合（null）= 段内键随消费方演进（intervals/daily 这类）；闭集 = 键集已收敛的段。
const WRITABLE_SECTIONS = {
  intervals: null,                                // 键=源类型/通道，开放集合
  opml: ['url', 'enabled'],
  queue: ['baseUrl', 'token', 'intervalMin', 'enabled'],
  daily: null,                                    // 含 columns 数组、来源勾选等，开放集合（windowHours/time 另有校验）
  hot: null,
  data: null,
  mybrief: null,                                  // 含 domainQuotas 等，开放集合
  weekly: null,
  prescreen: ['perSourceCap'],
  views: null,                                    // 数组整体替换
  bilibili: ['cookie'],                           // 仅本地收（写 credentials 表）；云端没有这个分支
  ai: ['enabled', 'model', 'apiBase', 'apiKey'],  // 仅本地主端点收；云端主端点拒写（真写入口在专用端点）
};

// 系统保留键：凭据与机器自写状态，任何端的写入通道都不得收（顶层或任一区内）
const BLOCKLIST = ['auth.secret', 'admin.passwordHash', 'backup.latest', 'cloud.collect'];

// 返回 {ok, error?}；allowSections = 该端真实接了写入分支的区（按端给，判定逻辑只有这一份）
function checkWritableKeys(body, { allowSections = [] } = {}) {
  const known = (k) => k in WRITABLE_SECTIONS && allowSections.includes(k);
  const unknown = Object.keys(body || {}).filter((k) => !known(k));
  if (unknown.length) {
    return { ok: false, error: `未知的设置区: ${unknown.join(', ')}（这一端不认识它，写了也不会生效）` };
  }
  const closedOffenders = [];
  for (const [k, v] of Object.entries(body || {})) {
    const closed = WRITABLE_SECTIONS[k];
    if (!closed || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const bad = Object.keys(v).filter((kk) => !closed.includes(kk));
    if (bad.length) closedOffenders.push(`${k}: ${bad.join(', ')}`);
  }
  if (closedOffenders.length) {
    return { ok: false, error: `以下设置区收到了不认识的键: ${closedOffenders.join('；')}` };
  }
  return { ok: true };
}

function findBlocklistedKeys(body) {
  const hits = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (BLOCKLIST.includes(k)) hits.push(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const kk of Object.keys(v)) if (BLOCKLIST.includes(kk)) hits.push(kk);
    }
  }
  return hits;
}

module.exports = { WRITABLE_SECTIONS, BLOCKLIST, checkWritableKeys, findBlocklistedKeys };

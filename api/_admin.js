// 云端管理后台服务端(十一期 M4):口令鉴权(httpOnly cookie) + 订阅源管理 + 微信读书扫码授权
// 口令存 Turso settings 'admin.passwordHash'(sha256);首次访问即 setup(首设口令)
// 扫码流程移植 we-mp-rss driver/weread_qr.py 的纯 HTTP 链路,serverless 无状态化:
//   qrcode 阶段拿到的 set-cookie 作为 session 透传给前端,status 轮询时回传
const crypto = require('crypto');
const QRCode = require('qrcode');
const turso = require('./_turso');
const { dbAll, dbGet, dbRun, getSetting, setSetting, nowIso } = turso;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const COOKIE_NAME = 'qw_admin';
const COOKIE_MAX_AGE = 7 * 86400;

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// 无状态会话令牌:sha256(passwordHash | 服务端盐)。盐用 COLLECT_KEY(已配 Vercel env),本地缺省退化固定值
function tokenFor(hash) {
  return sha256(`${hash}|${process.env.COLLECT_KEY || 'qwis-portal-admin'}`);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function isAuthed(ctx) {
  const hash = await getSetting('admin.passwordHash', null);
  if (!hash) return false;
  const token = parseCookies(ctx.headers && ctx.headers.cookie)[COOKIE_NAME];
  return !!token && token === tokenFor(hash);
}

// POST /api/admin/login {password}:首次调用即设置口令(setup),之后校验
async function login(body) {
  const password = String((body && body.password) || '');
  if (password.length < 6) return { code: 400, body: { ok: false, error: '口令至少 6 位' } };
  const existing = await getSetting('admin.passwordHash', null);
  const hash = existing || sha256(password);
  if (existing && existing !== sha256(password)) {
    return { code: 401, body: { ok: false, error: '口令错误' } };
  }
  if (!existing) await setSetting('admin.passwordHash', hash);
  return {
    body: { ok: true, setup: !existing },
    cookies: [`${COOKIE_NAME}=${tokenFor(hash)}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`],
  };
}

function logout() {
  return { body: { ok: true }, cookies: [`${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`] };
}

async function session(ctx) {
  const hash = await getSetting('admin.passwordHash', null);
  return { body: { ok: true, authenticated: await isAuthed(ctx), setupRequired: !hash } };
}

// ---------- 订阅源管理 ----------
function parseExtra(s) {
  try { return JSON.parse(s.extra || '{}'); } catch { return {}; }
}

async function listSources() {
  const rows = await dbAll(
    `SELECT s.id, s.type, s.name, s.url, s.avatar, s.group_id, s.enabled, s.status,
            s.last_fetched_at, s.next_fetch_at, s.extra, s.created_at,
            g.name AS group_name,
            (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS article_count
     FROM sources s LEFT JOIN groups g ON g.id = s.group_id
     ORDER BY s.enabled DESC, s.status = 'error' DESC, s.id`
  );
  const items = rows.map((s) => {
    const extra = parseExtra(s);
    return {
      id: s.id, type: s.type, name: s.name, url: s.url, avatar: s.avatar,
      group_id: s.group_id, group_name: s.group_name,
      enabled: !!s.enabled, status: s.status,
      last_fetched_at: s.last_fetched_at, next_fetch_at: s.next_fetch_at,
      intervalMin: Number(extra.intervalMin) || 60,
      failCount: Number(extra.failCount) || 0,
      lastError: extra.lastError || null,
      lastErrorAt: extra.lastErrorAt || null,
      articleCount: s.article_count,
      created_at: s.created_at,
    };
  });
  return { body: { ok: true, items } };
}

// 添加源:type=hotlist 时 url 为 newsnow 源 id;type=rss 时为 feed 地址
async function addSource(body) {
  const type = String((body && body.type) || '');
  const name = String((body && body.name) || '').trim();
  let url = String((body && body.url) || '').trim();
  if (!name) return { code: 400, body: { ok: false, error: '缺少名称' } };
  if (type === 'hotlist') {
    const id = url.replace(/^hotlist:\/\//, '').trim();
    if (!/^[a-z0-9-]+$/i.test(id)) return { code: 400, body: { ok: false, error: '热榜源 id 非法(如 zhihu)' } };
    url = `hotlist://${id}`;
  } else if (type === 'rss') {
    if (!/^https?:\/\/\S+$/i.test(url)) return { code: 400, body: { ok: false, error: 'RSS 地址非法' } };
  } else {
    return { code: 400, body: { ok: false, error: '云端仅支持添加 rss / hotlist 源' } };
  }
  const dup = await dbGet('SELECT id FROM sources WHERE url = ?', url);
  if (dup) return { code: 409, body: { ok: false, error: '源已存在', id: dup.id } };
  const extra = {};
  if (Number(body.intervalMin) > 0) extra.intervalMin = Number(body.intervalMin);
  if (body.domain) extra.domain = String(body.domain);
  const r = await dbRun(
    `INSERT INTO sources(type, name, url, group_id, enabled, status, extra, created_at)
     VALUES (?, ?, ?, ?, 1, 'ok', ?, ?)`,
    type, name, url, Number(body.group_id) || null, JSON.stringify(extra), nowIso()
  );
  return { body: { ok: true, id: r.lastInsertRowid } };
}

async function toggleSource(id) {
  const s = await dbGet('SELECT id, enabled, extra FROM sources WHERE id = ?', Number(id));
  if (!s) return { code: 404, body: { ok: false, error: '源不存在' } };
  const enabled = s.enabled ? 0 : 1;
  const extra = parseExtra(s);
  if (enabled) {
    // 重新启用:清零失败计数/错误标记,立即到期
    delete extra.failCount;
    delete extra.lastError;
    delete extra.lastErrorAt;
    await dbRun(
      "UPDATE sources SET enabled=1, status='ok', next_fetch_at=NULL, extra=? WHERE id=?",
      JSON.stringify(extra), s.id
    );
  } else {
    await dbRun('UPDATE sources SET enabled=0, extra=? WHERE id=?', JSON.stringify(extra), s.id);
  }
  return { body: { ok: true, enabled: !!enabled } };
}

async function deleteSource(id) {
  const s = await dbGet('SELECT id FROM sources WHERE id = ?', Number(id));
  if (!s) return { code: 404, body: { ok: false, error: '源不存在' } };
  await dbRun('DELETE FROM articles WHERE source_id = ?', s.id);
  await dbRun('DELETE FROM videos WHERE source_id = ?', s.id);
  await dbRun('DELETE FROM sources WHERE id = ?', s.id);
  return { body: { ok: true } };
}

// ---------- 微信读书扫码授权 ----------
function fetchWithTimeout(url, { headers = {}, timeout = 15000, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: 'https://weread.qq.com',
      Referer: 'https://weread.qq.com/',
      ...headers,
    },
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
}

// set-cookie 数组 → {name:value}(同名取最后)
function jarFrom(setCookies) {
  const jar = {};
  for (const sc of setCookies || []) {
    const pair = String(sc).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
const jarToString = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function wereadQrcode() {
  // 新版 v2 端点优先,失败回退旧版 /api/auth/getLoginUid
  let uid = null;
  let jar = {};
  for (const attempt of [
    { url: 'https://weread.qq.com/web/login/v2/getloginuid', method: 'POST' },
    { url: 'https://weread.qq.com/api/auth/getLoginUid', method: 'GET' },
  ]) {
    try {
      const res = await fetchWithTimeout(attempt.url, { method: attempt.method, timeout: 20000 });
      if (!res.ok) continue;
      const data = await res.json();
      uid = data.uid || (data.data && data.data.uid) || null;
      jar = { ...jar, ...jarFrom(res.headers.getSetCookie ? res.headers.getSetCookie() : []) };
      if (uid) break;
    } catch { /* 尝试下一端点 */ }
  }
  if (!uid) return { code: 502, body: { ok: false, error: '获取微信读书登录 uid 失败' } };
  const qr = await QRCode.toDataURL(`https://weread.qq.com/web/confirm?uid=${uid}`, { margin: 2, width: 320 });
  return { body: { ok: true, uid: String(uid), qr, session: jarToString(jar) } };
}

// 用书架接口验证 cookie 是否有效(userVid 必须传空字符串,非空反触发 -2012)
async function verifyCookie(cookieStr) {
  try {
    const res = await fetchWithTimeout('https://weread.qq.com/web/shelf/sync?userVid=&synckey=0', {
      headers: { Cookie: cookieStr },
      timeout: 15000,
    });
    if (!res.ok) return false;
    const j = await res.json();
    const code = j.errCode ?? j.errcode ?? 0;
    return !code && ('books' in j || 'bookCount' in j || 'synckey' in j);
  } catch {
    return false;
  }
}

async function wereadStatus(query) {
  const uid = String(query.uid || '');
  if (!uid) return { code: 400, body: { ok: false, error: '缺少 uid' } };
  const session = String(query.session || '');
  // v2 端点已 404(2026-08 实测),优先旧版 /api/auth/getLoginInfo(长轮询,挂起属正常)
  let res = null;
  for (const url of [
    `https://weread.qq.com/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=`,
    `https://weread.qq.com/web/login/v2/getlogininfo?uid=${encodeURIComponent(uid)}&otp=`,
  ]) {
    try {
      const r = await fetchWithTimeout(url, {
        headers: session ? { Cookie: session } : {},
        timeout: 25000, // 长轮询;serverless 60s 上限内
      });
      if (r.ok) { res = r; break; }
    } catch (e) {
      // 长轮询超时/中断视为等待中,前端继续轮询
      if (e.name === 'AbortError') return { body: { ok: true, status: 'waiting' } };
    }
  }
  if (!res) return { body: { ok: true, status: 'waiting' } };
  const data = await res.json().catch(() => ({}));
  const inner = data.data || {};
  const succeed = data.succeed || inner.succeed;
  const logicCode = data.logicCode || '';
  if (!succeed) {
    if (logicCode === 'NEED_OTP') return { body: { ok: true, status: 'need_otp' } };
    return { body: { ok: true, status: 'waiting', logicCode: logicCode || undefined } };
  }

  // 登录成功:合并响应 set-cookie + 会话 cookie,构造候选并验证
  const jar = { ...jarFrom(session ? session.split('; ').map((p) => p) : []), ...jarFrom(res.headers.getSetCookie ? res.headers.getSetCookie() : []) };
  const vid = String(
    data.webLoginVid || data.vid || data.userVid || inner.webLoginVid || inner.vid || inner.userVid || inner.user_vid || ''
  );
  if (vid && !jar.wr_vid) jar.wr_vid = vid;
  const accessToken = data.accessToken || inner.accessToken || '';
  const refreshToken = data.refreshToken || inner.refreshToken || '';
  if (accessToken && !jar.wr_skey) jar.wr_skey = accessToken;
  if (!vid) return { body: { ok: true, status: 'error', error: '登录成功但未获取到 vid,请重试' } };

  // 候选:原始 jar → refreshToken 作 wr_skey 的变体(新版短 wr_skey 常被 -2012 拒绝)
  const candidates = [{ ...jar }];
  if (refreshToken) {
    candidates.push({ ...jar, wr_skey: refreshToken, wr_rt: encodeURIComponent(refreshToken) });
    candidates.push({ ...jar, wr_skey: refreshToken });
  }
  for (const cand of candidates) {
    const cookieStr = jarToString(cand);
    if (await verifyCookie(cookieStr)) {
      await dbRun(
        `INSERT INTO credentials(platform, data, updated_at) VALUES('weread', ?, ?)
         ON CONFLICT(platform) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
        JSON.stringify({ cookie: cookieStr, vid, savedAt: nowIso(), source: 'cloud-qr' }), nowIso()
      );
      // cookie 换新后恢复被熔断的 wemp 源
      await dbRun(
        "UPDATE sources SET enabled=1, status='ok', next_fetch_at=NULL WHERE type='wemp' AND enabled=0"
      );
      return { body: { ok: true, status: 'success', vid } };
    }
  }
  return { body: { ok: true, status: 'error', error: '登录成功但 Cookie 验证失败,请重新扫码' } };
}

// ---------- OPML 导入(P2,移植主系统 wechat 适配器的 parseOpml/syncOpml;云端统一存 type='rss') ----------
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
function attrOf(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
    || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}
function parseOpml(xml) {
  const outlines = [];
  const re = /<outline\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const xmlUrl = attrOf(tag, 'xmlUrl');
    if (!xmlUrl) continue;
    const name = attrOf(tag, 'title') || attrOf(tag, 'text') || attrOf(tag, 'name') || '';
    outlines.push({ name: decodeEntities(name).trim(), url: decodeEntities(xmlUrl).trim() });
  }
  return outlines;
}

// body: {url: OPML 地址} 或 {xml: 直接粘贴的 OPML 内容}
async function importOpml(body) {
  let xml = String((body && body.xml) || '');
  const url = String((body && body.url) || '').trim();
  if (!xml && url) {
    if (!/^https?:\/\//i.test(url)) return { code: 400, body: { ok: false, error: 'OPML 地址非法' } };
    const res = await fetchWithTimeout(url, { timeout: 20000 });
    if (!res.ok) return { code: 502, body: { ok: false, error: `拉取 OPML 失败 HTTP ${res.status}` } };
    xml = await res.text();
  }
  if (!xml) return { code: 400, body: { ok: false, error: '请提供 OPML 地址或内容' } };
  const outlines = parseOpml(xml);
  if (!outlines.length) return { code: 400, body: { ok: false, error: 'OPML 中没有解析到任何 RSS 订阅' } };

  let added = 0, restored = 0, updated = 0;
  for (const o of outlines) {
    const exist = await dbGet("SELECT id, name, enabled FROM sources WHERE url = ?", o.url);
    if (!exist) {
      await dbRun(
        "INSERT INTO sources(type, name, url, enabled, status, extra, created_at) VALUES('rss', ?, ?, 1, 'ok', '{}', ?)",
        o.name || o.url, o.url, nowIso()
      );
      added++;
    } else if (!exist.enabled) {
      await dbRun("UPDATE sources SET enabled=1, status='ok' WHERE id=?", exist.id);
      restored++;
    } else if (o.name && exist.name !== o.name) {
      await dbRun('UPDATE sources SET name=? WHERE id=?', o.name, exist.id);
      updated++;
    }
  }
  await setSetting('opml.lastSyncAt', nowIso());
  await setSetting('opml.lastResult', { added, restored, updated, total: outlines.length });
  return { body: { ok: true, added, restored, updated, total: outlines.length } };
}

// ---------- 日报/AI 设置 ----------
async function getDailySettings() {
  const d = await getSetting('daily', {});
  return {
    body: {
      ok: true,
      settings: {
        windowHours: Number(d.windowHours) || 48,
        aiEnabled: !!d.aiEnabled,
        apiKey: d.apiKey || '',
        apiBase: d.apiBase || '',
        model: d.model || '',
        hasKey: !!d.apiKey,
      },
    },
  };
}
async function saveDailySettings(body) {
  const prev = await getSetting('daily', {});
  const b = body || {};
  const next = { ...prev };
  if (b.windowHours !== undefined) next.windowHours = Number(b.windowHours) || 48;
  if (b.aiEnabled !== undefined) next.aiEnabled = !!b.aiEnabled;
  if (b.apiKey !== undefined) next.apiKey = String(b.apiKey).trim();
  if (b.apiBase !== undefined) next.apiBase = String(b.apiBase).trim();
  if (b.model !== undefined) next.model = String(b.model).trim();
  await setSetting('daily', next);
  return { body: { ok: true } };
}

module.exports = {
  login, logout, session, isAuthed,
  listSources, addSource, toggleSource, deleteSource,
  wereadQrcode, wereadStatus,
  importOpml, parseOpml,
  getDailySettings, saveDailySettings,
};

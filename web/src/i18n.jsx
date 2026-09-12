// 轻量级 i18n：中英文双语切换
// 设计原则：Context + localStorage 持久化；t(key) 实时查表；切换无刷新
import React, { createContext, useCallback, useContext, useState } from 'react';

const I18nCtx = createContext({ lang: 'zh', setLang: () => {}, t: (k) => k });

// ─── 翻译字典 ───
const DICT = {
  // 导航栏（IconRail）
  'nav.reader':        { zh: '阅读器',     en: 'Reader' },
  'nav.daily':         { zh: '每日情报',   en: 'Daily' },
  'nav.hot':           { zh: '热点榜',     en: 'Hot' },
  'nav.reading':       { zh: '我的阅读',   en: 'My Reading' },
  'nav.lang':          { zh: 'EN',         en: '中文' },

  // 侧栏（Sidebar）
  'sidebar.article':   { zh: '文章',       en: 'Articles' },
  'sidebar.video':     { zh: '视频',       en: 'Videos' },
  'sidebar.all':       { zh: '全部',       en: 'All' },
  'sidebar.later':     { zh: '稍后阅读',   en: 'Read Later' },
  'sidebar.history':   { zh: '历史存档',   en: 'History' },
  'sidebar.allVideo':  { zh: '全部视频',   en: 'All Videos' },
  'sidebar.favorite':  { zh: '收藏',       en: 'Favorites' },
  'sidebar.myViews':   { zh: '我的视图',   en: 'My Views' },
  'sidebar.deleteView':{ zh: '删除视图',   en: 'Delete View' },

  // 文章阅读栏（ArticleView）
  'article.readLater':     { zh: '稍后阅读',           en: 'Read Later' },
  'article.cancelLater':   { zh: '取消稍后阅读',       en: 'Cancel Read Later' },
  'article.openOriginal':  { zh: '打开原文',           en: 'Open Original' },
  'article.more':          { zh: '更多',               en: 'More' },
  'article.copyLink':      { zh: '复制链接',           en: 'Copy Link' },
  'article.copyTitle':     { zh: '复制标题',           en: 'Copy Title' },
  'article.showTranslation':{ zh: '显示译文',          en: 'Show Translation' },
  'article.showOriginal':  { zh: '显示原文',           en: 'Show Original' },
  'article.readAll':       { zh: '全部已读',           en: 'Mark All Read' },
  'article.readAllTitle':  { zh: '全部标为已读',       en: 'Mark All as Read' },
  'article.prev':          { zh: '上一篇',             en: 'Previous' },
  'article.next':          { zh: '下一篇',             en: 'Next' },
  'article.close':         { zh: '关闭',               en: 'Close' },
  'article.loading':       { zh: '加载中…',            en: 'Loading…' },
  'article.loadFailed':    { zh: '文章加载失败',       en: 'Failed to load' },
  'article.selectHint':    { zh: '从左侧选择文章，或点文件夹读聚合流', en: 'Select an article from the left, or click a folder to read' },
  'article.viewOriginal':  { zh: '查看原文',           en: 'View Original' },
  'article.addedLater':    { zh: '已加入稍后阅读',     en: 'Added to Read Later' },
  'article.removedLater':  { zh: '已取消稍后阅读',     en: 'Removed from Read Later' },
  'article.allMarkedRead': { zh: '已全部标为已读',     en: 'All marked as read' },
  'article.translated':    { zh: '译文',               en: 'Translated' },
  'article.translatedTip': { zh: '当前显示翻译内容',   en: 'Showing translated content' },
  'article.translateNow':  { zh: '翻译',               en: 'Translate' },
  'article.translating':   { zh: '翻译中…',            en: 'Translating…' },
  'article.translateQueued': { zh: '已加入翻译队列，约 20 分钟内完成', en: 'Queued for translation, ready in ~20 min' },
  'article.translateDone': { zh: '翻译完成',           en: 'Translation ready' },
  'article.aiTranslated':  { zh: 'AI 精翻',            en: 'AI refined' },
  'article.machineTranslated': { zh: '机翻',           en: 'Machine translated' },
  'article.videoExpired':  { zh: '▶ 内嵌视频已失效（源站签名过期），点击打开原文观看 ↗', en: '▶ Embedded video expired, click to open original ↗' },

  // 热点榜（HotPage）
  'hot.title':             { zh: '🔥 热点榜',          en: '🔥 Trending' },
  'hot.featured':          { zh: '精选',               en: 'Featured' },
  'hot.all':               { zh: '全部动态',           en: 'All' },
  'hot.events':            { zh: '热点榜',             en: 'Events' },
  'hot.sourceAll':         { zh: '来源：全部',         en: 'Source: All' },
  'hot.sourceFilter':      { zh: '按来源筛选',         en: 'Filter by source' },
  'hot.searchPlaceholder': { zh: '搜索标题、摘要…',    en: 'Search title, summary…' },
  'hot.loading':           { zh: '加载中…',            en: 'Loading…' },
  'hot.loadMore':          { zh: '加载更多',           en: 'Load More' },
  'hot.notReady':          { zh: '热点榜服务尚未就绪（后端接口施工中），请稍后再试', en: 'Hot list service not ready yet, please try later' },
  'hot.noMatch':           { zh: '没有匹配的动态',     en: 'No matching items' },
  'hot.categoryEmpty':     { zh: '该分类近期待抓取内容为空', en: 'No recent content in this category' },
  'hot.empty':             { zh: '暂无热点内容，等待 AIHOT 抓取', en: 'No trending content yet' },
  'hot.items':             { zh: '条',                 en: 'items' },
  'hot.featuredBadge':     { zh: '✦ 精选',            en: '✦ Featured' },
  'hot.reason':            { zh: '推荐理由：',         en: 'Reason: ' },
  'hot.heat':              { zh: '热度',               en: 'Heat' },
  'hot.addLater':          { zh: '加入稍后阅读（阅读器可见）', en: 'Add to Read Later' },
  'hot.cancelLater':       { zh: '取消稍后阅读',       en: 'Cancel Read Later' },
  'hot.addedLater':        { zh: '已加入稍后阅读',     en: 'Added to Read Later' },
  'hot.removedLater':      { zh: '已取消稍后阅读',     en: 'Removed from Read Later' },
  'hot.opFailed':          { zh: '操作失败',           en: 'Operation failed' },

  // 我的阅读（MyReadingPage）
  'reading.title':         { zh: '我的阅读',           en: 'My Reading' },
  'reading.all':           { zh: '全部',               en: 'All' },
  'reading.favorited':     { zh: '已收藏',             en: 'Favorited' },
  'reading.read':          { zh: '已读',               en: 'Read' },
  'reading.article':       { zh: '文章',               en: 'Article' },
  'reading.podcast':       { zh: '播客',               en: 'Podcast' },
  'reading.video':         { zh: '视频',               en: 'Video' },
  'reading.search':        { zh: '搜索标题/来源…',     en: 'Search title/source…' },
  'reading.batchManage':   { zh: '批量管理',           en: 'Batch Manage' },
  'reading.export':        { zh: '导出',               en: 'Export' },
  'reading.exportSelected':{ zh: '导出选中',           en: 'Export Selected' },
  'reading.selectAll':     { zh: '全选',               en: 'Select All' },
  'reading.deselectAll':   { zh: '取消全选',           en: 'Deselect All' },
  'reading.selected':      { zh: '条已选',             en: 'selected' },
  'reading.cancel':        { zh: '取消',               en: 'Cancel' },
  'reading.loading':       { zh: '加载中…',            en: 'Loading…' },
  'reading.loadMore':      { zh: '加载更多',           en: 'Load More' },
  'reading.noFavorite':    { zh: '暂无收藏内容',       en: 'No favorites yet' },
  'reading.noRead':        { zh: '暂无已读记录',       en: 'No reading history' },
  'reading.noData':        { zh: '暂无阅读沉淀',     en: 'No reading records yet' },
  'reading.items':         { zh: '条',                 en: 'items' },
  'reading.unlater':       { zh: '取消稍后读',         en: 'Remove Later' },
  'reading.unfavorite':    { zh: '取消收藏',           en: 'Unfavorite' },
  'reading.clearRead':     { zh: '移除已读记录',       en: 'Clear Read Records' },
  'reading.confirmBatch':  { zh: '确认对',             en: 'Confirm' },
  'reading.batchSuffix':   { zh: '条内容执行',         en: 'items with action' },
  'reading.processed':     { zh: '已处理',             en: 'Processed' },
  'reading.exported':      { zh: '已导出',             en: 'Exported' },
  'reading.noExport':      { zh: '没有可导出的内容',   en: 'Nothing to export' },
  'reading.exportFailed':  { zh: '导出失败',           en: 'Export failed' },
  'reading.opFailed':      { zh: '操作失败',           en: 'Operation failed' },
  'reading.loadFailed':    { zh: '加载失败',           en: 'Load failed' },
  'reading.noTitle':       { zh: '无标题',             en: 'No Title' },
  'reading.unknownSource': { zh: '未知来源',           en: 'Unknown Source' },
  'reading.laterBadge':    { zh: '♡ 稍后读',          en: '♡ Later' },
  'reading.favBadge':      { zh: '♡ 收藏',            en: '♡ Favorite' },
  'reading.readBadge':     { zh: '已读',               en: 'Read' },
  'reading.today':         { zh: '今天',               en: 'Today' },
  'reading.yesterday':     { zh: '昨天',               en: 'Yesterday' },
  'reading.unknownDate':   { zh: '未知日期',           en: 'Unknown Date' },
  'reading.dateFormat':    { zh: '${m}月${d}日 星期${wd}', en: '${wd}, ${m}/${d}' },

  // 通用日期/计数
  'common.unknownDate':    { zh: '未知日期',           en: 'Unknown Date' },
  'common.dateFormat':     { zh: '${m}月${d}日 星期${wd}', en: '${wd}, ${m}/${d}' },
  'common.itemCount':      { zh: '${n} 条',            en: '${n} items' },
  'common.weekdays':       { zh: ['日','一','二','三','四','五','六'], en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },

  // 登录弹窗（LoginModal）
  'login.title':           { zh: '登录全网情报系统',   en: 'Sign In' },
  'login.subtitle':        { zh: '写操作与管理功能需要登录', en: 'Login required for write operations' },
  'login.username':        { zh: '用户名',             en: 'Username' },
  'login.password':        { zh: '密码',               en: 'Password' },
  'login.submit':          { zh: '登录',               en: 'Sign In' },
  'login.logging':         { zh: '登录中…',            en: 'Signing in…' },
  'login.skip':            { zh: '暂不登录（只读浏览）', en: 'Continue as Guest (Read-only)' },
  'login.inputRequired':   { zh: '请输入用户名和密码', en: 'Please enter username and password' },
  'login.failed':          { zh: '登录失败',           en: 'Login failed' },

  // 通用
  'common.loading':        { zh: '加载中…',            en: 'Loading…' },
};

// ─── Provider ───
function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('qwis.lang') || 'zh'; } catch { return 'zh'; }
  });

  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem('qwis.lang', l); } catch {}
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  }, [lang, setLang]);

  const t = useCallback((key, fallback) => {
    const entry = DICT[key];
    if (!entry) return fallback || key;
    return entry[lang] ?? entry.zh ?? key;
  }, [lang]);

  return (
    <I18nCtx.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nCtx.Provider>
  );
}

// ─── Hook ───
function useI18n() {
  return useContext(I18nCtx);
}

export { LanguageProvider, useI18n };

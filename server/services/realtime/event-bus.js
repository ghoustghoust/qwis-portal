// 实时事件总线（SSE 推送核心）
// 职责：后端抓取到新文章时发布事件，前端 SSE 消费实现实时感知
// 设计：进程内 EventEmitter + SSE 长连接（无第三方依赖）

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200); // 支持大量 SSE 并发连接

// 事件类型常量
const EVENTS = {
  NEW_ARTICLES: 'new_articles',     // 新文章入库
  TRANSLATION: 'translation',       // 翻译完成
  SOURCE_UPDATE: 'source_update',   // 源状态变更
};

/**
 * 发布新文章事件
 * @param {object} payload - { sourceId, sourceName, count, latestTitle }
 */
function emitNewArticles(payload) {
  bus.emit(EVENTS.NEW_ARTICLES, {
    type: EVENTS.NEW_ARTICLES,
    ts: new Date().toISOString(),
    ...payload,
  });
}

/**
 * 发布翻译完成事件
 * @param {object} payload - { articleId, translatedTitle }
 */
function emitTranslation(payload) {
  bus.emit(EVENTS.TRANSLATION, {
    type: EVENTS.TRANSLATION,
    ts: new Date().toISOString(),
    ...payload,
  });
}

/**
 * 发布源状态变更事件
 */
function emitSourceUpdate(payload) {
  bus.emit(EVENTS.SOURCE_UPDATE, {
    type: EVENTS.SOURCE_UPDATE,
    ts: new Date().toISOString(),
    ...payload,
  });
}

module.exports = { bus, EVENTS, emitNewArticles, emitTranslation, emitSourceUpdate };

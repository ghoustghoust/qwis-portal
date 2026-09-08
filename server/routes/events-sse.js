// SSE 实时推送端点
// GET /api/events —— 前端 EventSource 消费，推送新文章/翻译/源状态变更通知
// 协议：标准 text/event-stream，心跳 30s 保活，客户端断线自动清理

const { bus, EVENTS } = require('../services/realtime/event-bus');
const log = require('../util/log');

// 活跃连接计数（调试用）
let connectionCount = 0;

function sseHandler(req, res) {
  // SSE 标准头部
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 不缓冲
  });

  // 发送初始连接确认
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  connectionCount++;
  log.info(`[SSE] 新连接接入，当前在线: ${connectionCount}`);

  // 事件转发：bus → SSE
  const onNewArticles = (data) => {
    res.write(`event: ${EVENTS.NEW_ARTICLES}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onTranslation = (data) => {
    res.write(`event: ${EVENTS.TRANSLATION}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onSourceUpdate = (data) => {
    res.write(`event: ${EVENTS.SOURCE_UPDATE}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  bus.on(EVENTS.NEW_ARTICLES, onNewArticles);
  bus.on(EVENTS.TRANSLATION, onTranslation);
  bus.on(EVENTS.SOURCE_UPDATE, onSourceUpdate);

  // 心跳保活（30s）
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // 客户端断线清理
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(EVENTS.NEW_ARTICLES, onNewArticles);
    bus.off(EVENTS.TRANSLATION, onTranslation);
    bus.off(EVENTS.SOURCE_UPDATE, onSourceUpdate);
    connectionCount--;
    log.info(`[SSE] 连接关闭，当前在线: ${connectionCount}`);
  });

  // 错误处理
  req.on('error', () => {
    clearInterval(heartbeat);
    bus.off(EVENTS.NEW_ARTICLES, onNewArticles);
    bus.off(EVENTS.TRANSLATION, onTranslation);
    bus.off(EVENTS.SOURCE_UPDATE, onSourceUpdate);
    connectionCount--;
  });
}

// 统计接口（供调试/监控）
function statsHandler(req, res) {
  res.json({ ok: true, connections: connectionCount });
}

module.exports = { sseHandler, statsHandler };

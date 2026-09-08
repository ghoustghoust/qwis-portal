// 适配器基类（重构 Phase 4）
// 职责：定义平台适配器的强制契约（ISP 原则 -- 核心方法 + 可选方法分离）
// 不强制继承（现有适配器仍为 plain object），但 registry.register() 会校验契约字段

/**
 * 适配器契约（文档化）：
 *
 * 必须实现：
 *   type: string                    -- 适配器唯一标识（如 'rss', 'bilibili', 'douyin'）
 *   match(input: string): object|false -- URL/输入识别，返回解析参数或 false
 *   fetch(source, ctx): Promise<{articles: [], videos: []}>  -- 拉取内容并入库
 *
 * 可选（有默认行为）：
 *   resolve(input: string): Promise<{name, url, uid?, avatar?, extra?}> -- 解析输入为订阅源字段
 *   defaultIntervalMin: number      -- 默认刷新间隔（分钟），默认 60
 *   capabilities: object            -- 能力声明 { articles, videos, fulltext }
 *   fetchFulltext(url): Promise<{content, summary?, cover?}> -- 全文补抓（需 capabilities.fulltext=true）
 *   cleanContent(html): string      -- 内容清洗
 */

// 校验适配器是否满足最小契约
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('适配器必须是 object');
  }
  if (!adapter.type || typeof adapter.type !== 'string') {
    throw new Error('适配器必须有 type 字段（string）');
  }
  if (typeof adapter.fetch !== 'function') {
    throw new Error(`适配器 ${adapter.type} 必须实现 fetch(source, ctx)`);
  }
  if (typeof adapter.match !== 'function') {
    throw new Error(`适配器 ${adapter.type} 必须实现 match(input)`);
  }
  return true;
}

module.exports = { validateAdapter };

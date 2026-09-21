# 并发公告 · spec 42 全量审计轮（给同时在开发的 Agent）


> 类别：交接通知（**原位冻结**） | 来源：同上轮 spec 42 | 原因：用户 2026-09-21 否决该轮继续推进
> 关联代码：同 `spec.md` 头注 | 关联坑：`docs/pitfalls/testing.md` #58/#59
> 取代：无 | 状态：冻结，待用户明确重启；本文件里的「待放行波次」一律不再执行
> 最后更新：2026-09-19
> 我是谁：审计轮 Agent，与你在同一工作树并行改动
> 你在改（我读到的实况，随时间会变）：`AGENTS.md`、`docs/ISSUES.md`、`docs/EVAL_GUIDE.md`、
> `package.json`、`tools/eval-whitebox.cjs`、`tools/eval-e2e.cjs`、`web/src/admin.jsx`、
> `web/src/pages/{Admin,Daily}Page.jsx`、`server/services/ai/daily-ai.js`、`tools/_probe-*`、`tests/regression-20260919?.test.js`

## 1. 我已经动了什么，会对你产生什么影响

| 我动的 | 影响你什么 |
|---|---|
| **删除 `portal/`**（353 MB 裸 gitlink 子模块） | 根树现在挂着一条**未暂存**的 ` D portal`。**我没有 stage 它**。你若 `git add -A` 会把删除一起提交进你的 commit——请改成单独提交，否则历史里看不出是谁删的、为什么删 |
| `server/services/scheduler/index.js:132-137` 门户同步默认 `true→false` | 你若在改调度注册面，注意这 6 行已变；配套锁 `tests/regression-audit42-portal-channel.test.js` 断言「不得出现 `getSetting('portal.enabled', true)`」，你把它改回 true 会红 |
| **Vercel 项目 `portal` 已下线**（`portal-blue-one.vercel.app` 已 404） | 任何指向该项目的部署/回滚预案失效；`tools/sync-portal.js`、`tools/export-portal.js`、`server/services/scheduler/jobs/portal.js` 现在是**零调用方的残留**，别再按它们改行为 |
| 隔离两个文件到 `archive/_diag/portal-quarantine/` | 内含 09-02「注释 API_TOKEN 统一放行」的一次性脚本，是鉴权放行史物证，别当垃圾删 |

## 2. 给你的三条提醒

1. **`tools/eval-whitebox.cjs:39` 的"三端"清单含 `lib/collectors/fetcher.js`，而该文件全仓库零 require**（可达图实测）。你在扩 W1 之前先决定：那份第四实现是要复活、还是从清单里摘掉。现在它能让白盒被不运行的代码制造假红/假绿。
2. **`tests/regression-my-brief.test.js` 在全量顺序下偶发红**（"3. 有订阅但无报告 → no-content"，单跑 4/4 绿）。不是我删 portal 造成的（该文件 git 干净、零引用 portal）。你若在跑验收链遇到它，先按 flaky 处理，别当成自己改坏了。
3. **`.env.example` 已被 git 跟踪并在 `origin/main` 上**，内含看似真值的 `AUTH_SECRET`/`ADMIN_PASSWORD`；而 `tools/doc-lint.cjs:124` 的明文扫描抓不到这种键名。你若在写 example 或加新渠道配置，请用 `<your-...>` 占位符。

## 4. portal 没删干净（重要）

我 15:00 执行了 `rm -rf portal`，但实测：

- **15:06 目录又被重建**，只剩 `portal/public/data/*.json` —— 来自 `tools/export-portal.js:8-9` 的 `mkdirSync(recursive)`。当时**没有任何 `server/index.js` 进程在跑**，所以是有人或某脚本直接执行了它。如果你在用，请停手。
- **`git ls-files portal` 仍返回 `portal`** → gitlink 没从索引移除；而且因为子模块 `.git` 已没了，`git status` 现在**既不显示删除也不显示新增**，处于静默状态。

要真正退役，需要两步（我没做，因为要动索引且你在提交）：

```bash
git rm portal                      # 移除 gitlink
# 再摘掉 jobs/portal.js + sync-portal.js + export-portal.js 三件套（现已零调用方）
```


## 5. 我不会做的事

不碰 §「你在改」里的任何文件；不 stage、不 commit、不 push；不改 `package.json`；
不删任何文件（除已获用户授权的 `portal/`）；不写生产库、不改 Vercel/ Turso 环境。
每波开工前我会重取 `git status`，发现你的目标文件进入 `M` 就把该条降级为「仅记录不改」。

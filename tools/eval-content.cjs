#!/usr/bin/env node
/**
 * 41-8 内容质量评测的 Node 侧转发（正文 docs/EVAL_GUIDE.md §5，小 spec docs/specs/41-e2e-whitebox-eval/spec.md 41-8）
 *
 * 为什么要一层 Node：
 *  1) 云端域名只有一个真值来源（lib/cloud-site.js）。Python 侧再写一遍就是第 6 份副本——
 *     本轮刚因此修掉一个"巡检脚本 8 天在打 404 域名"的缺陷（B64/坑 #42），不能再犯。
 *  2) 解释器找不到属于 fail_env（EVAL_GUIDE §3.1：环境没就绪 ≠ 产品失败），要如实退 2 而不是退 1。
 * 用法：npm run eval:content -- --self-test | --build-golden --limit 8 | --judge
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { CLOUD_SITE } = require('../lib/cloud-site');

function findPython() {
  for (const cand of (process.env.EVAL_PYTHON ? [process.env.EVAL_PYTHON] : ['python3', 'python'])) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cand;
  }
  return null;
}

const py = findPython();
if (!py) {
  console.error('没找到 python3/python —— 这是 fail_env（环境未就绪），不是产品失败。'
    + '装好 Python 3 或用 EVAL_PYTHON 指定解释器路径后重跑。');
  process.exit(2);
}

const r = spawnSync(py, [path.join(__dirname, 'eval-content', 'run.py'), ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CLOUD_SITE: process.env.CLOUD_SITE || CLOUD_SITE, PYTHONIOENCODING: 'utf-8' },
});
// stdio: 'inherit' + 原样转发退出码：中间不加管道，否则退出码会被 shell 工具吞掉（坑 #40 的同类）
process.exit(r.status === null ? 2 : r.status);

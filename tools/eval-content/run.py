"""41-8 内容质量评测入口（EVAL_GUIDE §5）。由 `npm run eval:content` 转发调用。

三种运行形态，默认落在最便宜的那一档：
  --self-test        只验计分与判据（零网络、零花费）
  默认 / --dry-run    跑通"取样本 → 构造 prompt → 计分 → 出报告"，评委用 stub，报告标 counts_as_judgment=False
  --judge            真的请模型打分（花 AI 配额，必须显式加这个开关）
为什么这么分：线上 `ai.minIntervalMs=0`（BL8）时，任何"顺手打一轮模型"都是在烧免费池（坑 #A1）。

golden set 冻结规则（§5.3 第 4 条）：被评样本集固定并带抓取时间，**不许用刚改完的产物当样本再让同一个模型评**。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from judge import JUDGE_PROMPT_VERSION, judge_once, parse_scores
from scoring import (AXES, AXIS_ALERT, AXIS_WEIGHTS, PRODUCT_ALERT, ScoreError,
                     alignment_rate, force_utf8_stdout, weighted_score)

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "eval" / "content"


def http_json(url: str, timeout: int = 30) -> dict[str, Any]:
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    opener = (urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
              if proxy else urllib.request.build_opener())
    with opener.open(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# 参照物字段清单。按 2026-09-19 实测线上 `/api/articles/<id>` 的载荷键顺序写：
# item 里真有正文的是 `content_html` / `original_html`（第一版我按 `content`/`body` 猜，结果 6 条样本
# 全部"无参照物"——猜参数这件事在 EVAL_GUIDE §3.3 与坑 #42 里各写过一次，今天我自己又犯第三次）。
REF_FIELDS = ("content_html", "original_html", "content", "body")


def pick_reference(item: dict[str, Any]) -> tuple[str | None, str]:
    for f in REF_FIELDS:
        v = item.get(f)
        if v and len(str(v).strip()) > 200:
            return str(v)[:8000], f
    return None, ""


def build_golden(base_url: str, limit: int, tag: str | None = None) -> dict[str, Any]:
    """从线上读层取样本（只读）。`reference` 取文章原文正文；取不到就标 has_reference=False。"""
    daily = http_json(f"{base_url}/api/daily")
    sections = ((daily.get("report") or {}).get("sections")) or []
    samples: list[dict[str, Any]] = []
    for sec in sections:
        for it in (sec.get("items") or []):
            if len(samples) >= limit:
                break
            text = " ".join(str(it.get(k) or "") for k in ("title", "summary", "reason")).strip()
            if not text:
                continue
            ref, has_ref, ref_field = None, False, ""
            art_id = it.get("id") or it.get("article_id")
            if art_id:
                try:
                    art = http_json(f"{base_url}/api/articles/{art_id}")
                    ref, ref_field = pick_reference(art.get("item") or {})
                    has_ref = ref is not None
                except Exception:
                    ref, ref_field = None, ""   # 拿不到原文就是没参照物，不许拿标题当原文
            samples.append({
                "id": f"daily-{art_id or len(samples)}",
                "kind": "daily_item",
                "column": sec.get("column"),
                "output": {"title": it.get("title"), "summary": it.get("summary"), "reason": it.get("reason")},
                "reference": ref,
                "ref_field": ref_field,
                "has_reference": has_ref,
                "source_url": f"{base_url}/api/daily",
            })
        if len(samples) >= limit:
            break
    return {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_url": base_url,
        "n": len(samples),
        "note": "冻结集：新样本进新文件，不覆写旧集（§5.3 第 4 条）",
        "samples": samples,
    }


def to_task_input(sample: dict[str, Any]) -> dict[str, Any]:
    out = sample.get("output")
    return {
        "kind": sample.get("kind", "unknown"),
        "output": json.dumps(out, ensure_ascii=False) if isinstance(out, (dict, list)) else str(out),
        "reference": sample.get("reference"),
        "has_reference": bool(sample.get("has_reference")),
    }


def run_pipeline(golden: dict[str, Any], *, use_judge: bool, timeout: int) -> dict[str, Any]:
    products, warnings, errors = [], [], []
    for s in golden.get("samples") or []:
        try:
            j = judge_once(to_task_input(s), allow_network=use_judge, timeout=timeout)
        except ScoreError as e:
            errors.append({"id": s.get("id"), "error": str(e)})
            continue
        except Exception as e:
            errors.append({"id": s.get("id"), "error": f"{type(e).__name__}: {str(e)[:160]}"})
            continue
        raw = {k: v for k, v in j["scores"].items() if v is not None}
        try:
            ps = weighted_score(str(s.get("id")), raw, has_reference=bool(s.get("has_reference")))
        except ScoreError as e:
            errors.append({"id": s.get("id"), "error": str(e)})
            continue
        products.append({"id": ps.product_id, "kind": s.get("kind"), "score": ps.score,
                         "axis_norm": ps.axis_norm, "axis_raw": ps.axis_raw,
                         "counted_axes": list(ps.counted_axes), "axis_alerts": list(ps.axis_alerts),
                         "product_alert": ps.product_alert, "note": ps.note,
                         "feedback": j.get("feedback", ""), "engine": j.get("engine"),
                         "counts_as_judgment": j.get("counts_as_judgment")})
        for a in ps.axis_alerts:
            warnings.append({"id": ps.product_id, "axis": a, "norm": ps.axis_norm[a], "threshold": AXIS_ALERT})
        if ps.product_alert:
            warnings.append({"id": ps.product_id, "axis": "*", "norm": ps.score, "threshold": PRODUCT_ALERT})

    judged = [p for p in products if p["counts_as_judgment"]]
    return {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "golden": {"created_at": golden.get("created_at"), "n": golden.get("n"), "base_url": golden.get("base_url")},
        "axis_weights": AXIS_WEIGHTS,
        "judge_prompt_version": JUDGE_PROMPT_VERSION,
        # 这一行是整个工具的诚实性所在：stub 跑出来的东西**不是**一次评测结果
        "counts_as_judgment": bool(judged),
        # stub 轮次也会算出"低分告警"（占位分一律 3 → 归一 0.5 < 0.60），
        # 但这些不是产品告警。不隔开就会有人把 36 条假告警灌进 ISSUES（坑 #43 的同族）。
        "warnings_advisory": not judged,
        "n_products": len(products), "n_judged": len(judged),
        "mean_score": round(sum(p["score"] for p in judged) / len(judged), 4) if judged else None,
        "products": products, "warnings": warnings, "errors": errors,
    }


def exit_code_of(rep: dict[str, Any]) -> int:
    """0=真验过且无解析错；1=有解析错（产品/契约问题）；2=什么都没评到（fail_env，视为未评测）。

    旧写法 `return 1 if errors else 0` 的空 golden 轮次会退 0 —— "没测"和"测过没问题"必须可区分（坑 #43 同族）。
    """
    if rep.get("errors"):
        return 1
    if not rep.get("n_products"):
        return 2
    return 0


def latest_golden() -> Path | None:
    if not OUT_DIR.exists():
        return None
    files = sorted(OUT_DIR.glob("golden-*.json"))
    return files[-1] if files else None


def self_test() -> int:
    """工具级探针：主要防两件事——把 stub 当成果、把趋势写脏。"""
    probes = []
    fake = {"created_at": "x", "n": 1, "samples": [{"id": "a", "kind": "daily_item",
            "output": {"title": "t", "summary": "s", "reason": "r"}, "reference": None, "has_reference": False}]}
    rep = run_pipeline(fake, use_judge=False, timeout=5)
    probes.append(("stub 跑出来的报告必须标 counts_as_judgment=False", rep["counts_as_judgment"] is False))
    probes.append(("stub 轮次不产生均值（均值只统计真评）", rep["mean_score"] is None and rep["n_judged"] == 0))
    probes.append(("无参照物的样本不进事实轴计分母", rep["products"][0]["counted_axes"] and "factual_correctness" not in rep["products"][0]["counted_axes"]))
    # 出错路径用真行为验：要真评但没凭据 → judge_once 抛错 → 必须落进 errors、不许静默丢样本、也不许退化成 stub。
    # 先把凭据摘掉再跑：自检**绝不能**真打模型（会花 AI 配额，BL8/坑 #A1 就是这个原因）
    saved = {k: os.environ.pop(k, None) for k in ("AGNES_API_KEY", "AGNES_MODEL", "AGNES_JUDGE_MODEL")}
    try:
        no_cred = run_pipeline(fake, use_judge=True, timeout=5)
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v
    probes.append(("管线出错要进 errors 而不是静默丢样本",
                   len(no_cred["errors"]) == 1 and len(no_cred["products"]) == 0 and no_cred["counts_as_judgment"] is False))
    probes.append(("自检不许真打模型（摘掉凭据后必须走异常分支而不是网络）",
                   "AGNES_API_KEY" not in os.environ and bool(no_cred["errors"][0]["error"])))
    probes.append(("一条产物都没有 → 退出码属未评测（2），不是成功（0）", exit_code_of({"n_products": 0, "n_judged": 0, "errors": []}) == 2))
    probes.append(("有产物无错 → 0；有解析错 → 1", exit_code_of({"n_products": 3, "n_judged": 3, "errors": []}) == 0
                   and exit_code_of({"n_products": 3, "n_judged": 3, "errors": [{"id": "x"}]}) == 1))
    probes.append(("权重与阈值随报告落盘（换配置必须可追）", rep["axis_weights"] == AXIS_WEIGHTS and "judge_prompt_version" in rep))
    probes.append(("stub 轮次的告警必须标成 advisory，不许灌进 ISSUES", rep["warnings_advisory"] is True))
    probes.append(("参照物字段清单第一位是线上真实键 content_html（猜错过一次）", REF_FIELDS[0] == "content_html"))
    probes.append(("正文太短不算有参照物", pick_reference({"content_html": "只有一句话"}) == (None, "")))
    probes.append(("够长的正文才被当作参照物", pick_reference({"content_html": "字" * 300})[1] == "content_html"))

    judged_rep = {"products": [{"id": "a", "counts_as_judgment": True, "axis_raw": {"clarity": 4, "redundancy": 5}},
                               {"id": "b", "counts_as_judgment": True, "axis_raw": {"clarity": 2}},
                               {"id": "c", "counts_as_judgment": True, "axis_raw": {"clarity": 5}},
                               {"id": "d", "counts_as_judgment": True, "axis_raw": {"clarity": 3}}]}
    probes.append(("没给人工对齐文件时不写趋势（judge 分数不算数）", collect_alignment(judged_rep, None)["usable"] is False))
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p_all = Path(td) / "align.json"
        p_all.write_text(json.dumps({"scores": {"a": {"clarity": 4, "redundancy": 5}, "b": {"clarity": 2},
                                               "c": {"clarity": 5}, "d": {"clarity": 3}}}), encoding="utf-8")
        probes.append(("人工分与 judge 分覆盖 ≥3 条产物且够一致时才判可用", collect_alignment(judged_rep, p_all)["usable"] is True))
        p_part = Path(td) / "part.json"
        p_part.write_text(json.dumps({"scores": {"a": {"clarity": 4}, "b": {"clarity": 2}, "c": {"clarity": 5}}}), encoding="utf-8")
        ca = collect_alignment(judged_rep, p_part)
        probes.append(("缺人工样本的产物要被点名，不静默忽略", ca["missing_human"] == ["d"]))
        p_two = Path(td) / "two.json"
        p_two.write_text(json.dumps({"scores": {"a": {"clarity": 4, "redundancy": 5}, "b": {"clarity": 2}}}), encoding="utf-8")
        probes.append(("一条产物凑出 5 对不算 5 条证据：覆盖 <3 条产物必须判不可用",
                       collect_alignment(judged_rep, p_two)["usable"] is False))
        p_none = Path(td) / "none.json"
        p_none.write_text(json.dumps({"scores": {"zzz": {"clarity": 5}}}), encoding="utf-8")
        probes.append(("对齐文件与本轮产物完全对不上时必须判不可用", collect_alignment(judged_rep, p_none)["usable"] is False))
    failed = [n for n, ok in probes if not ok]
    for n, ok in probes:
        print(f"  {'✓' if ok else '✗'} {n}")
    print(f"content run 自检：{len(probes) - len(failed)}/{len(probes)} 通过")
    return 1 if failed else 0


def collect_alignment(rep: dict[str, Any], human_path: Path | None) -> dict[str, Any]:
    """judge 与人工的一致率（§5.3 第 5 条）。

    人工文件格式：`{"scores": {"<产物 id>": {"clarity": 4, ...}}}`（1~5，缺轴就少配几对）。
    没给文件 / 没一条对得上 → usable=False，趋势不写：**没有对齐证据时，judge 分数不算数**。
    """
    if not human_path or not human_path.exists():
        return {"n": 0, "rate": None, "usable": False, "why": "没给人工对齐文件（--align），本轮 judge 分数只作参考"}
    human = (json.loads(human_path.read_text(encoding="utf-8")).get("scores") or {})
    pairs, missing, aligned_products = [], [], 0
    for p in rep["products"]:
        if not p.get("counts_as_judgment"):
            continue
        h = human.get(str(p["id"])) or {}
        if not h:
            missing.append(p["id"])
            continue
        aligned_products += 1
        for a, hv in h.items():
            if a in p["axis_raw"]:
                pairs.append((p["axis_raw"][a], hv))
    res = alignment_rate(pairs)
    res["missing_human"] = missing
    res["n_products_aligned"] = aligned_products
    if not pairs:
        res.update({"usable": False, "why": "对齐文件里没有一条与本轮真评产物对得上"})
    elif aligned_products < 3:
        # §5.3 第 5 条说的是"每轮随机 3 条产物"，不是 3 个数字：一条产物凑出 5 对不算 5 条证据
        res.update({"usable": False, "why": f"人工对齐只覆盖 {aligned_products} 条产物，不足 3 条（§5.3 第 5 条）"})
    return res


def main(argv: list[str]) -> int:
    force_utf8_stdout()
    ap = argparse.ArgumentParser(prog="eval-content")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--build-golden", action="store_true")
    ap.add_argument("--base-url", default=os.environ.get("CLOUD_SITE", ""))
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--golden", default="")
    ap.add_argument("--judge", action="store_true", help="真请模型打分（花 AI 配额）")
    ap.add_argument("--align", default="", help="人工对齐分数 JSON；缺它则 judge 分数不写趋势（§5.3 第 5 条）")
    ap.add_argument("--timeout", type=int, default=60)
    a = ap.parse_args(argv[1:])

    if a.self_test:
        from judge import self_test as jst
        from scoring import self_test as sst
        print("— scoring —"); rc1 = sst()
        print("— judge —"); rc2 = jst()
        print("— run —"); rc3 = self_test()
        return max(rc1, rc2, rc3)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if a.build_golden:
        if not a.base_url:
            print("缺 --base-url（或环境变量 CLOUD_SITE）；云端域名由 Node 侧 lib/cloud-site.js 提供，本工具不再写死第二份", file=sys.stderr)
            return 2
        g = build_golden(a.base_url, a.limit)
        path = OUT_DIR / f"golden-{time.strftime('%Y%m%d-%H%M%S')}.json"
        path.write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"golden 冻结：{path.relative_to(ROOT)}（{g['n']} 条，含参照物 {sum(1 for s in g['samples'] if s['has_reference'])} 条）")
        return 0

    src = Path(a.golden) if a.golden else latest_golden()
    if not src or not src.exists():
        print("没有 golden 集。先跑：npm run eval:content -- --build-golden --limit 8", file=sys.stderr)
        return 2
    golden = json.loads(src.read_text(encoding="utf-8"))
    rep = run_pipeline(golden, use_judge=a.judge, timeout=a.timeout)
    out = OUT_DIR / f"report-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"golden={src.name} 产物={rep['n_products']} 真评={rep['n_judged']} 告警={len(rep['warnings'])} 出错={len(rep['errors'])}")
    print(f"报告：{out.relative_to(ROOT)}  counts_as_judgment={rep['counts_as_judgment']}")
    if not rep["counts_as_judgment"]:
        print(f"本轮是 stub（没请模型打分）：只证明管线通，**不算一次内容质量评测**，也不写趋势；"
              f"{len(rep['warnings'])} 条告警为参考值（warnings_advisory=true），不进 ISSUES。")
    else:
        al = collect_alignment(rep, Path(a.align) if a.align else None)
        rep["alignment"] = al
        out.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
        if al["usable"]:
            _append_trend(rep)
            print(f"人工对齐一致率 {al['rate']}（{al['n']} 对）→ 趋势已写入 trend.json")
        else:
            low = "一致率 " + str(al["rate"]) + " 低于阈值"
            print("趋势未写入：" + (al.get("why") or low))
    # 退出码：没产物=2（未评测，EVAL_GUIDE §9）；有解析错=1；否则 0。
    # 分数低**不影响退出码** —— LLM 分不作唯一门禁（§5.3 第 2 条），低分走 ISSUES 人工复核。
    return exit_code_of(rep)


def _append_trend(rep: dict[str, Any]) -> None:
    tp = OUT_DIR / "trend.json"
    trend = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else []
    trend.append({"at": rep["at"], "mean_score": rep["mean_score"], "n": rep["n_judged"],
                  "judge_prompt_version": rep["judge_prompt_version"]})
    tp.write_text(json.dumps(trend, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

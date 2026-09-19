"""41-8 计分口径（唯一实现）。正文：`docs/EVAL_GUIDE.md` §5.2 / §5.3。

三条不能靠"感觉"的规则，全部在这里变成可测函数：
1. 归一化 `norm(v) = (v-1)/4`，越界一律拒绝而不是夹紧——夹紧要写死在报告里说明，静默夹紧会掩盖 judge 乱给分；
2. 加权分母随"无参照物的轴"同步扣除（§5.2：没依据就不许打事实分，也不许让它把总分拉低/拉高）；
3. judge 分数**不是门禁**（§5.3：自动校验准确率有限）。这里只产出"告警清单"，是否升级由 EVAL_GUIDE 的
   连续 ≥3 轮规则决定，而那件事由 Node 侧门禁和 ISSUES 负责，本模块不越权判定"通过/不通过"。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

AXES: tuple[str, ...] = (
    "clarity",
    "factual_correctness",
    "consistency",
    "redundancy",
    "readability",
)

# 默认权重（改动必须记进 env_lock，EVAL_GUIDE §5.2）：最怕编造与自相矛盾，排版与简洁次之
AXIS_WEIGHTS: dict[str, float] = {
    "factual_correctness": 0.30,
    "consistency": 0.25,
    "clarity": 0.20,
    "redundancy": 0.15,
    "readability": 0.10,
}

AXIS_LABELS_ZH: dict[str, str] = {
    "clarity": "表达清晰度",
    "factual_correctness": "事实正确性",
    "consistency": "前后一致性",
    "redundancy": "简洁度",
    "readability": "易读性",
}

AXIS_ANCHORS: dict[str, str] = {
    # 每轴锚在一次真实事故上，不做空泛打分（EVAL_GUIDE §5.1）
    "clarity": "T5-13 用户原话「有的文章不知道在说什么」",
    "factual_correctness": "坑 #A2 胡编标题与占位金句 / 坑 #26 思维链当正文",
    "consistency": "坑 #32 裸报遮蔽 AI 版 / B10 栏目注解错位",
    "redundancy": "B16 周刊导语污染第四次复现",
    "readability": "B8 综述与详情无排版（spec 32）",
}

AXIS_ALERT = 0.60    # 单轴 norm 低于此值 → 该轴告警
PRODUCT_ALERT = 0.70  # 加权总分低于此值 → 产物级告警
ALIGNMENT_MIN = 0.70  # judge 与人工一致率低于此值 → 本轮 judge 结果只作参考，不写趋势


class ScoreError(ValueError):
    pass


def norm(v: float, lo: float = 1.0, hi: float = 5.0) -> float:
    """1~5 分 → 0~1。越界直接抛：宁可报错也不要静默夹紧（夹紧会让乱给分看起来正常）。"""
    f = float(v)
    if f < lo or f > hi:
        raise ScoreError(f"评分 {v} 不在 [{lo},{hi}] 区间——judge 输出异常，本轮该产物作废而不是夹紧")
    return (f - lo) / (hi - lo)


@dataclass
class ProductScore:
    product_id: str
    axis_raw: dict[str, float]
    axis_norm: dict[str, float]
    counted_axes: tuple[str, ...]
    score: float
    weight_sum: float
    axis_alerts: tuple[str, ...]
    product_alert: bool
    note: str = ""


def weighted_score(product_id: str, raw: dict[str, float], *, has_reference: bool = True,
                   weights: dict[str, float] | None = None, drop_axes: Iterable[str] = ()) -> ProductScore:
    """按 EVAL_GUIDE §5.2 加权。

    `has_reference=False` → 扣掉 factual_correctness 的权重并把它从分母里去掉（不是给 0 分，也不是给满分）。
    `drop_axes` 供产物类型本身没有某轴时使用（例如没有排版的纯 reason 字段不评 readability）。
    """
    w = dict(weights or AXIS_WEIGHTS)
    drop = set(drop_axes)
    if not has_reference:
        drop.add("factual_correctness")
    counted = tuple(a for a in AXES if a in raw and a not in drop)
    if not counted:
        raise ScoreError(f"{product_id}: 一个可计分的轴都没有，等于没评")
    missing = [a for a in counted if a not in w]
    if missing:
        raise ScoreError(f"{product_id}: 这些轴没有权重定义，权重表与轴表已不一致：{missing}")

    axis_norm = {a: norm(raw[a]) for a in counted}
    wsum = sum(w[a] for a in counted)
    score = sum(w[a] * axis_norm[a] for a in counted) / wsum
    alerts = tuple(a for a in counted if axis_norm[a] < AXIS_ALERT)
    return ProductScore(
        product_id=product_id,
        axis_raw={a: float(raw[a]) for a in AXES if a in raw},
        axis_norm=axis_norm,
        counted_axes=counted,
        score=round(score, 4),
        weight_sum=round(wsum, 4),
        axis_alerts=alerts,
        product_alert=score < PRODUCT_ALERT,
        note="" if has_reference else "无参照物：factual_correctness 不计入加权（分母已扣除）",
    )


def alignment_rate(pairs: Iterable[tuple[float, float]], tolerance: float = 1.0, min_samples: int = 3) -> dict[str, Any]:
    """judge 与人工打分的一致率（§5.3 第 5 条）：逐轴差 ≤ tolerance 视为一致。"""
    ps = [(float(a), float(b)) for a, b in pairs]
    if not ps:
        return {"n": 0, "rate": None, "usable": False, "why": "本轮没有人工对齐样本"}
    agree = sum(1 for a, b in ps if abs(a - b) <= tolerance)
    rate = agree / len(ps)
    if len(ps) < min_samples:
        # 样本太少时即使全对也不算可用：1 条恰好一致就放行，等于用噪声给整轮 judge 分数背书
        return {"n": len(ps), "rate": round(rate, 4), "usable": False,
                "why": f"人工对齐只有 {len(ps)} 对，不足 {min_samples} 对（§5.3 第 5 条），本轮 judge 分数只作参考"}
    return {"n": len(ps), "rate": round(rate, 4), "usable": rate >= ALIGNMENT_MIN,
            "why": "" if rate >= ALIGNMENT_MIN else f"一致率 {rate:.2f} < {ALIGNMENT_MIN}，本轮 judge 结果只作参考、不写趋势"}


def force_utf8_stdout() -> None:
    """Windows 控制台默认 GBK，打 `✓`/中文就 UnicodeEncodeError 崩掉整轮评测（本项目踩过的老坑，
    而且是在**已经跑完**之后才崩——等于白跑）。任何入口第一件事就是调它。"""
    import sys

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass


def self_test() -> int:
    """负向 + 正向都必须在：一个没人验证的计分器就是下一个假门禁。"""
    probes: list[tuple[str, bool]] = []

    ok = norm(1) == 0.0 and norm(5) == 1.0 and abs(norm(3) - 0.5) < 1e-12
    probes.append(("norm 端点与中点", ok))
    try:
        norm(6)
        probes.append(("越界评分必须抛错（不许夹紧）", False))
    except ScoreError:
        probes.append(("越界评分必须抛错（不许夹紧）", True))
    try:
        norm(0)
        probes.append(("低于 1 分同样抛错", False))
    except ScoreError:
        probes.append(("低于 1 分同样抛错", True))

    full = {a: 5 for a in AXES}
    s5 = weighted_score("t1", full)
    probes.append(("全 5 分 → score=1", s5.score == 1.0))
    s1 = weighted_score("t2", {a: 1 for a in AXES})
    probes.append(("全 1 分 → score=0 且告警", s1.score == 0.0 and len(s1.axis_alerts) == len(AXES)))

    # 无参照物：扣掉事实轴后，其余轴满分就该得满分（分母没扣就会永远卡在 0.7）
    no_ref = {a: 5 for a in AXES}
    no_ref["factual_correctness"] = 1
    snr = weighted_score("t3", no_ref, has_reference=False)
    probes.append(("无参照物时事实轴不计分母（其余满分→总分 1）", snr.score == 1.0 and snr.weight_sum < 1.0))

    w_partial = weighted_score("t4", {a: 3 for a in AXES})
    probes.append(("全 3 分 → 加权 0.5（权重和归一，不受权重表规模影响）", abs(w_partial.score - 0.5) < 1e-9))

    # 权重表与轴表必须一致（改一处忘改另一处是本项目最频繁的错）
    probes.append(("权重表覆盖全部轴", set(AXIS_WEIGHTS) == set(AXES)))
    probes.append(("轴锚点覆盖全部轴（不做空泛打分）", set(AXIS_ANCHORS) == set(AXES)))
    probes.append(("轴中文名覆盖全部轴", set(AXIS_LABELS_ZH) == set(AXES)))
    probes.append(("权重合计为 1", abs(sum(AXIS_WEIGHTS.values()) - 1.0) < 1e-9))

    try:
        weighted_score("t5", {}, has_reference=False)
        probes.append(("一个轴都没有时必须抛错", False))
    except ScoreError:
        probes.append(("一个轴都没有时必须抛错", True))

    alerts = weighted_score("t6", {"clarity": 2, "factual_correctness": 5, "consistency": 5, "redundancy": 5, "readability": 5})
    probes.append(("低分轴必须单独点出来", alerts.axis_alerts == ("clarity",) and not alerts.product_alert))

    al = alignment_rate([(4, 4), (5, 4), (2, 5)])
    probes.append(("一致率计算正确（2/3 且低于阈值判不可用）", abs(al["rate"] - 2 / 3) < 1e-3 and al["usable"] is False))
    probes.append(("一致率够高时必须判可用（防判据写成永远不可用）", alignment_rate([(4, 4), (5, 5), (2, 3)])["usable"] is True))
    probes.append(("无人工样本时判 unusable 而不是满分", alignment_rate([])["usable"] is False))
    probes.append(("对齐样本不足 3 对时即使全一致也不可用（§5.3 第 5 条）",
                   alignment_rate([(5, 5), (4, 4)])["usable"] is False))

    failed = [n for n, okv in probes if not okv]
    for n, okv in probes:
        print(f"  {'✓' if okv else '✗'} {n}")
    print(f"content 计分自检：{len(probes) - len(failed)}/{len(probes)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    force_utf8_stdout()
    raise SystemExit(self_test())

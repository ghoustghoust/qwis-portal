"""41-8 评测体系的接口层：与 agentscope.evaluate 同形的本地实现。

为什么不是"直接 import agentscope 就完事"（本机实测：Python 3.14.4，`import agentscope` → ModuleNotFoundError）：
1. 装第三方依赖需要用户点头（本项目的规矩：不静默装系统/语言依赖），而 41-8 的**计分口径与判据**
   属于"现在就要能验证"的部分——它不该被一个 pip 卡住。
2. 更要紧的是纪律：judge 链路会真花钱（AI 配额，见坑 #A1 与 BL8：`ai.minIntervalMs=0` 会 45~60 分钟耗尽免费池）。
   所以这套东西的默认形态必须是"不打模型也能自证计分正确"，打模型是显式开关。

装了 agentscope 之后怎么办：`USE_AGENTSCOPE=True` 时类名与构造签名都对得上，
把本模块换成 `from agentscope.evaluate import Task, MetricBase, MetricResult, MetricType, SolutionOutput`
即可，业务代码不用改；报告里会记 `engine` 字段说明这次用的是哪一套。
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Iterable

try:  # 有就用真的，没有就用同形本地实现（可移植性优先，不牺牲判据）
    from agentscope.evaluate import (  # type: ignore
        MetricBase as _ASMetricBase,
        MetricResult as _ASMetricResult,
        MetricType as _ASMetricType,
        SolutionOutput as _ASSolutionOutput,
        Task as _ASTask,
    )
    USE_AGENTSCOPE = True
except Exception:
    USE_AGENTSCOPE = False


class MetricType(str, Enum):
    NUMERICAL = "numerical"
    BOOLEAN = "boolean"
    CATEGORICAL = "categorical"
    TEXT = "text"


@dataclass
class MetricResult:
    name: str
    result: Any
    metric_type: MetricType = MetricType.NUMERICAL
    message: str = ""


@dataclass
class SolutionOutput:
    """系统实际产出的那段文本（被评对象）。"""
    success: bool = True
    output: Any = None
    message: str = ""


@dataclass
class Task:
    """一个待评产物片段 + **参照物** + 期望约束。

    `reference` 为 None 时必须显式传 `has_reference=False`：
    没依据就不许打"事实正确性"分（EVAL_GUIDE §5.2），该轴要从加权分母里扣掉，而不是默认满分。
    """
    id: str
    instruction: str = ""
    input: Any = None
    reference: Any = None
    expected: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)
    has_reference: bool = True

    metric_names: tuple[str, ...] = ()
    metrics: list["MetricBase"] = field(default_factory=list)

    def add_metric(self, metric: "MetricBase") -> None:
        self.metrics.append(metric)

    def evaluate(self) -> list[MetricResult]:
        return [m() for m in self.metrics]


class MetricBase:
    """指标基类：子类实现 `_evaluate(task) -> MetricResult`。"""

    name: str = "metric"
    metric_type: MetricType = MetricType.NUMERICAL

    def __init__(self, name: str | None = None, **kwargs: Any) -> None:
        if name:
            self.name = name
        for k, v in kwargs.items():
            setattr(self, k, v)

    def _evaluate(self, task: Task) -> MetricResult:  # pragma: no cover - 抽象
        raise NotImplementedError

    def __call__(self, task: Task | None = None) -> MetricResult:
        if task is None:
            raise TypeError(f"{self.name}: MetricBase 必须带 task 调用（不许默认空跑成满分）")
        return self._evaluate(task)


class FunctionMetric(MetricBase):
    """把普通函数包成 MetricBase（本地便利层，agentscope 侧同样适用）。"""

    def __init__(self, name: str, fn: Callable[[Task], MetricResult], metric_type: MetricType = MetricType.NUMERICAL):
        super().__init__(name=name)
        self._fn = fn
        self.metric_type = metric_type

    def _evaluate(self, task: Task) -> MetricResult:
        return self._fn(task)


def to_agentscope(task: Task) -> Any:
    """可选适配器：装了 agentscope 时把本地 Task 换成真对象。"""
    if not USE_AGENTSCOPE:
        raise RuntimeError("本机没装 agentscope；计分与判据用本地同形实现即可（见本文件顶部说明）")
    return _ASTask(id=task.id, instruction=task.instruction, input=task.input, reference=task.reference)


def summary(tasks: Iterable[Task]) -> dict[str, Any]:
    """把一批 Task 的指标结果摊平，给 report.json 用。"""
    out: dict[str, Any] = {"engine": "agentscope" if USE_AGENTSCOPE else "local-mirror", "tasks": []}
    for t in tasks:
        out["tasks"].append({
            "id": t.id,
            "has_reference": t.has_reference,
            "metadata": t.metadata,
            "metrics": [dataclasses.asdict(r) if dataclasses.is_dataclass(r) else vars(r) for r in t.evaluate()],
        })
    return out

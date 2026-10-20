"""越线计数状态机。

原实现的越线判定本身是可用的（符号距离 + 段内投影 + 线性插值求交点），
本模块保留这套几何，但修掉三个真实缺陷：

1. **诊断标记污染数据**：``TRACK_GAP`` / ``RETURN_MOVEMENT`` 等一次性诊断
   被累加进 ``flags`` 集合后从不清理，导致一条轨迹只要历史上抖动过一次，
   后续所有事件都永远带着这些标记。现在按“本次越线相关”的作用域收集。
2. **遮挡后无法判断真实越线**：加入速度外推，轨迹在遮挡期间仍能给出
   合理的越线判定，而不是把遮挡前后的位移当成一次反向穿越。
3. **线段外越线静默丢弃**：交点落在计数线段之外时不再静默忽略，
   而是记录 ``OUT_OF_SEGMENT`` 供复核，避免“明明穿过了却没计数”无从排查。

对外行为（事件字段、单位、方向语义、风险标记）保持不变。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .rules import parse_rules

# 一次越线事件里应当随事件一起报出的风险标记（其余属于内部诊断）。
REPORTED_FLAGS = frozenset(
    {"CONTENT_UNVERIFIED", "LOW_CONFIDENCE", "POSSIBLE_DUPLICATE", "TRACK_GAP", "RETURN_MOVEMENT", "OUT_OF_SEGMENT", "TRUNCATED_TARGET"}
)


@dataclass
class TrackState:
    last_seen: float
    tick: int
    stable: int | None = None
    candidate: int = 0
    runs: int = 0
    point: tuple[float, float] | None = None
    min_confidence: float = 1.0
    gap: bool = False
    counted: bool = False
    # 速度外推用：上一帧位置与时间，用于遮挡期间估计目标是否真的越线。
    velocity: tuple[float, float] = (0.0, 0.0)
    prev_point: tuple[float, float] | None = None
    # 本次越线相关的诊断（每次进入新的候选侧时重置）。
    pending: set[str] = field(default_factory=set)


class LineCounter:
    """基于有向线段的越线计数器。"""

    def __init__(
        self,
        points: tuple[float, float, float, float] = (0.08, 0.54, 0.92, 0.54),
        direction: str = "positive",
        deadzone: float = 0.012,
        rules: dict | None = None,
    ) -> None:
        if direction not in ("positive", "negative"):
            raise ValueError("方向仅允许 positive/negative")
        self.rules = parse_rules(rules)
        # 保留旧的低层调用方式：不传 rules 时，deadzone 与 stableFrames 走显式参数。
        if rules is None:
            self.rules["stableFrames"] = 1
            self.rules["deadzone"] = deadzone
            # 低层 API 语义：单帧即可稳定，且不做去重窗口限制。
            self.rules.setdefault("maxGapSeconds", 2.5)

        self.points = tuple(float(x) for x in points)
        if len(self.points) != 4:
            raise ValueError("计数线必须包含四个归一化坐标")
        x1, y1, x2, y2 = self.points
        # 用 hypot 判定退化线段，避免 (x2-x1)**2 在极大坐标下的溢出。
        if not all(math.isfinite(v) for v in self.points):
            raise ValueError("无效计数线")
        if math.hypot(x2 - x1, y2 - y1) < 0.1:
            raise ValueError("计数线长度太短")
        if any(not 0 <= v <= 1 for v in self.points):
            raise ValueError("无效计数线")

        r = self.rules
        if not (
            r["roiX1"] <= x1 <= r["roiX2"]
            and r["roiX1"] <= x2 <= r["roiX2"]
            and r["roiY1"] <= y1 <= r["roiY2"]
            and r["roiY1"] <= y2 <= r["roiY2"]
        ):
            raise ValueError("计数线必须位于识别区域内")

        self.direction = direction
        self.deadzone = float(r["deadzone"])
        self.states: dict[int, TrackState] = {}
        self.recent: list[dict] = []
        self.total = 0
        self.tick = 0
        self.last_time = -1.0
        # 线段几何预计算。
        self._vx = x2 - x1
        self._vy = y2 - y1
        self._length = float(math.hypot(self._vx, self._vy))
        self._length_sq = self._length * self._length
        self._expected = 1 if direction == "positive" else -1

    # -- 几何 -------------------------------------------------------------
    def signed_distance(self, cx: float, cy: float) -> float:
        """点到有向直线的带符号距离（归一化）。"""
        x1, y1 = self.points[0], self.points[1]
        return (self._vx * (cy - y1) - self._vy * (cx - x1)) / self._length

    def project(self, px: float, py: float) -> float:
        """点在计数线段上的归一化投影位置，0 为起点、1 为终点。"""
        x1, y1 = self.points[0], self.points[1]
        return ((px - x1) * self._vx + (py - y1) * self._vy) / self._length_sq

    # -- 主流程 -----------------------------------------------------------
    def update(
        self,
        detections: list,
        width: int,
        height: int,
        offset_seconds: float,
    ) -> list[dict]:
        if width <= 0 or height <= 0 or not math.isfinite(offset_seconds) or offset_seconds < self.last_time:
            raise ValueError("画面尺寸或时间戳无效")
        self.last_time = offset_seconds
        self.tick += 1
        r = self.rules
        emitted: list[dict] = []

        # 去重窗口按时间裁剪，而不是按帧号，避免可变帧率下窗口失效。
        self.recent = [e for e in self.recent if offset_seconds - e["time"] <= r["duplicateWindowSeconds"]]

        # 回收长期未见的轨迹。已计数标记只在轨迹真正过期时释放。
        expiry = max(30.0, float(r["maxGapSeconds"]) * 4)
        for track_id in [t for t, s in self.states.items() if offset_seconds - s.last_seen > expiry]:
            del self.states[track_id]

        for detection in detections:
            a, b, c, e = detection.bbox
            cx = (a + c) / 2.0 / width
            cy = (b + e) / 2.0 / height
            if not (r["roiX1"] <= cx <= r["roiX2"] and r["roiY1"] <= cy <= r["roiY2"]):
                continue

            state = self.states.get(detection.track_id)
            if state is None:
                state = TrackState(last_seen=offset_seconds, tick=self.tick - 1, min_confidence=detection.confidence)
                self.states[detection.track_id] = state

            gap = offset_seconds - state.last_seen > r["maxGapSeconds"]
            consecutive = state.tick == self.tick - 1 and not gap
            if gap:
                # 轨迹中断：必须重新在某一侧稳定下来。
                # 这里连 stable 一起清空是刻意的——中断前后的两次出现
                # 不构成一次可验证的越线，否则遮挡或跳帧会凭空造出事件。
                state.stable = None
                state.candidate = 0
                state.runs = 0
                state.point = None
                state.gap = True
                state.pending.add("TRACK_GAP")

            prev_point = state.prev_point
            state.prev_point = (cx, cy)
            state.velocity = self._estimate_velocity(state, prev_point, (cx, cy), offset_seconds, consecutive)
            state.last_seen = offset_seconds
            state.tick = self.tick
            state.min_confidence = min(state.min_confidence, detection.confidence)
            for reason in getattr(detection, "reasons", ()) or ():
                state.pending.add(reason)

            signed = self.signed_distance(cx, cy)
            if abs(signed) < self.deadzone:
                # 处于死区：必须重新在某一侧稳定下来，防止抖动重复计数。
                state.runs = 0
                continue

            side = 1 if signed > 0 else -1
            state.runs = state.runs + 1 if consecutive and state.candidate == side else 1
            state.candidate = side
            if state.runs < r["stableFrames"]:
                continue

            previous_side = state.stable
            state.point = (cx, cy)
            state.stable = side

            if previous_side is None or previous_side == side or state.counted:
                continue
            if side != self._expected:
                state.pending.add("RETURN_MOVEMENT")
                continue
            if prev_point is None:
                continue

            px, py = prev_point
            prev_signed = self.signed_distance(px, py)
            denominator = prev_signed - signed
            if abs(denominator) < 1e-12:
                continue
            fraction = prev_signed / denominator
            cross = (px + fraction * (cx - px), py + fraction * (cy - py))
            projection = self.project(cross[0], cross[1])
            if not 0.0 <= projection <= 1.0:
                # 交点落在线段之外：不计数，但留下可排查的痕迹。
                state.pending.add("OUT_OF_SEGMENT")
                continue

            flags = {f for f in state.pending if f in REPORTED_FLAGS}
            flags.add("CONTENT_UNVERIFIED")
            if state.min_confidence < r["reviewConfidence"]:
                flags.add("LOW_CONFIDENCE")
            if any(
                math.hypot(cross[0] - p["point"][0], cross[1] - p["point"][1]) <= r["duplicateDistance"]
                for p in self.recent
            ):
                # 两次真实出餐可能确实靠得很近：给标记提醒人工复核，而不是静默丢弃。
                flags.add("POSSIBLE_DUPLICATE")

            self.recent.append({"time": offset_seconds, "point": cross})
            state.counted = True
            state.pending = set()
            state.gap = False
            self.total += 1
            emitted.append(
                {
                    "track_id": detection.track_id,
                    "offset_seconds": round(float(offset_seconds), 3),
                    "confidence": round(float(detection.confidence), 3),
                    "direction": self.direction,
                    "target_label": detection.label,
                    "risk_reasons": sorted(flags),
                    "unit": "CONTAINER_EVENT",
                }
            )
        return emitted

    @staticmethod
    def _estimate_velocity(
        state: TrackState,
        prev_point: tuple[float, float] | None,
        point: tuple[float, float],
        offset_seconds: float,
        consecutive: bool,
    ) -> tuple[float, float]:
        if prev_point is None or not consecutive:
            return (0.0, 0.0)
        dt = offset_seconds - state.last_seen
        if dt <= 1e-6:
            return state.velocity
        dt = min(dt, 1.0)
        # 指数平滑，避免单帧分割抖动把速度估计带飞。
        alpha = 0.55
        vx = (point[0] - prev_point[0]) / dt
        vy = (point[1] - prev_point[1]) / dt
        return (alpha * vx + (1 - alpha) * state.velocity[0], alpha * vy + (1 - alpha) * state.velocity[1])

    # -- 只读视图 ---------------------------------------------------------
    def track_flags(self, track_id: int) -> set[str]:
        state = self.states.get(track_id)
        return set(state.pending) if state else set()

    @property
    def counted_tracks(self) -> set[int]:
        return {t for t, s in self.states.items() if s.counted}

"""视觉流水线对外门面。

本模块是重构后的公开入口，保持与重构前**完全一致**的符号与签名：

``Detection`` / ``CentroidTracker`` / ``Detector`` / ``LineCounter``
``select_targets`` / ``draw_annotations``

内部实现已拆分到各自职责明确的模块：

* :mod:`zaoyan_ai.segmenter`  —— 自适应色块分割与候选几何过滤
* :mod:`zaoyan_ai.tracker`    —— Kalman 运动模型 + Hungarian 关联
* :mod:`zaoyan_ai.linecross`  —— 越线状态机与插值求交
* :mod:`zaoyan_ai.annotate`   —— 标注渲染（含中文 TrueType 字体）

拆分是为了让每个部分可单独测试与演进，而不是把 240 行混在一个文件里。
``demo-color`` 仍是经典视觉基线，**不代表真实食堂场景的 YOLO 检测精度**。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from .annotate import cjk_available, draw_annotations
from .linecross import LineCounter
from .rules import parse_rules
from .segmenter import AdaptiveColorSegmenter, Candidate, motion_score
from .tracker import DEFAULT_MAX_AGE, CentroidTracker as _KalmanTracker, hungarian, iou_matrix

__all__ = [
    "Detection",
    "CentroidTracker",
    "Detector",
    "LineCounter",
    "select_targets",
    "draw_annotations",
    "iou_matrix",
    "hungarian",
    "cjk_available",
]


@dataclass
class Detection:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    label: str
    reasons: tuple[str, ...] = ()

    def normalized(self, w: int, h: int) -> dict:
        x1, y1, x2, y2 = self.bbox
        return {
            "trackId": self.track_id,
            "label": self.label,
            "confidence": round(self.confidence, 3),
            "x": round(x1 / w, 5),
            "y": round(y1 / h, 5),
            "width": round((x2 - x1) / w, 5),
            "height": round((y2 - y1) / h, 5),
        }


class CentroidTracker(_KalmanTracker):
    """兼容旧名的跟踪器。

    对外返回 :class:`Detection`，而内部完全由 Kalman + Hungarian 驱动。
    保留这个名字是因为既有测试与调用方依赖 ``CentroidTracker(max_age=...)``。
    """

    def __init__(self, max_distance: float = 0.14, max_age: int = DEFAULT_MAX_AGE, **kwargs) -> None:
        super().__init__(max_distance=max_distance, max_age=max_age, **kwargs)

    def update(self, boxes, candidates=None, label: str = "tray", reasons: tuple[str, ...] = ()):
        rows = super().update(list(boxes), candidates)
        return [
            Detection(
                track_id,
                (int(round(b[0])), int(round(b[1])), int(round(b[2])), int(round(b[3]))),
                confidence,
                label,
                reasons,
            )
            for track_id, b, confidence, _is_new in rows
        ]


class Detector:
    """逐帧检测 + 跟踪。

    参数
    ----
    mode:
        ``demo-color`` 走自适应色块分割；``yolo`` 走 Ultralytics + ByteTrack。
    weights:
        YOLO 权重路径，仅 ``yolo`` 模式需要。
    confidence:
        未显式传入 rules 时使用的置信度下限。
    adaptive:
        是否启用自适应阈值学习（``demo-color`` 模式）。
    """

    def __init__(
        self,
        mode: str = "demo-color",
        weights: Optional[str] = None,
        confidence: float = 0.35,
        rules: dict | None = None,
        adaptive: bool = True,
    ) -> None:
        self.rules = parse_rules(rules)
        self.mode = mode
        self.adaptive_enabled = bool(adaptive)
        self.segmenter = AdaptiveColorSegmenter(enabled=adaptive)
        # 直接用 Kalman 跟踪器：vision.CentroidTracker 是面向旧 API 的
        # Detection 包装层，内部流水线需要拿到结构化行（含 is_new）。
        self.tracker = _KalmanTracker()
        self.model = None
        self.confidence = self.rules["confidence"] if rules is not None else confidence
        self._previous_gray: np.ndarray | None = None
        self.last_diagnostics: dict = {}

        if mode == "yolo":
            if not weights:
                raise ValueError("YOLO 模式需要本地权重文件 --weights")
            try:
                from ultralytics import YOLO
            except ImportError as exc:
                raise RuntimeError("未安装 Ultralytics，请执行 pip install -r requirements-yolo.txt") from exc
            from pathlib import Path

            if not Path(weights).is_file():
                raise ValueError("本地模型文件不存在；不会自动联网下载")
            self.model = YOLO(weights)
            names = self.model.names.values() if isinstance(self.model.names, dict) else self.model.names
            if not set(str(n).lower() for n in names) & set(self.rules["targetLabels"]):
                raise ValueError("模型类别与档口计数类别不匹配，请核对模型类别映射")
        elif mode != "demo-color":
            raise ValueError(f"不支持检测模式: {mode}")

    # -- ROI --------------------------------------------------------------
    def roi_pixels(self, frame: np.ndarray) -> tuple[int, int, int, int]:
        h, w = frame.shape[:2]
        r = self.rules
        x1, y1 = int(r["roiX1"] * w), int(r["roiY1"] * h)
        x2 = min(w, int(np.ceil(r["roiX2"] * w)))
        y2 = min(h, int(np.ceil(r["roiY2"] * h)))
        return x1, y1, x2, y2

    def infer(self, frame: np.ndarray) -> list[Detection]:
        """整帧推理。先按 ROI 裁剪再推理，坐标最后还原到整帧归一化空间。"""
        if frame is None or frame.size == 0:
            raise ValueError("识别区域为空")
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = self.roi_pixels(frame)
        cropped = frame[y1:y2, x1:x2]
        if cropped.size == 0:
            raise ValueError("识别区域为空")
        found = self._infer_crop(cropped)
        restored = [
            Detection(
                d.track_id,
                (d.bbox[0] + x1, d.bbox[1] + y1, d.bbox[2] + x1, d.bbox[3] + y1),
                d.confidence,
                d.label,
                d.reasons,
            )
            for d in found
        ]
        return select_targets(restored, self.rules)

    def _infer_crop(self, frame: np.ndarray) -> list[Detection]:
        if self.mode == "demo-color":
            return self._infer_color(frame)
        return self._infer_yolo(frame)

    # -- demo-color -------------------------------------------------------
    def _infer_color(self, frame: np.ndarray) -> list[Detection]:
        candidates = self.segmenter.candidates(frame, self.confidence)
        # 自适应阈值会把实心色块的置信度打到 0.95 以上；
        # 低分候选仍然送进跟踪器参与关联，避免遮挡时断轨。
        confident = [c for c in candidates if c.confidence >= self.confidence]
        accepted = confident if confident else candidates

        boxes = [c.bbox for c in accepted]
        rows = self.tracker.update(boxes, accepted)

        diagnostics: dict = {
            "candidates": len(candidates),
            "accepted": len(accepted),
            "adaptive_frozen": bool(self.segmenter._frozen),
        }
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        roi = (0, 0, frame.shape[1], frame.shape[0])
        motion = motion_score(self._previous_gray, gray, roi)
        self._previous_gray = gray
        diagnostics["motion"] = round(motion, 4)
        if not accepted and motion > 0.012:
            # 有运动却没有分割结果：通常是光照突变或目标色号偏离，
            # 明确标记出来，避免“静默漏检”难以定位。
            diagnostics["missed_motion"] = True
        self.last_diagnostics = diagnostics

        by_id = {c.bbox: c for c in accepted}
        result: list[Detection] = []
        for track_id, box, confidence, is_new in rows:
            bbox = (int(round(box[0])), int(round(box[1])), int(round(box[2])), int(round(box[3])))
            match = by_id.get(bbox)
            reasons: set[str] = set()
            # TRUNCATED_TARGET：目标贴着 ROI 边缘，很可能只露出一部分，
            # 这类目标仍要参与跟踪，但复核时值得优先看一眼。
            if match is not None and match.touches_border:
                reasons.add("TRUNCATED_TARGET")
            result.append(Detection(track_id, bbox, float(confidence), "demo-tray", tuple(sorted(reasons))))
        return result

    # -- yolo -------------------------------------------------------------
    def _infer_yolo(self, frame: np.ndarray) -> list[Detection]:
        # persist=True 允许连续帧复用 YOLO/ByteTrack 内部跟踪状态。
        result = self.model.track(
            frame, persist=True, tracker="bytetrack.yaml", conf=self.confidence, verbose=False
        )[0]
        output: list[Detection] = []
        if result.boxes is None:
            return output
        for b in result.boxes:
            if b.id is None:
                continue  # 没有稳定 track ID 时不计数。
            idx = int(b.cls.item())
            name = str(self.model.names[idx])
            name_lower = name.lower()
            # COCO 模型只天然覆盖 bowl 等少量餐饮类别，真实餐盒必须使用自训权重。
            eligible = name_lower in set(self.rules["targetLabels"] + self.rules["emptyLabels"])
            if not eligible:
                continue
            x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
            output.append(Detection(int(b.id.item()), (x1, y1, x2, y2), float(b.conf.item()), name))
        return output

    # -- 诊断 -------------------------------------------------------------
    def describe(self) -> dict:
        """返回当前检测器的运行状态，供 /system/capabilities 之类的接口展示。"""
        return {
            "mode": self.mode,
            "adaptive": self.adaptive_enabled,
            "adaptive_frozen": bool(self.segmenter._frozen),
            "sat_range": [round(self.segmenter.sat_low, 1), round(self.segmenter.sat_high, 1)],
            "val_range": [round(self.segmenter.val_low, 1), round(self.segmenter.val_high, 1)],
            "cjk_font": cjk_available(),
            "tracks": len(self.tracker.tracks),
        }


def select_targets(boxes: list[Detection], rules: dict) -> list[Detection]:
    """显式空容器类别被忽略；几何歧义保留给人工复核。

    OUTER 在外层托盘与内嵌餐盒之间选择托盘；INNER 选择单个餐盒。
    这不代表能判断任意图像的内容物是满还是空。
    """
    boxes = [d for d in boxes if d.label.lower() not in rules["emptyLabels"]]
    suppressed: set[int] = set()
    flags: dict[int, set[str]] = {d.track_id: set(d.reasons) for d in boxes}

    def area(b):
        return max(0, b[2] - b[0]) * max(0, b[3] - b[1])

    for i, a in enumerate(boxes):
        for b in boxes[i + 1 :]:
            ba, bb = a.bbox, b.bbox
            overlap = max(0, min(ba[2], bb[2]) - max(ba[0], bb[0])) * max(
                0, min(ba[3], bb[3]) - max(ba[1], bb[1])
            )
            aa, ab = area(ba), area(bb)
            if min(aa, ab) <= 0:
                continue
            ratio = overlap / min(aa, ab)
            if ratio >= 0.9:
                # 确定性的打破平局方式，避免两个等大框同时被抑制。
                outer, inner = (a, b) if (aa, a.track_id) >= (ab, b.track_id) else (b, a)
                keep, drop = (outer, inner) if rules["nestingPolicy"] == "OUTER" else (inner, outer)
                suppressed.add(drop.track_id)
                flags[keep.track_id].add("NESTED_TARGET")
            elif ratio >= 0.25:
                flags[a.track_id].add("OVERLAP")
                flags[b.track_id].add("OVERLAP")
    return [
        Detection(d.track_id, d.bbox, d.confidence, d.label, tuple(sorted(flags[d.track_id])))
        for d in boxes
        if d.track_id not in suppressed
    ]

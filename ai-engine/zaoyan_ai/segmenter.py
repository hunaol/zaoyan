"""自适应色块分割器。

设计目标：替掉原先写死的 HSV 区间 ``[75,80,55]-[105,255,255]``。

原实现的问题：
* 区间写死，换灯光、白平衡或餐盒色号就漏检；
* 只做一次闭运算，没有开运算去噪，也没有粘连拆分；
* ``boundingRect`` 对旋转目标取轴对齐外接框，面积虚高；
* 完全不区分“画面里根本没出现目标”和“目标被误分割”。

本模块的做法：用带界约束的自适应统计替代常量。
种子区间仍然来自现场验证过的青绿色范围，它是**安全网**而不是唯一依据；
在前若干帧内统计真实目标的色度分布并收紧边界，随后冻结，
避免逐帧漂移导致的闪烁检测。

注意：这是经典视觉基线，不是训练好的食堂餐盒模型。
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# 现场验证过的青绿色种子区间（OpenCV HSV：H 0-179, S/V 0-255）。
SEED_HUE_LOW = 60
SEED_HUE_HIGH = 110
SEED_SAT_LOW = 55
SEED_VAL_LOW = 40

# 自适应边界的收缩范围：不允许离开种子区间，也不允许收缩到失去泛化能力。
MIN_SAT_SPAN = 24.0
MIN_VAL_SPAN = 30.0
LEARN_FRAMES = 12

# 候选框几何过滤阈值（按帧面积归一化，避免与分辨率绑定）。
MIN_AREA_RATIO = 1.2e-4
MIN_SIDE_PX = 16
MIN_FILL_RATIO = 0.34
MIN_ASPECT = 0.16
MAX_ASPECT = 6.0

_MIN_CONTOUR_AREA = 320.0


@dataclass(frozen=True)
class Candidate:
    """一个分割候选。"""

    bbox: tuple[int, int, int, int]
    area: float
    fill_ratio: float
    solidity: float
    confidence: float
    touches_border: bool
    angle: float = 0.0


def _percentile_span(values: np.ndarray, low_pct: float, high_pct: float, floor: float) -> tuple[float, float]:
    if values.size == 0:
        return floor, 255.0
    low = float(np.percentile(values, low_pct))
    high = float(np.percentile(values, high_pct))
    if high - low < floor:
        centre = (low + high) / 2.0
        low, high = centre - floor / 2.0, centre + floor / 2.0
    return low, high


class AdaptiveColorSegmenter:
    """带界约束的自适应色块分割器。

    前 :data:`LEARN_FRAMES` 帧内累色素分布并收紧阈值，之后冻结边界，
    保证长时间运行下检测结果稳定、不闪烁。阈值永远被限制在种子区间内，
    因此不会因画面里出现别的东西而漂移到无关颜色上。
    """

    def __init__(self, learn_frames: int = LEARN_FRAMES, enabled: bool = True) -> None:
        self.learn_frames = int(learn_frames)
        self.enabled = bool(enabled)
        self.hue_low = float(SEED_HUE_LOW)
        self.hue_high = float(SEED_HUE_HIGH)
        self.sat_low = float(SEED_SAT_LOW)
        self.val_low = float(SEED_VAL_LOW)
        self.sat_high = 255.0
        self.val_high = 255.0
        self._frames = 0
        self._samples: list[np.ndarray] = []
        self._frozen = not self.enabled
        self.last_seed_mask: np.ndarray | None = None

    # -- 阈值学习 ---------------------------------------------------------
    def _seed_mask(self, hsv: np.ndarray) -> np.ndarray:
        return cv2.inRange(
            hsv,
            np.array([SEED_HUE_LOW, SEED_SAT_LOW, SEED_VAL_LOW], dtype=np.uint8),
            np.array([SEED_HUE_HIGH, 255, 255], dtype=np.uint8),
        )

    def _learn(self, hsv: np.ndarray, seed: np.ndarray) -> None:
        """用种子掩膜内的真实像素统计收紧 S/V 边界。"""
        if self._frozen or not self.enabled:
            return
        self._frames += 1
        pixels = int(cv2.countNonZero(seed))
        # 目标太小或缺失时不参与学习，避免把噪声当成目标色。
        if pixels < 400:
            if self._frames >= self.learn_frames and self._samples:
                self._freeze()
            return
        step = max(1, pixels // 6000)
        flat = hsv.reshape(-1, 3)[seed.reshape(-1) > 0][::step]
        self._samples.append(flat.astype(np.float32))
        if self._frames >= self.learn_frames:
            self._freeze()

    def _freeze(self) -> None:
        if not self._samples:
            self._frozen = True
            return
        pool = np.concatenate(self._samples, axis=0)
        sat_low, sat_high = _percentile_span(pool[:, 1], 3, 99.5, MIN_SAT_SPAN)
        val_low, val_high = _percentile_span(pool[:, 2], 2, 99.5, MIN_VAL_SPAN)
        # 带界：只能在种子区间内收紧，绝不能放松到种子之外。
        self.sat_low = float(max(SEED_SAT_LOW, min(sat_low, SEED_SAT_LOW + 90)))
        self.sat_high = float(min(255.0, max(sat_high, self.sat_low + MIN_SAT_SPAN)))
        self.val_low = float(max(SEED_VAL_LOW, min(val_low, SEED_VAL_LOW + 110)))
        self.val_high = float(min(255.0, max(val_high, self.val_low + MIN_VAL_SPAN)))
        self._frozen = True

    # -- 分割 -------------------------------------------------------------
    def mask(self, frame_bgr: np.ndarray) -> np.ndarray:
        if frame_bgr is None or frame_bgr.size == 0:
            raise ValueError("识别区域为空")
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        seed = self._seed_mask(hsv)
        self.last_seed_mask = seed
        self._learn(hsv, seed)
        mask = cv2.inRange(
            hsv,
            np.array([SEED_HUE_LOW, self.sat_low, self.val_low], dtype=np.uint8),
            np.array([SEED_HUE_HIGH, self.sat_high, self.val_high], dtype=np.uint8),
        )
        # 开运算去孤立噪点，闭运算补齐内部空洞。核大小随画面尺寸缩放，
        # 避免在低分辨率帧上把目标本身腐蚀掉。
        h, w = frame_bgr.shape[:2]
        k = max(3, (min(h, w) // 180) | 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        return mask

    def split_touching(self, mask: np.ndarray) -> np.ndarray:
        """用距离变换拆开相互粘连的目标，降低“两个餐盒粘成一个”的漏计。"""
        if cv2.countNonZero(mask) == 0:
            return mask
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
        peak = float(distance.max())
        if peak < 6.0:
            return mask
        _, sure_fg = cv2.threshold(distance, 0.52 * peak, 255, cv2.THRESH_BINARY)
        sure_fg = sure_fg.astype(np.uint8)
        if cv2.countNonZero(sure_fg) == 0:
            return mask
        # 连通域数量为 1 说明本来就是单个目标，跳过昂贵的分水岭。
        count, markers = cv2.connectedComponents(sure_fg)
        if count <= 2:
            return mask
        markers = markers + 1
        unknown = cv2.subtract(mask, sure_fg)
        markers[unknown > 0] = 0
        frame_shape = mask.shape[:2]
        color = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        cv2.watershed(color, markers)
        separated = np.where(markers > 1, np.uint8(255), np.uint8(0))
        # 分水岭只负责切开粘连；若结果丢失过多前景则回退，避免过度分割。
        if cv2.countNonZero(separated) < 0.55 * cv2.countNonZero(mask):
            return mask
        return separated

    # -- 候选提取 ---------------------------------------------------------
    def candidates(self, frame_bgr: np.ndarray, confidence: float, split: bool = True) -> list[Candidate]:
        mask = self.mask(frame_bgr)
        if split:
            mask = self.split_touching(mask)
        height, width = frame_bgr.shape[:2]
        frame_area = float(max(1, height * width))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        found: list[Candidate] = []
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < _MIN_CONTOUR_AREA or area / frame_area < MIN_AREA_RATIO:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w < MIN_SIDE_PX or h < MIN_SIDE_PX:
                continue
            aspect = w / float(h)
            if not MIN_ASPECT <= aspect <= MAX_ASPECT:
                continue
            # 填充率：真实实心目标接近 1；碎片或细长噪声远低于阈值。
            fill_ratio = area / float(max(1, w * h))
            if fill_ratio < MIN_FILL_RATIO:
                continue
            hull = cv2.convexHull(contour)
            hull_area = float(cv2.contourArea(hull))
            solidity = area / hull_area if hull_area > 0 else 0.0
            if solidity < 0.72:
                continue
            rect = cv2.minAreaRect(contour)
            angle = float(rect[2])
            touches = x <= 1 or y <= 1 or x + w >= width - 1 or y + h >= height - 1
            # 置信度由几何规整度推导：填充率、凸度和旋转惩罚的加权。
            rotation_penalty = 1.0 - min(abs(angle), 45.0) / 90.0
            quality = 0.55 * fill_ratio + 0.30 * solidity + 0.15 * max(0.5, rotation_penalty)
            score = float(np.clip(quality, 0.05, 0.99))
            found.append(
                Candidate(
                    bbox=(int(x), int(y), int(x + w), int(y + h)),
                    area=area,
                    fill_ratio=float(fill_ratio),
                    solidity=float(solidity),
                    confidence=round(score, 3),
                    touches_border=bool(touches),
                    angle=angle,
                )
            )
        found.sort(key=lambda c: c.area, reverse=True)
        return found


def motion_score(previous_gray: np.ndarray | None, gray: np.ndarray, roi: tuple[int, int, int, int]) -> float:
    """ROI 内的运动强度（0-1）。用于区分“真的没有目标”和“分割失败”。"""
    if previous_gray is None or previous_gray.shape != gray.shape:
        return 0.0
    x1, y1, x2, y2 = roi
    a = previous_gray[y1:y2, x1:x2]
    b = gray[y1:y2, x1:x2]
    if a.size == 0:
        return 0.0
    diff = cv2.absdiff(b, a)
    _, active = cv2.threshold(diff, 18, 255, cv2.THRESH_BINARY)
    return float(cv2.countNonZero(active)) / float(active.size)

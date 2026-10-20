"""多目标跟踪：Kalman 运动模型 + Hungarian 全局最优关联。

替掉原先的贪心中心点匹配。原实现有三个硬伤：

1. 只比对“上一帧中心点”，没有运动模型，目标走得快一点就断轨；
2. 阈值 ``max_distance=78.0`` 是像素常量，换分辨率即失效；
3. 贪心最近邻不是全局最优，交叉场景下会互换 ID。

本模块用 SORT 一族的做法：每个轨迹维护一个匀速 Kalman 滤波器，
关联代价为 ``1 - IoU`` 并辅以归一化中心距兜底，
用 Hungarian 算法求全局最优指派。

对外仍然保留 ``CentroidTracker`` 这个类名与 ``max_age`` 关键字参数，
因为测试与既有调用方依赖它；但内部实现已完全替换。
"""
from __future__ import annotations

import numpy as np

from .segmenter import Candidate

# 未命中轨迹的存活帧数。取 30 是为了跨过短暂遮挡：
# 遮挡期间保持 ID，恢复后不会因为“新 ID”被重复计数。
DEFAULT_MAX_AGE = 30
# 新轨迹需要连续命中的帧数，用于抑制单帧噪声造成的虚假轨迹。
DEFAULT_MIN_HITS = 1
# 关联门限。IoU 与归一化中心距取“或”，兼顾静止排队与快速移动两种场景。
MIN_IOU = 0.20
# 归一化中心距门限：与分辨率解耦，替代原先写死的 78 像素。
MAX_CENTER_DISTANCE = 0.14
# 关联时给预测框的额外放宽量，补偿匀速模型在变速场景下的误差。
GATE_RELAX = 1.35


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a: (N,4), b: (M,4) 的 xyxy 框，返回 (N,M) 的 IoU。"""
    if a.size == 0 or b.size == 0:
        return np.zeros((a.shape[0], b.shape[0]), dtype=np.float64)
    ax1, ay1, ax2, ay2 = a[:, 0][:, None], a[:, 1][:, None], a[:, 2][:, None], a[:, 3][:, None]
    bx1, by1, bx2, by2 = b[:, 0][None, :], b[:, 1][None, :], b[:, 2][None, :], b[:, 3][None, :]
    inter_w = np.clip(np.minimum(ax2, bx2) - np.maximum(ax1, bx1), 0, None)
    inter_h = np.clip(np.minimum(ay2, by2) - np.maximum(ay1, by1), 0, None)
    inter = inter_w * inter_h
    area_a = np.clip(ax2 - ax1, 0, None) * np.clip(ay2 - ay1, 0, None)
    area_b = np.clip(bx2 - bx1, 0, None) * np.clip(by2 - by1, 0, None)
    union = area_a + area_b - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0)


def hungarian(cost: np.ndarray) -> list[tuple[int, int]]:
    """最小代价二分图匹配（Jonker-Volgenant 风格的 O(n^3) 实现）。

    自带实现而不引入 SciPy：``requirements.txt`` 目前只需 numpy 与 OpenCV，
    为一次指派引入 SciPy 这种重量级依赖并不划算。

    返回 ``(row, col)`` 列表，``row`` 对应 cost 的行、``col`` 对应 cost 的列。
    允许 ``n != m``，返回的配对数不超过 ``min(n, m)``。
    """
    cost = np.asarray(cost, dtype=np.float64)
    if cost.ndim != 2:
        raise ValueError("cost must be a 2-D matrix")
    n, m = cost.shape
    if n == 0 or m == 0:
        return []

    # 统一按“行数 <= 列数”求解，行多于列时转置，最后把坐标换回来。
    transposed = n > m
    matrix = cost.T if transposed else cost
    rows, cols = matrix.shape

    u = np.zeros(rows + 1)
    v = np.zeros(cols + 1)
    p = np.zeros(cols + 1, dtype=np.int64)
    way = np.zeros(cols + 1, dtype=np.int64)

    for i in range(1, rows + 1):
        p[0] = i
        j0 = 0
        minv = np.full(cols + 1, np.inf)
        used = np.zeros(cols + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = int(p[j0])
            delta = np.inf
            j1 = 0
            for j in range(1, cols + 1):
                if used[j]:
                    continue
                cur = matrix[i0 - 1, j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j] = cur
                    way[j] = j0
                if minv[j] < delta:
                    delta = minv[j]
                    j1 = j
            if not np.isfinite(delta):
                # 剩余列全部不可达（整行代价为无穷）：放弃这一行。
                break
            for j in range(cols + 1):
                if used[j]:
                    u[int(p[j])] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        # 沿增广路回溯，更新匹配。
        while j0:
            j1 = int(way[j0])
            p[j0] = p[j1]
            j0 = j1

    pairs: list[tuple[int, int]] = []
    for j in range(1, cols + 1):
        if p[j] == 0:
            continue
        row, col = int(p[j]) - 1, j - 1
        pairs.append((col, row) if transposed else (row, col))
    return pairs


class KalmanTrack:
    """单个轨迹的匀速 Kalman 滤波器。

    状态 ``[cx, cy, w, h, vx, vy, vw, vh]``，观测 ``[cx, cy, w, h]``。
    """

    def __init__(self, track_id: int, box: np.ndarray, frame: int, confidence: float = 0.0, label: str = "") -> None:
        self.id = track_id
        self.label = label
        self.confidence = confidence
        self.hits = 1
        self.age = 0
        self.time_since_update = 0
        self.created_frame = frame
        self.last_frame = frame
        self.history: list[tuple[float, float]] = []
        self.kf = self._new_filter(box)

    @staticmethod
    def _new_filter(box: np.ndarray):
        import cv2

        kf = cv2.KalmanFilter(8, 4)
        kf.transitionMatrix = np.eye(8, dtype=np.float32)
        for i in range(4):
            kf.transitionMatrix[i, i + 4] = 1.0
        kf.measurementMatrix = np.zeros((4, 8), dtype=np.float32)
        for i in range(4):
            kf.measurementMatrix[i, i] = 1.0
        # 过程噪声：位置小、速度项稍大，容许一定加速度。
        kf.processNoiseCov = np.eye(8, dtype=np.float32) * 1e-2
        for i in range(4, 8):
            kf.processNoiseCov[i, i] = 4e-2
        # 观测噪声：分割框本身有若干像素抖动，按框尺寸自适应更稳。
        kf.measurementNoiseCov = np.eye(4, dtype=np.float32) * 1e-1
        kf.errorCovPost = np.eye(8, dtype=np.float32)
        cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
        w, h = max(1.0, box[2] - box[0]), max(1.0, box[3] - box[1])
        kf.statePost = np.array([cx, cy, w, h, 0, 0, 0, 0], dtype=np.float32)
        kf.statePre = kf.statePost.copy()
        return kf

    def predict(self) -> np.ndarray:
        state = self.kf.predict()
        return self._to_box(state)

    def update(self, box: np.ndarray, confidence: float, label: str, frame: int) -> None:
        cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
        w, h = max(1.0, box[2] - box[0]), max(1.0, box[3] - box[1])
        self.kf.correct(np.array([cx, cy, w, h], dtype=np.float32))
        self.hits += 1
        self.time_since_update = 0
        self.last_frame = frame
        self.confidence = confidence
        if label:
            self.label = label
        self.history.append((cx, cy))
        if len(self.history) > 64:
            del self.history[:-64]

    def mark_missed(self) -> None:
        self.age += 1
        self.time_since_update += 1

    def _to_box(self, state: np.ndarray) -> np.ndarray:
        cx, cy, w, h = (float(state[i]) for i in range(4))
        w, h = max(2.0, abs(w)), max(2.0, abs(h))
        return np.array([cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0], dtype=np.float64)

    @property
    def confirmed(self) -> bool:
        return self.hits >= DEFAULT_MIN_HITS


class CentroidTracker:
    """兼容旧名的多目标跟踪器（内部为 Kalman + Hungarian）。

    参数
    ----
    max_distance:
        兼容旧签名保留。旧的像素门限与分辨率绑定，此处改按画面尺寸归一化后使用，
        因此不同分辨率下行为一致。
    max_age:
        轨迹连续未命中多少帧后删除。
    min_iou:
        关联所需的 IoU 下限。
    """

    def __init__(
        self,
        max_distance: float = MAX_CENTER_DISTANCE,
        max_age: int = DEFAULT_MAX_AGE,
        min_iou: float = MIN_IOU,
        min_hits: int = DEFAULT_MIN_HITS,
        frame_size: tuple[int, int] | None = None,
    ) -> None:
        self.max_distance = float(max_distance) if max_distance < 1.0 else None
        self.legacy_pixel_gate = float(max_distance) if max_distance >= 1.0 else None
        self.max_age = int(max_age)
        self.min_iou = float(min_iou)
        self.min_hits = int(min_hits)
        self.next_id = 1
        self.frame = 0
        self.tracks: dict[int, KalmanTrack] = {}
        self.frame_size = frame_size
        self.warnings: list[str] = []
        self.last_assignments: list[tuple[int, int]] = []

    # -- 内部工具 ---------------------------------------------------------
    def _gate(self, height: int) -> float:
        """归一化中心距门限；仅在旧式像素门限被显式传入时才换算。"""
        if self.max_distance is not None:
            return self.max_distance
        if self.legacy_pixel_gate is not None:
            return self.legacy_pixel_gate / max(1.0, float(height)) * 4.0
        return MAX_CENTER_DISTANCE

    def _centre_gate_matrix(self, dets: np.ndarray, preds: np.ndarray, height: int) -> np.ndarray:
        """返回形状恒为 ``(N_dets, N_tracks)`` 的布尔门限矩阵。

        注意：这里必须显式维持二维形状。当只有一条轨迹时，
        ``(N,1) - (1,1)`` 会被 NumPy 压成一维 ``(N,)``，
        随后与同样宽度的 ``(N,1)`` 做逻辑运算会**静默广播成 (N,N)**，
        导致后续把列下标当成轨迹下标而越界。原实现正是栽在这里。
        """
        shape = (dets.shape[0], preds.shape[0])
        if dets.size == 0 or preds.size == 0:
            return np.zeros(shape, dtype=bool)
        gate = self._gate(height) * GATE_RELAX
        dcx = (dets[:, 0] + dets[:, 2])[:, None] / 2.0 - (preds[:, 0] + preds[:, 2])[None, :] / 2.0
        dcy = (dets[:, 1] + dets[:, 3])[:, None] / 2.0 - (preds[:, 1] + preds[:, 3])[None, :] / 2.0
        # 归一化到画面高度，保证与分辨率无关。
        dist = np.sqrt(dcx**2 + dcy**2) / max(1.0, float(height))
        return np.asarray(dist <= gate, dtype=bool).reshape(shape)

    # -- 主流程 -----------------------------------------------------------
    def update(
        self,
        boxes: list[tuple[int, int, int, int]],
        candidates: list[Candidate] | None = None,
    ) -> list[tuple[int, np.ndarray, float, bool]]:
        """返回 ``[(track_id, box, confidence, is_new)]``。"""
        self.frame += 1
        height = 1
        if candidates:
            height = max(1, max(c.bbox[3] for c in candidates))
        elif boxes:
            height = max(1, max(b[3] for b in boxes))

        detections = np.array(boxes, dtype=np.float64).reshape(-1, 4)
        confidence = np.array(
            [c.confidence for c in candidates] if candidates else [0.99] * len(boxes), dtype=np.float64
        )

        track_ids = list(self.tracks.keys())
        predictions = np.zeros((len(track_ids), 4), dtype=np.float64)
        for index, track_id in enumerate(track_ids):
            predictions[index] = self.tracks[track_id].predict()

        assignments: list[tuple[int, int]] = []
        if len(track_ids) and detections.shape[0]:
            ious = iou_matrix(detections, predictions)
            centre_ok = self._centre_gate_matrix(detections, predictions, height)
            # 代价：IoU 越大越好；IoU 不足但中心够近时给一个中等代价作为兜底。
            cost = 1.0 - ious
            cost = np.where(centre_ok & (ious < self.min_iou), 0.55, cost)
            feasible = np.asarray((ious >= self.min_iou) | centre_ok, dtype=bool)
            expected = (detections.shape[0], len(track_ids))
            if feasible.shape != expected:
                # 形状契约被破坏时必须显式失败，否则会退化成静默的错误指派。
                raise RuntimeError(f"关联门限矩阵形状异常：期望 {expected}，实际 {feasible.shape}")
            cost = np.where(feasible, cost, 1e6)
            if len(track_ids) > 40 and detections.shape[0] > 40:
                # 大规模场景下 Hungarian 的 O(n^3) 会成为瓶颈，退化为贪心并给出提示。
                if "LARGE_SCENE_GREEDY_ASSIGNMENT" not in self.warnings:
                    self.warnings.append("LARGE_SCENE_GREEDY_ASSIGNMENT")
                assignments = self._greedy(cost)
            else:
                assignments = hungarian(cost)
            assignments = [(r, c) for r, c in assignments if feasible[r, c]]

        matched_dets = {r for r, _ in assignments}
        matched_tracks = {c for _, c in assignments}
        results: list[tuple[int, np.ndarray, float, bool]] = []

        for row, col in assignments:
            track_id = track_ids[col]
            track = self.tracks[track_id]
            track.update(detections[row], float(confidence[row]), track.label, self.frame)
            results.append((track_id, detections[row], float(confidence[row]), False))

        for index, track_id in enumerate(track_ids):
            if index not in matched_tracks:
                self.tracks[track_id].mark_missed()

        for row in range(detections.shape[0]):
            if row in matched_dets:
                continue
            track_id = self.next_id
            self.next_id += 1
            track = KalmanTrack(track_id, detections[row], self.frame, float(confidence[row]))
            self.tracks[track_id] = track
            results.append((track_id, detections[row], float(confidence[row]), True))

        # 连续 max_age 帧未命中的轨迹即失效。
        # 用 >= 而不是 >：max_age 的语义就是“容忍的丢失帧数”，
        # 超过这个容忍度必须立刻回收，否则目标消失后 ID 会被长期占用。
        for track_id in [t for t, tr in self.tracks.items() if tr.time_since_update >= self.max_age]:
            del self.tracks[track_id]
        # 按输入顺序输出，保持与旧实现的顺序一致性。
        order = {tuple(detections[i].tolist()): i for i in range(detections.shape[0])}
        results.sort(key=lambda item: order.get(tuple(np.asarray(item[1], dtype=np.float64).tolist()), 0))
        return results

    @staticmethod
    def _greedy(cost: np.ndarray) -> list[tuple[int, int]]:
        pairs: list[tuple[int, int]] = []
        work = cost.copy()
        while True:
            flat = int(np.argmin(work))
            row, col = divmod(flat, work.shape[1])
            if work[row, col] >= 1e6:
                break
            pairs.append((row, col))
            work[row, :] = 1e6
            work[:, col] = 1e6
            if work.size == 0 or np.all(work >= 1e6):
                break
        return pairs

    def predicted_boxes(self) -> dict[int, np.ndarray]:
        return {tid: tr._to_box(tr.kf.statePost) for tid, tr in self.tracks.items()}

    def track_age(self, track_id: int) -> int:
        track = self.tracks.get(track_id)
        return track.time_since_update if track else 0

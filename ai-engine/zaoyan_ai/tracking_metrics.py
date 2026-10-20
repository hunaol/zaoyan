"""多目标跟踪（MOT）指标：CLEAR-MOT 与 ID 指标。

跟踪器换成 Kalman + Hungarian 之后，原先 :mod:`zaoyan_ai.evaluation` 只能回答
“检出多少个越线事件”，无法说明“轨迹身份是否更稳”，也就无法证明重写带来了什么。
本模块补上标准 MOT 口径，让“跟踪质量”变成可测量的数字：

* CLEAR-MOT：MOTA / MOTP / TP / FP / FN / ID switch / fragmentation / MT-PT-ML；
* ID 指标：IDF1 / IDP / IDR（轨迹级最优指派，Ristani 等人的口径）。

两个刻意的实现选择：

1. 只用 numpy。``requirements.txt`` 目前只有 numpy / OpenCV / Pillow，
   为几个指标引入 SciPy 或 motmetrics 并不划算；
2. 指派直接复用 :func:`zaoyan_ai.tracker.hungarian`，让“评测所用的匹配算法”
   与“跟踪器内部所用的匹配算法”是同一份实现，避免评测与被测对象口径不一致。

注意：这些数字只描述传入的标注，不能当作真实食堂场景的精度结论。
"""
from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

import numpy as np

from .tracker import hungarian, iou_matrix

# 不匹配的代价。用有限大数而非 inf：整行不可达时 Hungarian 会走“放弃该行”的分支，
# 大数同样能被排除，之后再用 feasible 掩码复核一次，逻辑与 tracker.py 保持一致。
INFEASIBLE_COST = 1e6
# MT/PT/ML 的比例门限，沿用标准取值。
MOSTLY_TRACKED_RATIO = 0.8
PARTIALLY_TRACKED_RATIO = 0.2
# 与 evaluation.py 同样的口径声明：指标只对本次标注负责。
WARNING = "指标仅描述本次传入的标注数据，不构成真实食堂场景的精度结论。"


def _check_threshold(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        raise ValueError(f"iou_threshold 必须是 [0, 1] 内的数值，当前为 {value!r}")
    threshold = float(value)
    if not math.isfinite(threshold) or threshold < 0 or threshold > 1:
        raise ValueError(f"iou_threshold 必须是 [0, 1] 内的有限数值，当前为 {value!r}")
    return threshold


def _check_id(value: Any, where: str) -> int:
    # bool 是 int 的子类，但 True 当 id 用一定是调用方写错了，显式拒绝。
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise ValueError(f"{where} 的 id 必须是整数，当前为 {value!r}")
    return int(value)


def _check_bbox(value: Any, where: str) -> tuple[float, float, float, float]:
    if isinstance(value, np.ndarray):
        raw = value.tolist()
    else:
        raw = value
    if isinstance(raw, (str, bytes)) or not isinstance(raw, (list, tuple)):
        raise ValueError(f"{where} 的 bbox 必须是 (x1, y1, x2, y2) 形式的 4 个数字，当前为 {value!r}")
    if len(raw) != 4:
        raise ValueError(f"{where} 的 bbox 必须恰好 4 个数字，当前为 {value!r}")
    numbers: list[float] = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, (int, float, np.integer, np.floating)):
            raise ValueError(f"{where} 的 bbox 必须是 4 个数字，当前为 {value!r}")
        number = float(item)
        if not math.isfinite(number):
            raise ValueError(f"{where} 的 bbox 含非有限值，当前为 {value!r}")
        numbers.append(number)
    x1, y1, x2, y2 = numbers
    # 退化框（宽或高为 0）会让 IoU 恒为 0，属于标注错误而不是“没匹配上”，必须显式失败。
    if x2 <= x1 or y2 <= y1:
        raise ValueError(f"{where} 的 bbox 需要 x2 > x1 且 y2 > y1，当前为 {value!r}")
    return x1, y1, x2, y2


def _parse_entries(raw: Any, where: str) -> tuple[list[int], list[tuple[float, float, float, float]]]:
    if isinstance(raw, (str, bytes)) or not isinstance(raw, (list, tuple)):
        raise ValueError(f"{where} 必须是 {{'id': int, 'bbox': (x1, y1, x2, y2)}} 对象组成的数组")
    ids: list[int] = []
    boxes: list[tuple[float, float, float, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"{where} 的每个元素都必须是对象，当前为 {item!r}")
        if "id" not in item or "bbox" not in item:
            raise ValueError(f"{where} 的元素必须同时含 id 与 bbox 键，当前为 {item!r}")
        ids.append(_check_id(item["id"], where))
        boxes.append(_check_bbox(item["bbox"], where))
    # 同一帧内 id 重复意味着标注或跟踪输出本身有问题：继续算下去会把两条轨迹混成一条。
    if len(set(ids)) != len(ids):
        raise ValueError(f"{where} 出现重复 id，同一帧内 id 必须唯一，当前为 {sorted(ids)}")
    return ids, boxes


def _parse_frames(frames: Any) -> list[tuple[list[int], Any, list[int], Any]]:
    if isinstance(frames, (str, bytes, dict)) or not isinstance(frames, Iterable):
        raise ValueError("frames 必须是逐帧字典组成的序列")
    parsed: list[tuple[list[int], Any, list[int], Any]] = []
    for index, frame in enumerate(frames):
        where = f"第 {index} 帧"
        if not isinstance(frame, dict):
            raise ValueError(f"{where} 必须是含 gt/pred 两个键的字典，当前为 {frame!r}")
        if "gt" not in frame or "pred" not in frame:
            raise ValueError(f"{where} 缺少 gt 或 pred 键，当前键为 {sorted(frame.keys())}")
        gt_ids, gt_boxes = _parse_entries(frame["gt"], f"{where} 的 gt")
        pred_ids, pred_boxes = _parse_entries(frame["pred"], f"{where} 的 pred")
        parsed.append((gt_ids, gt_boxes, pred_ids, pred_boxes))
    return parsed


def _id_measures(
    credit: dict[tuple[int, int], int], gt_frames: dict[int, int], pred_frames: dict[int, int]
) -> tuple[int, float | None, float | None, float | None]:
    """轨迹级最优指派求 IDF1。

    ID 指标只关心“这条 GT 轨迹的帧是否被同一条预测轨迹覆盖”，
    因此不能直接照抄逐帧指派结果：一次相邻帧的错配会让 IDF1 无谓地掉下去。
    代价矩阵取 ``-重叠帧数``，再交给同一个 Hungarian 求最大化重叠的指派。
    """
    idtp = 0
    if credit:
        gt_ids = sorted(gt_frames)
        pred_ids = sorted(pred_frames)
        gt_index = {gt_id: i for i, gt_id in enumerate(gt_ids)}
        pred_index = {pred_id: j for j, pred_id in enumerate(pred_ids)}
        overlap = np.zeros((len(gt_ids), len(pred_ids)), dtype=np.float64)
        for (gt_id, pred_id), count in credit.items():
            overlap[gt_index[gt_id], pred_index[pred_id]] = count
        pairs = hungarian(-overlap)
        idtp = int(sum(int(overlap[row, col]) for row, col in pairs if overlap[row, col] > 0))
    idfn = sum(gt_frames.values()) - idtp
    idfp = sum(pred_frames.values()) - idtp
    denominator = 2 * idtp + idfp + idfn
    idf1 = 2 * idtp / denominator if denominator else None
    idp = idtp / (idtp + idfp) if idtp + idfp else None
    idr = idtp / (idtp + idfn) if idtp + idfn else None
    return idtp, idf1, idp, idr


def evaluate_tracking(frames: Any, iou_threshold: float = 0.5) -> dict:
    """按标准 MOT 口径评测逐帧的 GT / 预测轨迹。

    参数
    ----
    frames:
        逐帧字典序列：``{"gt": [{"id": int, "bbox": (x1, y1, x2, y2)}], "pred": [...]}``。
        GT 与预测各自维护 id 空间，互不影响。
    iou_threshold:
        关联所需的 IoU 下限，同时用于 ID 指标的重叠判定。

    返回
    ----
    字典，含 ``mota`` / ``motp`` / ``idf1`` 等指标。分母为 0 时对应指标为 ``None``：
    “没有 GT 可对照”与“跟踪全错”是两件事，不能都写成 0。

    匹配规则（CLEAR-MOT）
    --------------------
    * 逐帧按 ``IoU >= iou_threshold`` 构造可行边，用全局最优（Hungarian）指派，
      而不是贪心最近邻——贪心在交叉场景下会为了局部最优牺牲整体；
    * 某条 GT 这一帧匹配到的预测 id 与它上一次匹配到的不同，计 1 次 ID switch
      （跨遮挡沿用“上一次匹配”，这是 CLEAR-MOT 的标准口径）；
    * fragmentation：GT 先匹配、中间断开、之后又匹配，断开算 1 次（多帧断开仍算 1 次）。
    """
    threshold = _check_threshold(iou_threshold)
    parsed = _parse_frames(frames)

    gt_frames: dict[int, int] = {}      # GT 轨迹出现的帧数
    pred_frames: dict[int, int] = {}    # 预测轨迹出现的帧数
    gt_span: dict[int, list[int]] = {}  # GT 轨迹首末出现帧，用于 MT/PT/ML 的存活长度
    gt_hits: dict[int, int] = {}        # GT 轨迹被匹配上的帧数
    credit: dict[tuple[int, int], int] = {}  # (gt_id, pred_id) -> 同帧重叠且 IoU 达标的帧数
    last_pred_of_gt: dict[int, int] = {}
    ever_matched: set[int] = set()
    in_gap: set[int] = set()

    tp = fp = fn = id_switches = fragmentations = 0
    iou_total = 0.0

    for frame_index, (gt_ids, gt_boxes, pred_ids, pred_boxes) in enumerate(parsed):
        for gt_id in gt_ids:
            gt_frames[gt_id] = gt_frames.get(gt_id, 0) + 1
            span = gt_span.setdefault(gt_id, [frame_index, frame_index])
            span[1] = frame_index
        for pred_id in pred_ids:
            pred_frames[pred_id] = pred_frames.get(pred_id, 0) + 1

        matched: dict[int, tuple[int, float]] = {}  # GT 行号 -> (预测列号, IoU)
        if gt_boxes and pred_boxes:
            ious = iou_matrix(np.asarray(gt_boxes, dtype=np.float64), np.asarray(pred_boxes, dtype=np.float64))
            feasible = np.asarray(ious >= threshold, dtype=bool)
            cost = np.where(feasible, 1.0 - ious, INFEASIBLE_COST)
            for row, col in hungarian(cost):
                if feasible[row, col]:
                    matched[row] = (col, float(ious[row, col]))
            for row, col in zip(*np.nonzero(feasible)):
                key = (gt_ids[int(row)], pred_ids[int(col)])
                credit[key] = credit.get(key, 0) + 1

        for row, (col, iou) in matched.items():
            gt_id, pred_id = gt_ids[row], pred_ids[col]
            tp += 1
            iou_total += iou
            gt_hits[gt_id] = gt_hits.get(gt_id, 0) + 1
            previous = last_pred_of_gt.get(gt_id)
            if previous is not None and previous != pred_id:
                id_switches += 1
            last_pred_of_gt[gt_id] = pred_id
            if gt_id in in_gap:
                fragmentations += 1
                in_gap.discard(gt_id)
            ever_matched.add(gt_id)

        fn += len(gt_ids) - len(matched)
        fp += len(pred_ids) - len(matched)
        # 匹配过的轨迹这一帧掉线：标记为“断开中”，等它再被匹配上时补记一次 fragmentation。
        for row, gt_id in enumerate(gt_ids):
            if row not in matched and gt_id in ever_matched:
                in_gap.add(gt_id)

    idtp, idf1, idp, idr = _id_measures(credit, gt_frames, pred_frames)

    num_gt_detections = sum(gt_frames.values())
    num_pred_detections = sum(pred_frames.values())
    # 分母为 0 时返回 None：没有任何 GT 可对照时，MOTA=0 会被误读成“跟踪完全失败”。
    mota = 1.0 - (fn + fp + id_switches) / num_gt_detections if num_gt_detections else None
    motp = iou_total / tp if tp else None

    mostly_tracked = partially_tracked = mostly_lost = 0
    for gt_id, (first, last) in gt_span.items():
        lifespan = last - first + 1
        ratio = gt_hits.get(gt_id, 0) / lifespan
        if ratio >= MOSTLY_TRACKED_RATIO:
            mostly_tracked += 1
        elif ratio >= PARTIALLY_TRACKED_RATIO:
            partially_tracked += 1
        else:
            mostly_lost += 1

    return {
        "iou_threshold": threshold,
        "num_frames": len(parsed),
        "mota": mota,
        "motp": motp,
        "idf1": idf1,
        "idp": idp,
        "idr": idr,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "id_switches": id_switches,
        "fragmentations": fragmentations,
        "mostly_tracked": mostly_tracked,
        "partially_tracked": partially_tracked,
        "mostly_lost": mostly_lost,
        "num_gt_tracks": len(gt_frames),
        "num_pred_tracks": len(pred_frames),
        "num_gt_detections": num_gt_detections,
        "num_pred_detections": num_pred_detections,
        "idtp": idtp,
        "warning": WARNING,
    }

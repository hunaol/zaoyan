"""自适应分割器的回归测试。

覆盖三件容易在重构中悄悄退化的事：
1. 自适应阈值只能**收紧**、不能漂出种子区间；
2. 学习完成后必须冻结，否则长时间运行会出现检测闪烁；
3. 几何过滤要能挡住噪声碎片，同时留下真实目标。
"""
from __future__ import annotations

import cv2
import numpy as np
import pytest

from zaoyan_ai.segmenter import (
    MIN_SAT_SPAN,
    MIN_VAL_SPAN,
    SEED_HUE_HIGH,
    SEED_HUE_LOW,
    SEED_SAT_LOW,
    SEED_VAL_LOW,
    AdaptiveColorSegmenter,
)

# 与 scripts/generate_sample.py 一致的青绿色（BGR）。
TRAY_BGR = (160, 170, 42)


def frame_with_tray(width=640, height=360, trays=((260, 140, 88, 62),), background=240) -> np.ndarray:
    frame = np.full((height, width, 3), background, dtype=np.uint8)
    for x, y, w, h in trays:
        cv2.rectangle(frame, (x, y), (x + w, y + h), TRAY_BGR, -1)
    return frame


def test_detects_a_solid_tray_and_reports_reasonable_geometry():
    segmenter = AdaptiveColorSegmenter()
    found = segmenter.candidates(frame_with_tray(), confidence=0.35)
    assert len(found) == 1, found
    candidate = found[0]
    # cv2.boundingRect 的右下边界是闭区间，会比绘制时多 1 像素。
    assert candidate.bbox == (260, 140, 349, 203)
    # 实心矩形：填充率与凸度都应接近 1。
    assert candidate.fill_ratio > 0.9
    assert candidate.solidity > 0.9
    assert candidate.confidence > 0.6


def test_adaptive_bounds_never_leave_the_seed_range():
    segmenter = AdaptiveColorSegmenter()
    for _ in range(20):
        segmenter.mask(frame_with_tray())
    assert segmenter._frozen, "学习应在若干帧后冻结"
    # 只能收紧：下界不低于种子下界，上界不高于 255。
    assert SEED_SAT_LOW <= segmenter.sat_low <= 255
    assert SEED_VAL_LOW <= segmenter.val_low <= 255
    assert segmenter.sat_high - segmenter.sat_low >= MIN_SAT_SPAN
    assert segmenter.val_high - segmenter.val_low >= MIN_VAL_SPAN
    assert SEED_HUE_LOW <= segmenter.hue_low and segmenter.hue_high <= SEED_HUE_HIGH


def test_frozen_bounds_do_not_drift_after_learning():
    segmenter = AdaptiveColorSegmenter()
    for _ in range(20):
        segmenter.mask(frame_with_tray())
    snapshot = (segmenter.sat_low, segmenter.sat_high, segmenter.val_low, segmenter.val_high)
    # 冻结后再喂很多帧（包括一帧颜色完全不同的画面），阈值不得改变。
    for _ in range(15):
        segmenter.mask(frame_with_tray())
    segmenter.mask(frame_with_tray(background=10))
    assert (segmenter.sat_low, segmenter.sat_high, segmenter.val_low, segmenter.val_high) == snapshot


def test_learning_ignores_frames_without_a_target():
    segmenter = AdaptiveColorSegmenter()
    blank = np.full((360, 640, 3), 240, dtype=np.uint8)
    for _ in range(30):
        segmenter.mask(blank)
    # 画面里没有目标时不应学出任何分布，阈值保持种子值。
    assert segmenter.sat_low == float(SEED_SAT_LOW)
    assert segmenter.val_low == float(SEED_VAL_LOW)


def test_confidence_threshold_filters_and_scales_with_quality():
    segmenter = AdaptiveColorSegmenter()
    frame = frame_with_tray()
    high = segmenter.candidates(frame, confidence=0.95)
    low = segmenter.candidates(frame, confidence=0.05)
    # 阈值越高，留下的候选不会更多。
    assert len(high) <= len(low)


def test_noise_and_thin_shapes_are_rejected():
    segmenter = AdaptiveColorSegmenter()
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    # 细小噪点：远低于最小面积。
    for x in range(0, 640, 7):
        frame[10, x] = TRAY_BGR
    # 细长条：长宽比超出允许范围。
    cv2.rectangle(frame, (40, 200), (300, 206), TRAY_BGR, -1)
    assert segmenter.candidates(frame, confidence=0.05) == []


def test_two_blobs_joined_by_a_thin_neck_are_split():
    """被细颈连在一起的两个目标必须拆开。

    这是分水岭真正能解决的场景：接缝处距离变换存在明显低谷，
    沿低谷切开就能还原两个目标。粘连会导致"两次出餐只算一次"。
    """
    segmenter = AdaptiveColorSegmenter()
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    # 左右两个 90x62 的托盘
    cv2.rectangle(frame, (200, 140), (290, 202), TRAY_BGR, -1)
    cv2.rectangle(frame, (300, 140), (390, 202), TRAY_BGR, -1)
    # 中间用 10px 宽的细颈连起来，形成单一连通域
    cv2.rectangle(frame, (288, 166), (302, 176), TRAY_BGR, -1)

    found = segmenter.candidates(frame, confidence=0.05)
    assert len(found) == 2, f"细颈粘连未被拆开: {[c.bbox for c in found]}"
    # 分水岭会沿脊线吃掉约 1 像素，因此不比对精确坐标，
    # 只要求两个候选分别落回左右托盘的范围内。
    left, right = sorted(found, key=lambda c: c.bbox[0])
    assert 199 <= left.bbox[0] <= 202
    assert 388 <= right.bbox[2] <= 391
    assert left.bbox[2] <= 296 and right.bbox[0] >= 294


def test_seamlessly_merged_identical_objects_are_not_falsely_split():
    """两个同色矩形无缝贴合时，**必须**保持为一个候选。

    这是一个刻意的限制而不是缺陷：并集与"一个 240px 宽的矩形"
    在像素上完全无法区分，距离变换沿中线是平坦的 32px，没有任何低谷。
    任何声称能从单帧里把它们分开的做法都是在猜。真实解决办法是
    多帧跟踪——目标在贴合之前是分开的，跟踪器已经持有两个 ID。
    """
    segmenter = AdaptiveColorSegmenter()
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    cv2.rectangle(frame, (200, 140), (320, 202), TRAY_BGR, -1)
    cv2.rectangle(frame, (320, 140), (440, 202), TRAY_BGR, -1)
    found = segmenter.candidates(frame, confidence=0.05)
    assert len(found) == 1, f"无缝贴合被过度拆分: {[c.bbox for c in found]}"
    assert found[0].bbox == (200, 140, 441, 203)


def test_single_large_tray_is_not_over_segmented():
    """单个目标不能被误拆——分水岭最容易在这里产生假阳性。"""
    segmenter = AdaptiveColorSegmenter()
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    cv2.rectangle(frame, (220, 130), (420, 210), TRAY_BGR, -1)
    found = segmenter.candidates(frame, confidence=0.05)
    assert len(found) == 1, f"单个目标被过度分割: {[c.bbox for c in found]}"


def test_hollow_ring_is_not_split_by_watershed():
    """空心环形（如托盘边框）只有一个距离峰，不应被拆成多个目标。"""
    segmenter = AdaptiveColorSegmenter()
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    cv2.rectangle(frame, (240, 140), (400, 220), TRAY_BGR, -1)
    cv2.rectangle(frame, (270, 160), (370, 200), (240, 240, 240), -1)
    found = segmenter.candidates(frame, confidence=0.05)
    assert len(found) == 1, f"空心目标被误拆: {[c.bbox for c in found]}"


def test_empty_frame_is_accepted_but_yields_nothing():
    segmenter = AdaptiveColorSegmenter()
    assert segmenter.candidates(np.full((120, 160, 3), 200, dtype=np.uint8), 0.3) == []


def test_invalid_frame_raises():
    segmenter = AdaptiveColorSegmenter()
    with pytest.raises(ValueError):
        segmenter.mask(np.zeros((0, 0, 3), dtype=np.uint8))


def test_saturation_of_dark_pixels_still_detected_within_seed_range():
    # 亮度降到种子下界附近：仍应被检出，体现"带界自适应"而不是硬阈值。
    segmenter = AdaptiveColorSegmenter()
    dark = (120, 128, 45)
    frame = np.full((360, 640, 3), 240, dtype=np.uint8)
    cv2.rectangle(frame, (260, 140), (348, 202), dark, -1)
    assert len(segmenter.candidates(frame, confidence=0.05)) == 1

"""重写后的跟踪器回归测试：把“为什么必须重写”变成可复现的断言。

tracker.py 记录了旧实现的三个硬伤：只看上一帧中心点（目标走快一点就断轨）、
门限是写死的像素常量（换分辨率即失效）、贪心最近邻在交叉场景会互换 ID。
前两组用例直接针对这三点取证，第三组盯住遮挡后的 ID 连续性：max_age 的容忍语义
必须真的生效，否则遮挡一结束就会当成新目标，越线计数随之重复。
断言的都是外部可观察行为，不绑定 Kalman/Hungarian 的内部细节。
"""
import numpy as np
import pytest

from zaoyan_ai.tracker import CentroidTracker, hungarian, iou_matrix


def box(cx, cy, w=60.0, h=40.0):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def key(bbox):
    return tuple(round(float(v), 3) for v in bbox)


@pytest.mark.parametrize('scale', [1.0, 4.0])
def test_fast_straight_line_keeps_one_id(scale):
    # 相邻帧位移恒为框宽的 3/4（scale=1 时 45 像素，scale=4 时 180 像素），
    # 相邻帧 IoU 只有 0.14、低于 MIN_IOU，光靠框重叠续不上，
    # 必须由 Kalman 外推和“按画面高度归一化”的门限接力。
    # 旧实现把门限写死成 78 像素：scale=4 时每帧都会断轨、每帧新建一个 ID。
    size = 60.0 * scale
    tracker = CentroidTracker()
    ids = set()
    x = 80.0 * scale
    for _ in range(60):
        rows = tracker.update([box(x, 300.0 * scale, size, size * 2 / 3)])
        assert rows, '目标全程可见，不应该返回空结果'
        ids.add(rows[0][0])
        x += 45.0 * scale
    assert ids == {1}
    assert tracker.next_id == 2  # 没有偷偷“新建再回收”，ID 是连续的


def test_short_occlusion_does_not_change_the_id():
    tracker = CentroidTracker()
    x = 120.0
    first = tracker.update([box(x, 260)])[0][0]
    for _ in range(9):
        x += 14
        tracker.update([box(x, 260)])
    for _ in range(4):  # 连续 4 帧无检测：模拟被遮挡，且远小于 max_age
        assert tracker.update([]) == []
        x += 14  # 遮挡期间目标仍在匀速前进，恢复帧不会落在原处
    rows = tracker.update([box(x, 260)])
    assert rows[0][0] == first
    assert rows[0][3] is False  # 续跟旧轨迹，而不是新建
    assert tracker.next_id == 2 and len(tracker.tracks) == 1


def test_crossing_targets_do_not_swap_ids():
    # 两个目标反向对穿，纵向错开 10 像素：交叉段两者 IoU 约 0.45，
    # 是逐帧指派最容易出错的地方，必须靠全局最优 + 各自的速度估计把身份分开。
    tracker = CentroidTracker()
    start_a, start_b, step = 100.0, 500.0, 20.0
    assigned = {'A': set(), 'B': set()}
    for i in range(41):
        truth_a = box(start_a + step * i, 300.0)
        truth_b = box(start_b - step * i, 310.0)
        owner = {key(truth_a): 'A', key(truth_b): 'B'}
        rows = tracker.update([truth_a, truth_b])
        assert len(rows) == 2
        for track_id, bbox, _confidence, _is_new in rows:
            assigned[owner[key(bbox)]].add(track_id)
    assert len(assigned['A']) == 1 and len(assigned['B']) == 1
    assert assigned['A'] != assigned['B']
    assert tracker.next_id == 3  # 全程只有两条轨迹


def test_hungarian_picks_the_known_minimum_cost_assignment():
    cost = np.array([[10.0, 2.0, 8.0], [9.0, 7.0, 5.0], [6.0, 4.0, 3.0]])
    pairs = sorted(hungarian(cost))
    # 手工枚举 6 种排列，唯一最优是 (0,1)(1,2)(2,0)：2 + 5 + 6 = 13。
    assert pairs == [(0, 1), (1, 2), (2, 0)]
    assert sum(cost[r, c] for r, c in pairs) == 13.0


@pytest.mark.parametrize('shape', [(2, 5), (5, 2), (1, 4), (4, 1), (3, 3), (1, 1)])
def test_hungarian_returns_in_range_pairs_for_rectangular_matrices(shape):
    cost = np.random.default_rng(sum(shape)).random(shape)
    pairs = hungarian(cost)
    assert len(pairs) == min(shape)  # 配对数不超过 min(n, m)
    assert len({r for r, _ in pairs}) == len(pairs)
    assert len({c for _, c in pairs}) == len(pairs)
    assert all(0 <= r < shape[0] and 0 <= c < shape[1] for r, c in pairs)


def test_hungarian_keeps_pairs_in_range_when_edges_are_infeasible():
    # 第 3 行整行不可达：应当放弃这一行，而不是越界或死循环。
    cost = np.array([[np.inf, 3.0], [1.0, np.inf], [np.inf, np.inf]])
    pairs = hungarian(cost)
    assert len(pairs) == 2
    assert all(0 <= r < 3 and 0 <= c < 2 for r, c in pairs)
    assert len({r for r, _ in pairs}) == 2 and len({c for _, c in pairs}) == 2
    # 跟踪器实际用的是有限大数代价，同样必须只返回合法下标。
    finite = np.array([[1e6, 1e6, 0.4], [0.2, 0.3, 1e6]])
    assert sorted(hungarian(finite)) == [(0, 2), (1, 0)]


SHAPES = [
    ((2, 4), (3, 4)), ((3, 4), (2, 4)), ((1, 4), (1, 4)),
    ((0, 4), (3, 4)), ((3, 4), (0, 4)), ((0, 4), (0, 4)),
]


@pytest.mark.parametrize('shape_a,shape_b', SHAPES)
def test_iou_matrix_shape_is_n_by_m(shape_a, shape_b):
    rng = np.random.default_rng(shape_a[0] * 10 + shape_b[0])
    a = np.sort(rng.random(shape_a) * 100, axis=1)
    b = np.sort(rng.random(shape_b) * 100, axis=1)
    assert iou_matrix(a, b).shape == (shape_a[0], shape_b[0])


def test_iou_matrix_values_for_identical_and_disjoint_boxes():
    a = np.array([[0.0, 0.0, 10.0, 10.0]])
    assert iou_matrix(a, a.copy())[0, 0] == pytest.approx(1.0)
    assert iou_matrix(a, np.array([[50.0, 50.0, 60.0, 60.0]]))[0, 0] == 0.0

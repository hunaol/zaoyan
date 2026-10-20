"""MOT 指标测试：用合成帧验证口径与边界，不宣称任何真实场景精度。"""
import pytest

from zaoyan_ai.tracking_metrics import evaluate_tracking


def box(cx, cy, size=40.0):
    return (cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2)


def row(ident, bbox):
    return {'id': ident, 'bbox': bbox}


def frame(gt_rows, pred_rows):
    return {'gt': gt_rows, 'pred': pred_rows}


def straight(n=10, step=8.0, ident=1, pred_id=None, dx=0.0):
    """生成 n 帧匀速直线运动。

    ``dx`` 给预测框加固定水平偏移，用来构造“部分重叠”的匹配：40 像素的框偏移 8
    时同帧 IoU 为 2/3，偏移 16 时为 3/7。``pred_id=None`` 表示预测 id 与 GT 一致。
    """
    frames = []
    for i in range(n):
        truth = box(100 + step * i, 200)
        guess = box(100 + step * i + dx, 200)
        frames.append(frame([row(ident, truth)], [row(pred_id if pred_id is not None else ident, guess)]))
    return frames


def test_perfect_tracking_scores_one():
    m = evaluate_tracking(straight(12))
    assert m['mota'] == 1.0
    assert m['idf1'] == 1.0
    assert m['id_switches'] == 0
    assert m['tp'] == 12 and m['fp'] == 0 and m['fn'] == 0
    assert m['motp'] == pytest.approx(1.0)
    assert m['num_gt_tracks'] == 1 and m['num_pred_tracks'] == 1
    assert m['mostly_tracked'] == 1 and m['partially_tracked'] == 0 and m['mostly_lost'] == 0
    assert m['warning']


def test_swapped_prediction_id_is_an_id_switch():
    # 同一条 GT 轨迹，前 3 帧由预测 10 跟住，之后换成预测 11。
    frames = [frame([row(1, box(100, 200))], [row(10 if i < 3 else 11, box(100, 200))]) for i in range(6)]
    m = evaluate_tracking(frames)
    assert m['id_switches'] >= 1
    assert m['num_pred_tracks'] == 2
    # 框都在，所以 TP 不掉；身份错误必须体现在 MOTA 与 IDF1 上，否则指标会掩盖问题。
    assert m['tp'] == 6 and m['fp'] == 0 and m['fn'] == 0
    assert m['mota'] == pytest.approx(1 - 1 / 6)
    assert m['idf1'] == pytest.approx(0.5)


def test_missed_detections_raise_fn_and_lower_mota():
    frames = straight(10)
    for i in (2, 3, 7):
        frames[i]['pred'] = []
    m = evaluate_tracking(frames)
    assert m['fn'] == 3 and m['tp'] == 7 and m['fp'] == 0
    assert m['mota'] == pytest.approx(0.7)
    assert m['mota'] < 1
    # 2、3 两帧连续断开只算一次 fragmentation；第 7 帧再断一次 → 共 2 次。
    assert m['fragmentations'] == 2
    # 10 帧里跟住 7 帧 = 0.7，落在 PT 区间。
    assert m['partially_tracked'] == 1 and m['mostly_tracked'] == 0


def test_spurious_detections_raise_fp():
    frames = straight(8)
    for i in range(0, 8, 2):
        frames[i]['pred'].append(row(99, box(600, 400)))
    m = evaluate_tracking(frames)
    assert m['fp'] == 4 and m['tp'] == 8 and m['fn'] == 0
    assert m['mota'] == pytest.approx(0.5)
    assert m['num_pred_tracks'] == 2


def test_mota_can_go_negative_when_false_positives_dominate():
    frames = straight(4)
    for f in frames:
        for k in range(3):
            f['pred'].append(row(100 + k, box(600 + 60 * k, 400)))
    m = evaluate_tracking(frames)
    assert m['fp'] == 12
    assert m['mota'] == pytest.approx(-2.0) and m['mota'] < 0


def test_fragmentation_detects_interrupt_and_recovery():
    frames = []
    for i in range(10):
        truth = box(100 + 8 * i, 200)
        pred = [] if i in (4, 5) else [row(1, truth)]
        frames.append(frame([row(1, truth)], pred))
    m = evaluate_tracking(frames)
    assert m['fragmentations'] == 1
    # 恢复后仍是同一条预测轨迹：断开不等于身份切换。
    assert m['id_switches'] == 0
    # IDF1 也把“这两帧根本没有预测”算成身份缺失：8/(8+1) 而不是 1.0。
    assert m['idf1'] == pytest.approx(16 / 18)
    assert m['tp'] == 8 and m['fn'] == 2
    assert m['mostly_tracked'] == 1  # 8/10 正好达到门限


def test_track_quality_buckets_follow_matched_ratio():
    # 三条 GT 轨迹时长为 10 帧，分别跟住 9 / 5 / 1 帧。
    hits = {1: 9, 2: 5, 3: 1}
    frames = []
    for i in range(10):
        gt_rows = [row(ident, box(100 * ident, 200)) for ident in hits]
        pred_rows = [row(ident, box(100 * ident, 200)) for ident, hit in hits.items() if i < hit]
        frames.append(frame(gt_rows, pred_rows))
    m = evaluate_tracking(frames)
    assert m['num_gt_tracks'] == 3
    assert (m['mostly_tracked'], m['partially_tracked'], m['mostly_lost']) == (1, 1, 1)


def test_motp_is_the_mean_iou_of_matched_pairs():
    m = evaluate_tracking(straight(4, step=0.0, dx=8.0))
    # 40 的框平移 8：交 32*40，并 2*40*40 - 32*40。
    assert m['motp'] == pytest.approx(32 * 40 / (2 * 40 * 40 - 32 * 40))
    assert m['tp'] == 4
    assert m['mota'] == 1.0


def test_motp_averages_over_frames_with_different_overlap():
    frames = [frame([row(1, box(100, 200))], [row(1, box(100 + dx, 200))]) for dx in (0.0, 8.0, 16.0)]
    m = evaluate_tracking(frames, iou_threshold=0.3)
    expected = (1.0 + 32 * 40 / 1920 + 24 * 40 / 2240) / 3
    assert m['tp'] == 3
    assert m['motp'] == pytest.approx(expected)


def test_iou_threshold_gates_matching():
    frames = straight(3, step=0.0, dx=16.0)  # 同帧 IoU = 24*40/2240 ≈ 0.429
    strict = evaluate_tracking(frames, iou_threshold=0.5)
    loose = evaluate_tracking(frames, iou_threshold=0.3)
    assert strict['tp'] == 0 and strict['fn'] == 3 and strict['fp'] == 3
    assert loose['tp'] == 3 and loose['fp'] == 0 and loose['fn'] == 0
    assert loose['motp'] == pytest.approx(24 * 40 / (2 * 40 * 40 - 24 * 40))


def test_empty_input_returns_coherent_zeros_without_crashing():
    for frames in ([], [frame([], [])]):
        m = evaluate_tracking(frames)
        assert (m['tp'], m['fp'], m['fn']) == (0, 0, 0)
        assert m['id_switches'] == 0 and m['fragmentations'] == 0
        # 没有可对照的 GT：MOTA/MOTP/IDF1 无定义，写 0 会被误读成“跟踪完全失败”。
        assert m['mota'] is None and m['motp'] is None and m['idf1'] is None
        assert m['num_gt_tracks'] == 0 and m['num_pred_tracks'] == 0
        assert m['mostly_tracked'] == m['partially_tracked'] == m['mostly_lost'] == 0
        assert isinstance(m['warning'], str) and m['warning']


def test_gt_without_predictions_is_all_misses():
    m = evaluate_tracking([frame([row(1, box(100, 100))], []) for _ in range(5)])
    assert m['fn'] == 5 and m['tp'] == 0 and m['fp'] == 0
    assert m['mota'] == 0.0 and m['idf1'] == 0.0  # 有 GT 可对照，0 分就是真的 0 分
    assert m['mostly_lost'] == 1


def test_predictions_without_gt_are_all_false_positives():
    m = evaluate_tracking([frame([], [row(7, box(100, 100))]) for _ in range(3)])
    assert m['fp'] == 3 and m['tp'] == 0 and m['fn'] == 0
    assert m['mota'] is None  # 没有 GT 做分母，不能假装 0 分
    assert m['idf1'] == 0.0 and m['num_pred_tracks'] == 1


def test_duplicate_id_in_one_frame_is_rejected():
    with pytest.raises(ValueError):
        evaluate_tracking([frame([row(1, box(100, 100)), row(1, box(300, 300))], [])])


BAD_FRAMES = [
    'not-a-sequence',
    None,
    {'gt': [], 'pred': []},
    [None],
    [{'gt': []}],
    [{'pred': []}],
    [{'gt': {}, 'pred': []}],
    [{'gt': [1], 'pred': []}],
    [{'gt': [{'id': 1}], 'pred': []}],
    [{'gt': [{'bbox': (0, 0, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': True, 'bbox': (0, 0, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': '1', 'bbox': (0, 0, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': 1.5, 'bbox': (0, 0, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (0, 0, 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (0, 0, 10, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': 'box'}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (0, 0, float('nan'), 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (0, 0, float('inf'), 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (10, 0, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (0, 10, 10, 10)}], 'pred': []}],
    [{'gt': [{'id': 1, 'bbox': (10, 0, 0, 10)}], 'pred': []}],
]


@pytest.mark.parametrize('bad', BAD_FRAMES)
def test_malformed_frames_raise_chinese_value_error(bad):
    with pytest.raises(ValueError) as excinfo:
        evaluate_tracking(bad)
    # 面向调用方的报错必须是中文且指向具体位置，否则定位标注问题要从头读代码。
    assert any('\u4e00' <= ch <= '\u9fff' for ch in str(excinfo.value))


@pytest.mark.parametrize('bad', [-0.1, 1.5, float('nan'), float('inf'), -float('inf'), True, '0.5', None])
def test_invalid_iou_threshold_rejected(bad):
    with pytest.raises(ValueError) as excinfo:
        evaluate_tracking(straight(2), iou_threshold=bad)
    assert any('\u4e00' <= ch <= '\u9fff' for ch in str(excinfo.value))


def test_cli_runs_tracking_metrics_with_tracks_flag(tmp_path, monkeypatch):
    import json
    import sys
    from zaoyan_ai import evaluation

    # 走一遍 JSON 落盘再读回：bbox 会变成 list，指标模块必须同样接受。
    tracks = tmp_path / 'tracks.json'
    tracks.write_text(json.dumps({'frames': straight(5)}), encoding='utf-8')
    output = tmp_path / 'out.json'
    monkeypatch.setattr(sys, 'argv', ['evaluation', '--tracks', str(tracks), '--output', str(output)])
    evaluation.main()
    written = json.loads(output.read_text(encoding='utf-8'))
    assert written['mota'] == 1.0 and written['idf1'] == 1.0
    assert written['num_frames'] == 5 and written['warning']


def test_cli_event_matching_is_unchanged_without_tracks(tmp_path, monkeypatch):
    import json
    import sys
    from zaoyan_ai import evaluation

    reference = tmp_path / 'reference.json'
    prediction = tmp_path / 'prediction.json'
    reference.write_text(json.dumps([{'clip_id': 'a', 'offset_seconds': 1.0}]), encoding='utf-8')
    prediction.write_text(json.dumps([{'clip_id': 'a', 'offset_seconds': 1.1}]), encoding='utf-8')
    output = tmp_path / 'out.json'
    monkeypatch.setattr(
        sys, 'argv',
        ['evaluation', '--reference', str(reference), '--prediction', str(prediction), '--output', str(output)],
    )
    evaluation.main()
    written = json.loads(output.read_text(encoding='utf-8'))
    assert written['tp'] == 1 and written['fp'] == 0 and written['fn'] == 0
    assert 'clips' in written and 'mota' not in written


def test_cli_without_any_input_flags_fails_loudly(tmp_path, monkeypatch):
    import sys
    from zaoyan_ai import evaluation

    monkeypatch.setattr(sys, 'argv', ['evaluation', '--output', str(tmp_path / 'out.json')])
    with pytest.raises(SystemExit):
        evaluation.main()

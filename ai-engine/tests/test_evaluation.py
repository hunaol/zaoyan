import pytest
from zaoyan_ai.evaluation import evaluate

def event(t,clip='a'):return {'clip_id':clip,'offset_seconds':t}

def test_duplicate_prediction_is_not_two_true_positives():
    r=evaluate([event(1)],[event(1),event(1.1)])
    assert r['tp']==1 and r['fp']==1 and r['precision']==.5

def test_equal_counts_do_not_hide_wrong_event_timestamps():
    r=evaluate([event(1)],[event(10)])
    assert r['tp']==0 and r['fp']==r['fn']==1 and r['mean_count_absolute_error']==0

def test_never_matches_different_clips():
    r=evaluate([event(1,'a')],[event(1,'b')]);assert r['tp']==0

def test_empty_annotations_do_not_invent_perfect_score():
    r=evaluate([],[]);assert r['f1'] is None and r['recall'] is None

def test_earliest_feasible_matching_handles_overlapping_windows():
    r=evaluate([event(1),event(1.7)],[event(.7),event(1.3)],.5);assert r['tp']==2

@pytest.mark.parametrize('bad',[True,-1,float('nan')])
def test_invalid_offset_rejected(bad):
    with pytest.raises(ValueError):evaluate([event(bad)],[])

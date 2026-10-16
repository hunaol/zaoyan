"""Regression coverage for the V1.1 business and time/geometry contracts."""
from datetime import date, timedelta
import math
import pytest
from zaoyan_ai.forecast import forecast
from zaoyan_ai.vision import LineCounter, Detection, CentroidTracker


def observations(days=8, end=date(2026, 10, 15), value=100):
    return [{'date': (end-timedelta(days=days-i)).isoformat(), 'quantity': value} for i in range(days)]


def test_target_date_excludes_target_and_future():
    samples=observations(3)+[{'date':'2026-10-15','quantity':9999},{'date':'2026-11-20','quantity':9999}]
    r=forecast(samples,.1,'2026-10-15')
    assert r['sample_size']==3 and r['predicted_qty']==100 and r['recommended_qty']==110
    assert r['history_end']=='2026-10-14'


def test_target_date_is_not_future_leak_for_historical_backtest():
    r=forecast(observations(8),.08,'2026-10-09')
    assert not r['enough_data'] and r['sample_size']==2


def test_same_weekday_requires_at_least_three_observed_dates():
    rows=observations(28)
    for row in rows:
        if date.fromisoformat(row['date']).weekday()==date(2026,10,15).weekday():row['quantity']=200
    r=forecast(rows,0,'2026-10-15')
    assert r['method']=='SAME_WEEKDAY_WEIGHTED' and r['sample_size']==4
    assert r['predicted_qty']==200


def test_null_false_fraction_and_nan_are_not_zero_observations():
    rows=[{'date':f'2026-10-{d:02d}','quantity':v} for d,v in enumerate([None,False,-1,1.5,math.nan,math.inf],1)]
    assert forecast(rows,0,'2026-10-15')['sample_size']==0


def test_zero_is_valid_verified_demand():
    r=forecast(observations(3,value=0),.3,'2026-10-15')
    assert r['enough_data'] and r['predicted_qty']==0 and r['recommended_qty']==0


def test_duplicate_date_last_value_wins_but_is_one_day():
    rows=observations(3)+[{'date':'2026-10-14','quantity':200}]
    r=forecast(rows,0,'2026-10-15')
    assert r['sample_size']==3 and r['predicted_qty']==150


@pytest.mark.parametrize('rate',[-.01,.51,math.nan,math.inf])
def test_invalid_buffer_is_rejected(rate):
    with pytest.raises(ValueError):forecast(observations(3),rate,'2026-10-15')


def box(x,y,track=1):
    return Detection(track,(int(x*1000)-10,int(y*1000)-10,int(x*1000)+10,int(y*1000)+10),.9,'tray')


def test_diagonal_segment_intersection_counts_even_if_final_point_outside():
    c=LineCounter((.2,.5,.8,.5))
    assert c.update([box(.5,.3)],1000,1000,0)==[]
    assert len(c.update([box(.9,.7)],1000,1000,1))==1 # intersection x=.7


def test_outside_segment_crossing_does_not_count():
    c=LineCounter((.2,.5,.8,.5))
    c.update([box(.95,.3)],1000,1000,0)
    assert not c.update([box(.75,.7)],1000,1000,1) # intersection x=.85 (outside)


def test_deadzone_jitter_does_not_duplicate():
    c=LineCounter((.2,.5,.8,.5));events=[]
    for i,y in enumerate([.3,.499,.505,.53,.49,.3,.7]):
        events+=c.update([box(.5,y)],1000,1000,i)
    assert len(events)==1


def test_reverse_direction_filters_positive_crossing():
    c=LineCounter((.2,.5,.8,.5),'negative')
    c.update([box(.5,.3)],1000,1000,0)
    assert not c.update([box(.5,.7)],1000,1000,1)
    assert len(c.update([box(.5,.3)],1000,1000,2))==1


def test_expired_track_is_not_resurrected_before_pruning():
    tracker=CentroidTracker(max_age=2)
    original=tracker.update([(10,10,50,50)])[0].track_id
    tracker.update([]);tracker.update([])
    new=tracker.update([(10,10,50,50)])[0].track_id
    assert new!=original


@pytest.mark.parametrize('line',[(0,.5,2,.5),(0,.5,math.nan,.5)])
def test_invalid_normalized_line_is_rejected(line):
    with pytest.raises(ValueError):LineCounter(line)

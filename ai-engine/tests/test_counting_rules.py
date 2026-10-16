"""V1.2 rule contract and special-case tests. Synthetic images, NOT real cafeteria accuracy."""
import json
import math
import numpy as np
import pytest
from zaoyan_ai.rules import parse_rules, load_rules
from zaoyan_ai.vision import Detection, Detector, LineCounter, select_targets, draw_annotations


def d(y, track=1, x=.5, conf=.9, label='tray'):
    return Detection(track,(int(x*1000)-20,int(y*1000)-20,int(x*1000)+20,int(y*1000)+20),conf,label)


def sequence(counter, ys, track=1, begin=0., **kw):
    result=[]
    for i,y in enumerate(ys):result+=counter.update([d(y,track,**kw)],1000,1000,begin+i*.1)
    return result


@pytest.mark.parametrize('bad',[
    {'roiX1':.95},{'roiX2':math.nan},{'stableFrames':True},{'stableFrames':1.5},
    {'confidence':.8,'reviewConfidence':.7},{'schemaVersion':2},
    {'targetLabels':['Tray']},{'targetLabels':['tray','tray']},{'targetLabels':[]},
    {'targetLabels':['empty_tray']},{'nestingPolicy':'ALL'},{'maxGapSeconds':0},
])
def test_invalid_rule_is_rejected(bad):
    with pytest.raises(ValueError):parse_rules(bad)


def test_json_file_snapshot_roundtrips(tmp_path):
    p=tmp_path/'rules.json';p.write_text(json.dumps({'stableFrames':3,'roiY1':.1}),encoding='utf8')
    assert load_rules(str(p))['stableFrames']==3
    assert load_rules(str(p))['roiY1']==.1


def test_two_stable_frames_each_side_and_no_double_count():
    c=LineCounter((.2,.5,.8,.5),rules={})
    events=sequence(c,[.3,.31,.6,.61,.3,.31,.6,.61])
    assert len(events)==1 and c.total==1
    assert events[0]['unit']=='CONTAINER_EVENT'
    assert 'CONTENT_UNVERIFIED' in events[0]['risk_reasons']


def test_isolated_one_frame_crossings_not_counted():
    c=LineCounter((.2,.5,.8,.5),rules={})
    assert not sequence(c,[.3,.7,.3,.7,.3,.7])


def test_deadzone_needs_restabilization():
    c=LineCounter((.2,.5,.8,.5),rules={})
    assert not sequence(c,[.3,.31,.501,.7])
    assert len(c.update([d(.71)],1000,1000,.5))==1


def test_gap_does_not_invent_crossing():
    c=LineCounter((.2,.5,.8,.5),rules={'maxGapSeconds':.5})
    assert not sequence(c,[.3,.31])
    assert not sequence(c,[.6,.61],begin=2.)
    result=sequence(c,[.3,.31,.6,.61],begin=2.3)
    assert len(result)==1 and 'TRACK_GAP' in result[0]['risk_reasons']
    assert 'RETURN_MOVEMENT' in result[0]['risk_reasons']


def test_new_track_near_old_crossing_warns_but_does_not_drop_real_second_serving():
    c=LineCounter((.2,.5,.8,.5),rules={})
    first=sequence(c,[.3,.31,.6,.61])
    second=sequence(c,[.3,.31,.6,.61],track=2,begin=.4)
    assert len(first)==len(second)==1
    assert 'POSSIBLE_DUPLICATE' in second[0]['risk_reasons']


def test_low_confidence_before_crossing_stays_visible():
    c=LineCounter((.2,.5,.8,.5),rules={})
    assert 'LOW_CONFIDENCE' in sequence(c,[.3,.31,.6,.61],conf=.5)[0]['risk_reasons']


def test_moving_outside_roi_does_not_count():
    c=LineCounter((.25,.5,.75,.5),rules={'roiX1':.2,'roiX2':.8})
    assert not sequence(c,[.3,.31,.6,.61],x=.9)


def test_line_outside_roi_fails_not_silent_fallback():
    with pytest.raises(ValueError):LineCounter((0,.5,1,.5),rules={'roiX1':.2})


def test_target_nesting_outer_inner_and_explicit_empty():
    outer=Detection(1,(0,0,500,500),.9,'tray')
    inner=Detection(2,(20,20,150,150),.9,'mealbox')
    empty=Detection(3,(600,0,900,400),.9,'empty_tray')
    a=select_targets([outer,inner,empty],parse_rules())
    b=select_targets([outer,inner,empty],parse_rules({'nestingPolicy':'INNER'}))
    assert [d.track_id for d in a]==[1] and [d.track_id for d in b]==[2]
    assert a[0].reasons==('NESTED_TARGET',)


def test_partial_overlap_warns_both_without_merging_two_meals():
    boxes=[Detection(1,(0,0,100,100),.9,'tray'),Detection(2,(50,0,150,100),.9,'tray')]
    out=select_targets(boxes,parse_rules())
    assert len(out)==2 and all('OVERLAP' in d.reasons for d in out)


def test_infer_crops_before_model_and_restores_full_frame_coordinates():
    detector=Detector(rules={'roiX1':.25,'roiY1':.25,'roiX2':.75,'roiY2':.75})
    observed=[]
    def mock_infer(crop):
        observed.append(crop.shape)
        return [Detection(1,(10,20,50,70),.9,'tray')]
    detector._infer_crop=mock_infer
    boxes=detector.infer(np.zeros((200,400,3),dtype=np.uint8))
    assert observed==[(100,200,3)] and boxes[0].bbox==(110,70,150,120)


def test_annotated_export_masks_far_outside_roi():
    c=LineCounter((.25,.5,.75,.5),rules={'roiX1':.2,'roiY1':.2,'roiX2':.8,'roiY2':.8})
    frame=np.full((1000,1000,3),255,dtype=np.uint8)
    result=draw_annotations(frame,[],c,0)
    assert np.all(result[950,950]==0) and np.all(result[400,400]==255)
    assert np.all(frame[950,950]==255) # source not mutated


def test_time_must_not_reverse():
    c=LineCounter(rules={});c.update([],100,100,3)
    with pytest.raises(ValueError):c.update([],100,100,2)


def test_rule_objects_do_not_mutate_global_defaults():
    a=parse_rules();a['targetLabels'].append('custom')
    assert 'custom' not in parse_rules()['targetLabels']

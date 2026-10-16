import json
from pathlib import Path
import cv2
import numpy as np
from zaoyan_ai.vision import Detection,LineCounter,Detector
from zaoyan_ai.forecast import forecast
from zaoyan_ai.video_job import analyze
from scripts.generate_sample import generate


def test_direction_and_dedup():
    line=LineCounter()
    box=lambda y:Detection(5,(200,y,270,y+30),.95,'demo')
    assert line.update([box(80)],500,500,0)==[]
    assert len(line.update([box(270)],500,500,1))==1
    assert line.update([box(80)],500,500,2)==[]
    assert line.update([box(270)],500,500,3)==[]


def test_opposite_does_not_count():
    line=LineCounter()
    box=lambda y:Detection(9,(200,y,270,y+30),.95,'demo')
    line.update([box(330)],500,500,0)
    assert line.update([box(90)],500,500,1)==[]


def test_forecast_requires_grounded_history():
    assert forecast([])['enough_data'] is False
    assert forecast([{'date':'2026-10-01','quantity':100},{'date':'2026-10-02','quantity':120},{'date':'2026-10-03','quantity':130}])['recommended_qty']>=100


def test_generated_video_is_actually_detected(tmp_path):
    sample=generate(tmp_path/'sample.mp4')
    result=analyze(str(sample),str(tmp_path/'annotated.mp4'),str(tmp_path/'status.json'),str(tmp_path/'result.json'))
    assert result['frame_count']>100
    assert result['raw_count']==3, result['events']
    assert (tmp_path/'annotated.mp4').stat().st_size>0

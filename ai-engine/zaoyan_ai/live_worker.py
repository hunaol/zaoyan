"""常驻 Python 子进程：stdin 一行 JSON(Base64 JPEG)，stdout 一行检测 JSON。
由 Spring Boot ProcessBuilder 启动，不对公网监听端口。
"""
from __future__ import annotations
import argparse
import contextlib
import base64
import json
import sys
import time
import cv2
import numpy as np
from .vision import Detector,LineCounter
from .rules import load_rules


def main():
    p=argparse.ArgumentParser();p.add_argument('--detector',choices=['demo-color','yolo'],default='demo-color')
    p.add_argument('--line',default='.08,.54,.92,.54');p.add_argument('--direction',default='positive')
    p.add_argument('--weights',default=None);p.add_argument('--rules',default=None)
    a=p.parse_args()
    rules=load_rules(a.rules)
    with contextlib.redirect_stdout(sys.stderr):
        detector=Detector(a.detector,a.weights,rules=rules)
    counter=LineCounter(tuple(map(float,a.line.split(','))),a.direction,rules=rules)
    print(json.dumps({'ready':True,'mode':a.detector}),flush=True)
    started=time.monotonic()
    for raw in sys.stdin:
        try:
            request=json.loads(raw)
            img=base64.b64decode(request['image'],validate=True)
            frame=cv2.imdecode(np.frombuffer(img,dtype=np.uint8),cv2.IMREAD_COLOR)
            if frame is None:raise ValueError('帧数据不是有效的 JPEG')
            h,w=frame.shape[:2]
            with contextlib.redirect_stdout(sys.stderr):
                detections=detector.infer(frame)
            new_events=counter.update(detections,w,h,time.monotonic()-started)
            response={'boxes':[d.normalized(w,h) for d in detections],'events':new_events,'total':counter.total,
                      'detector':a.detector}
        except Exception as error:
            response={'error':str(error),'boxes':[],'events':[]}
        print(json.dumps(response,ensure_ascii=False),flush=True)

if __name__=='__main__':main()

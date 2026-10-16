"""stdin/stdout 长连接协议：真正用采样 JPEG 跑 OpenCV 并返回越线事件。"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import cv2
from scripts.generate_sample import generate


def test_live_json_lines(tmp_path):
    video=generate(tmp_path/'live.mp4')
    proc=subprocess.Popen([sys.executable,'-m','zaoyan_ai.live_worker','--detector','demo-color'],
         stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    try:
        handshake=json.loads(proc.stdout.readline())
        assert handshake['ready'] is True
        cap=cv2.VideoCapture(str(video));events=[];frame=0
        while True:
            ok,img=cap.read()
            if not ok:break
            if frame%3==0:
                success,encoded=cv2.imencode('.jpg',img)
                assert success
                proc.stdin.write(json.dumps({'image':base64.b64encode(encoded.tobytes()).decode()})+'\n')
                proc.stdin.flush()
                response=json.loads(proc.stdout.readline())
                events+=response['events']
            frame+=1
        cap.release()
        assert len(events)==3,events
    finally:
        proc.stdin.close()
        proc.wait(timeout=8)

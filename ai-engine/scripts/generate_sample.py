"""完全自生成、可重复、无第三方影像版权和隐私风险的彩色餐盒模拟视频。"""
from pathlib import Path
import argparse
import cv2
import numpy as np


def generate(output:Path,seconds=11,fps=18):
    w,h=900,520
    output.parent.mkdir(parents=True,exist_ok=True)
    writer=cv2.VideoWriter(str(output),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
    if not writer.isOpened():raise RuntimeError('OpenCV 的 mp4v 编码器不可用')
    for frame_id in range(seconds*fps):
        t=frame_id/fps
        frame=np.zeros((h,w,3),dtype=np.uint8);frame[:]=(235,238,244)
        cv2.rectangle(frame,(40,55),(860,475),(219,225,230),-1)
        cv2.rectangle(frame,(65,79),(835,450),(246,247,249),-1)
        for x in range(90,830,50):cv2.circle(frame,(x,282),2,(190,198,199),-1)
        cv2.line(frame,(72,281),(828,281),(159,181,161),2,cv2.LINE_AA)
        cv2.putText(frame,'ZAOYAN AI - SYNTHETIC TEST',(74,42),cv2.FONT_HERSHEY_SIMPLEX,.65,(65,86,77),2,cv2.LINE_AA)
        # A、B、C 分时段自上向下越线；D 从下往上反向通过，不应计数。
        objects=[(210,-110+91*t),(515,-270+108*t),(385,-410+92*t),(710,455-43*t)]
        for x,y in objects:
            yy=round(y)
            if yy<-75 or yy>h+45:continue
            x1,y1=x-44,yy-31;x2,y2=x+44,yy+31
            cv2.rectangle(frame,(x1,y1),(x2,y2),(160,170,42),-1)  # HSV 青绿色，供 OpenCV 分割
            cv2.rectangle(frame,(x1+8,y1+8),(x2-8,y2-8),(166,195,100),2)
            cv2.line(frame,(x-15,yy),(x+15,yy),(160,170,42),2)
        writer.write(frame)
    writer.release()
    return output

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',default='../frontend/public/samples/demo-trays.mp4')
    a=p.parse_args();print(generate(Path(a.output).resolve()))

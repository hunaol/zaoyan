"""可选训练入口：需事先下载、有许可的餐盘/餐盒标注集，不能自动抓取任意网络图片。"""
import argparse
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',required=True,help='YOLO data.yaml 路径；数据集须确认许可和标注质量')
    p.add_argument('--weights',required=True,help='已有基础权重的本地路径')
    p.add_argument('--epochs',type=int,default=50)
    a=p.parse_args()
    if not Path(a.data).is_file() or not Path(a.weights).is_file():
        p.error('--data 和 --weights 必须指向已经存在的本地文件')
    from ultralytics import YOLO
    YOLO(a.weights).train(data=a.data,epochs=a.epochs,imgsz=640,project='training-runs',name='zaoyan')

if __name__=='__main__':main()

"""上传视频分析任务。stdout 不需要 JSON，结果通过 --result 写入。"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
import sys
import cv2
from .vision import Detector,LineCounter,draw_annotations
from .rules import load_rules,parse_rules


def write_json_atomic(path:Path,payload:dict)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    os.replace(tmp,path)


def analyze(input_path:str,output_path:str,status_path:str,result_path:str,
            detector:str='demo-color',line=(.08,.54,.92,.54),direction='positive',weights=None,rules=None)->dict:
    cap=cv2.VideoCapture(str(input_path))
    if not cap.isOpened():raise RuntimeError('无法读取视频，请检查格式或编解码器')
    fps=cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps<1 or fps>240:fps=24.0
    total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if width<=0 or height<=0:raise RuntimeError('无法识别视频画面尺寸')
    Path(output_path).parent.mkdir(parents=True,exist_ok=True)
    raw_path=str(Path(output_path).with_name(Path(output_path).stem+'-raw.mp4'))
    writer=cv2.VideoWriter(raw_path,cv2.VideoWriter_fourcc(*'mp4v'),fps,(width,height))
    if not writer.isOpened():raise RuntimeError('无法初始化 MP4 编码器')
    events=[];frame_no=0
    try:
        config=parse_rules(rules)
        model=Detector(detector,weights,rules=config)
        counter=LineCounter(line,direction,rules=config)
        while True:
            ok,frame=cap.read()
            if not ok:break
            boxes=model.infer(frame)
            new_events=counter.update(boxes,width,height,frame_no/fps)
            events.extend(new_events)
            writer.write(draw_annotations(frame,boxes,counter,len(events)))
            frame_no+=1
            if frame_no%10==0:
                progress=min(98,round(100*frame_no/total)) if total>0 else 30
                write_json_atomic(Path(status_path),{'progress':progress,'frame':frame_no,'events':len(events)})
        if frame_no==0:raise RuntimeError('视频没有可读取的画面')
    finally:
        cap.release();writer.release()
    # 将 OpenCV mp4v 转码为浏览器更兼容的 H.264/yuv420p。
    # ffmpeg 不存在时保留 mp4v 文件，但前端浏览器可能无法直接播放。
    if shutil.which('ffmpeg'):
        transcode=subprocess.run(['ffmpeg','-y','-loglevel','error','-i',raw_path,'-c:v','libx264',
                         '-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',
                         str(output_path)],capture_output=True,text=True,timeout=120)
        if transcode.returncode!=0:
            raise RuntimeError('浏览器视频转码失败：'+transcode.stderr[-300:])
        Path(raw_path).unlink(missing_ok=True)
    else:
        os.replace(raw_path,output_path)
    result={'status':'completed','detector':detector,'frame_count':frame_no,'fps':round(float(fps),3),
            'duration_seconds':round(frame_no/fps,3),'rules':config,'events':events,'raw_count':len(events),'output_video':str(output_path),
            'note':'demo-color 是模拟色块的真实视觉处理，不是已训练食堂模型' if detector=='demo-color' else '来自真实 YOLO 跟踪模型，准确率需人工标注集验证'}
    write_json_atomic(Path(result_path),result)
    write_json_atomic(Path(status_path),{'progress':100,'frame':frame_no,'events':len(events)})
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True)
    p.add_argument('--result',required=True);p.add_argument('--status',required=True)
    p.add_argument('--detector',choices=['demo-color','yolo'],default='demo-color')
    p.add_argument('--line',default='.08,.54,.92,.54');p.add_argument('--direction',default='positive')
    p.add_argument('--weights',default=None);p.add_argument('--rules',default=None)
    args=p.parse_args()
    try:
        analyze(args.input,args.output,args.status,args.result,args.detector,
                tuple(float(x) for x in args.line.split(',')),args.direction,args.weights,load_rules(args.rules))
    except Exception as e:
        print(f'视频处理失败: {e}',file=sys.stderr);raise

if __name__=='__main__':main()

"""One-to-one event matching for externally annotated clips, not a model-accuracy claim."""
from __future__ import annotations
from collections import defaultdict
import argparse
import json
import math
from pathlib import Path


def evaluate(reference: list[dict], prediction: list[dict], tolerance: float=.5) -> dict:
    if isinstance(tolerance,bool) or not math.isfinite(tolerance) or tolerance<0:
        raise ValueError('tolerance must be finite and nonnegative')
    def grouped(rows):
        result=defaultdict(list)
        for item in rows:
            if not isinstance(item,dict):raise ValueError('events must be objects')
            clip=item.get('clip_id');offset=item.get('offset_seconds')
            if not isinstance(clip,str) or not clip.strip():raise ValueError('every event needs clip_id')
            if isinstance(offset,bool) or not isinstance(offset,(int,float)) or not math.isfinite(offset) or offset<0:
                raise ValueError('offset_seconds must be nonnegative and finite')
            result[clip].append(float(offset))
        return {key:sorted(values) for key,values in result.items()}
    actual,found=grouped(reference),grouped(prediction);tp=fp=fn=0;clips=[]
    for clip in sorted(actual.keys()|found.keys()):
        truth,guess=actual.get(clip,[]),found.get(clip,[]);i=j=matched=0
        # Ordered equal-tolerance intervals: earliest feasible pairing maximizes matched events.
        while i<len(truth) and j<len(guess):
            if guess[j]<truth[i]-tolerance:j+=1
            elif guess[j]>truth[i]+tolerance:i+=1
            else:matched+=1;i+=1;j+=1
        false_positive=len(guess)-matched;false_negative=len(truth)-matched
        tp+=matched;fp+=false_positive;fn+=false_negative
        clips.append({'clip_id':clip,'reference_count':len(truth),'prediction_count':len(guess),
                      'tp':matched,'fp':false_positive,'fn':false_negative,'count_absolute_error':abs(len(truth)-len(guess))})
    return {'tolerance_seconds':tolerance,'tp':tp,'fp':fp,'fn':fn,
            'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,
            'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,
            'mean_count_absolute_error':sum(c['count_absolute_error'] for c in clips)/len(clips) if clips else None,
            'clips':clips,'warning':'Metrics describe supplied annotations only; simulation is not real cafeteria validation.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference');parser.add_argument('--prediction')
    parser.add_argument('--tracks',help='per-frame MOT annotations, JSON array of {"gt": [...], "pred": [...]}')
    parser.add_argument('--iou-threshold',type=float,default=.5,help='IoU threshold for tracking metrics (only used with --tracks)')
    parser.add_argument('--output',required=True);parser.add_argument('--tolerance',type=float,default=.5)
    args=parser.parse_args()
    if args.tracks:
        # 跟踪指标与事件匹配是两套口径：给了 --tracks 就走 MOT 分支，不再要求
        # --reference/--prediction，避免调用方为了量跟踪质量去凑两份无关的标注文件。
        from .tracking_metrics import evaluate_tracking
        payload=json.loads(Path(args.tracks).read_text(encoding='utf-8'))
        frames=payload.get('frames') if isinstance(payload,dict) else payload
        if not isinstance(frames,list):parser.error('--tracks must be a JSON array of frames')
        try:result=evaluate_tracking(frames,args.iou_threshold)
        except ValueError as error:parser.error(str(error))
    else:
        if not args.reference or not args.prediction:
            parser.error('--reference and --prediction are required unless --tracks is given')
        truth=json.loads(Path(args.reference).read_text(encoding='utf-8'))
        guess=json.loads(Path(args.prediction).read_text(encoding='utf-8'))
        if not isinstance(truth,list) or not isinstance(guess,list):parser.error('inputs must be JSON arrays')
        result=evaluate(truth,guess,args.tolerance)
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()

"""真实逐帧检测、简单目标匹配、稳定侧越线计数。

demo-color 是为自建彩色餐盒模拟视频设计的经典视觉算法，不能表示真实食堂的 YOLO 检测精度。
yolo 模式则调用用户提供权重的 Ultralytics YOLO.track(..., tracker='bytetrack.yaml')。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import cv2
import numpy as np
from .rules import parse_rules


@dataclass
class Detection:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    label: str
    reasons: tuple[str, ...] = ()

    def normalized(self, w: int, h: int) -> dict:
        x1,y1,x2,y2=self.bbox
        return {"trackId": self.track_id, "label": self.label, "confidence": round(self.confidence,3),
                "x":round(x1/w,5),"y":round(y1/h,5),"width":round((x2-x1)/w,5),"height":round((y2-y1)/h,5)}


class CentroidTracker:
    def __init__(self, max_distance: float=78.0, max_age: int=14):
        self.max_distance=max_distance
        self.max_age=max_age
        self.next_id=1
        self.frame=0
        self.tracks: dict[int, dict]={}

    def update(self, boxes: list[tuple[int,int,int,int]]) -> list[Detection]:
        self.frame+=1
        for tid in list(self.tracks):
            if self.frame-self.tracks[tid]['seen']>self.max_age:
                del self.tracks[tid]
        # 对所有检测框与近期历史轨迹建立距离候选，按最近原则进行一对一匹配。
        # 这是模拟测试基线的中心点匹配器，复杂真实场景由 YOLO+ByteTrack 负责。
        candidates=[]
        for i,box in enumerate(boxes):
            center=((box[0]+box[2])/2,(box[1]+box[3])/2)
            for tid,track in self.tracks.items():
                distance=float(np.hypot(center[0]-track['center'][0],center[1]-track['center'][1]))
                if distance<=self.max_distance:candidates.append((distance,i,tid))
        matched:dict[int,int]={}
        used_tracks=set()
        for _,i,tid in sorted(candidates):
            if i in matched or tid in used_tracks:continue
            matched[i]=tid;used_tracks.add(tid)
        for i,box in enumerate(boxes):
            if i not in matched:
                matched[i]=self.next_id;self.next_id+=1
            self.tracks[matched[i]]={'center':((box[0]+box[2])/2,(box[1]+box[3])/2),'seen':self.frame}
        for tid in list(self.tracks):
            if self.frame-self.tracks[tid]['seen']>self.max_age:del self.tracks[tid]
        return [Detection(matched[i],box,0.99,'demo-tray') for i,box in enumerate(boxes)]


class Detector:
    def __init__(self, mode:str="demo-color",weights:Optional[str]=None,confidence:float=0.35,rules:dict|None=None):
        self.rules=parse_rules(rules)
        self.mode=mode
        self.tracker=CentroidTracker()
        self.model=None
        self.confidence=self.rules["confidence"] if rules is not None else confidence
        if mode=="yolo":
            if not weights:raise ValueError("YOLO 模式需要本地权重文件 --weights")
            try:
                from ultralytics import YOLO
            except ImportError as exc:
                raise RuntimeError("未安装 Ultralytics，请执行 pip install -r requirements-yolo.txt") from exc
            from pathlib import Path
            if not Path(weights).is_file():
                raise ValueError("本地模型文件不存在；不会自动联网下载")
            self.model=YOLO(weights)
            names=self.model.names.values() if isinstance(self.model.names,dict) else self.model.names
            if not set(str(n).lower() for n in names) & set(self.rules["targetLabels"]):
                raise ValueError("模型类别与档口计数类别不匹配，请核对模型类别映射")
        elif mode!="demo-color":raise ValueError(f"不支持检测模式: {mode}")

    def infer(self,frame:np.ndarray)->list[Detection]:
        # Crop BEFORE inference; all returned boxes remain in full-frame normalized coordinates.
        h,w=frame.shape[:2];r=self.rules
        x1,y1=int(r["roiX1"]*w),int(r["roiY1"]*h)
        x2,y2=min(w,int(np.ceil(r["roiX2"]*w))),min(h,int(np.ceil(r["roiY2"]*h)))
        cropped=frame[y1:y2,x1:x2]
        if cropped.size==0:raise ValueError("识别区域为空")
        result=self._infer_crop(cropped)
        boxes=[Detection(d.track_id,(d.bbox[0]+x1,d.bbox[1]+y1,d.bbox[2]+x1,d.bbox[3]+y1),
                         d.confidence,d.label,d.reasons) for d in result]
        return select_targets(boxes,r)

    def _infer_crop(self,frame:np.ndarray)->list[Detection]:
        if self.mode=="demo-color":
            hsv=cv2.cvtColor(frame,cv2.COLOR_BGR2HSV)
            mask=cv2.inRange(hsv,np.array([75,80,55]),np.array([105,255,255]))
            kernel=np.ones((7,7),dtype=np.uint8)
            mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,kernel)
            contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            boxes=[]
            for c in contours:
                if cv2.contourArea(c)<750:continue
                x,y,w,h=cv2.boundingRect(c)
                if w<24 or h<20:continue
                boxes.append((x,y,x+w,y+h))
            return self.tracker.update(sorted(boxes))
        # persist=True 允许连续帧复用 YOLO/ByteTrack 内部跟踪状态。
        result=self.model.track(frame,persist=True,tracker="bytetrack.yaml",conf=self.confidence,verbose=False)[0]
        result_boxes=[]
        if result.boxes is None:return result_boxes
        for b in result.boxes:
            if b.id is None:continue  # 没有稳定 track ID 时不计数。
            idx=int(b.cls.item());name=str(self.model.names[idx]);name_lower=name.lower()
            # COCO 模型只天然覆盖 bowl 等少量餐饮类别，真实餐盒必须使用自训权重。
            eligible=(name_lower in set(self.rules["targetLabels"]+self.rules["emptyLabels"]))
            if not eligible:continue
            x1,y1,x2,y2=(int(v) for v in b.xyxy[0].tolist())
            result_boxes.append(Detection(int(b.id.item()),(x1,y1,x2,y2),float(b.conf.item()),name))
        return result_boxes


def select_targets(boxes:list[Detection],rules:dict)->list[Detection]:
    """Explicit empty classes are ignored. Geometric ambiguity is retained for human review.

    OUTER selects the tray over boxes nested inside it; INNER selects individual boxes.
    This is not a claim that an arbitrary image's contents can be identified as full/empty.
    """
    boxes=[d for d in boxes if d.label.lower() not in rules["emptyLabels"]]
    suppressed=set();flags={d.track_id:set(d.reasons) for d in boxes}
    def area(b):return max(0,b[2]-b[0])*max(0,b[3]-b[1])
    for i,a in enumerate(boxes):
        for b in boxes[i+1:]:
            ba,bb=a.bbox,b.bbox
            overlap=max(0,min(ba[2],bb[2])-max(ba[0],bb[0]))*max(0,min(ba[3],bb[3])-max(ba[1],bb[1]))
            aa,ab=area(ba),area(bb)
            if min(aa,ab)<=0:continue
            if overlap/min(aa,ab)>=.9:
                # deterministic tie-break prevents both equal boxes from disappearing
                outer,inner=(a,b) if (aa,a.track_id)>=(ab,b.track_id) else (b,a)
                keep,drop=(outer,inner) if rules["nestingPolicy"]=="OUTER" else (inner,outer)
                suppressed.add(drop.track_id);flags[keep.track_id].add("NESTED_TARGET")
            elif overlap/min(aa,ab)>=.25:
                flags[a.track_id].add("OVERLAP");flags[b.track_id].add("OVERLAP")
    return [Detection(d.track_id,d.bbox,d.confidence,d.label,tuple(sorted(flags[d.track_id])))
            for d in boxes if d.track_id not in suppressed]


class LineCounter:
    def __init__(self,points=(0.08,0.54,0.92,0.54),direction="positive",deadzone=0.012,rules:dict|None=None):
        if direction not in ("positive","negative"):raise ValueError("方向仅允许 positive/negative")
        self.rules=parse_rules(rules)
        # Preserve the low-level API used by existing callers; product entrypoints pass full rules.
        if rules is None:self.rules["stableFrames"]=1;self.rules["deadzone"]=deadzone
        self.points=tuple(float(x) for x in points)
        if len(self.points)!=4:raise ValueError("计数线必须包含四个归一化坐标")
        x1,y1,x2,y2=self.points
        if any(not np.isfinite(v) or not 0<=v<=1 for v in self.points):raise ValueError("无效计数线")
        if (x2-x1)**2+(y2-y1)**2<.01:raise ValueError("计数线长度太短")
        r=self.rules
        if not (r["roiX1"]<=x1<=r["roiX2"] and r["roiX1"]<=x2<=r["roiX2"] and
                r["roiY1"]<=y1<=r["roiY2"] and r["roiY1"]<=y2<=r["roiY2"]):raise ValueError("计数线必须位于识别区域内")
        self.direction=direction;self.deadzone=r["deadzone"]
        self.states:dict[int,dict]={};self.counted:set[int]=set();self.recent:list[dict]=[]
        self.total=0;self.tick=0;self.last_time=-1.

    def update(self,detections:list[Detection],width:int,height:int,offset_seconds:float)->list[dict]:
        if width<=0 or height<=0 or not np.isfinite(offset_seconds) or offset_seconds<self.last_time:
            raise ValueError("画面尺寸或时间戳无效")
        self.last_time=offset_seconds;self.tick+=1
        emitted=[];r=self.rules;x1,y1,x2,y2=self.points
        vx=x2-x1;vy=y2-y1;length=float(np.hypot(vx,vy));expected=1 if self.direction=="positive" else -1
        self.recent=[e for e in self.recent if offset_seconds-e["time"]<=r["duplicateWindowSeconds"]]
        # bounded memory. ByteTrack IDs are monotonic for one worker; count-once markers expire
        # only after a long gap. A newly seen object must establish the source side again.
        for tid,state in list(self.states.items()):
            if offset_seconds-state["seen"]>max(30.,r["maxGapSeconds"]*4):
                del self.states[tid];self.counted.discard(tid)
        for d in detections:
            a,b,c,e=d.bbox;cx=(a+c)/2/width;cy=(b+e)/2/height
            if not(r["roiX1"]<=cx<=r["roiX2"] and r["roiY1"]<=cy<=r["roiY2"]):continue
            old=self.states.get(d.track_id)
            if old is None:
                old={"seen":offset_seconds,"tick":self.tick-1,"stable":None,"candidate":0,"runs":0,
                     "point":None,"flags":set(),"min_conf":d.confidence,"gap":False}
                self.states[d.track_id]=old
            gap=offset_seconds-old["seen"]>r["maxGapSeconds"]
            consecutive=old["tick"]==self.tick-1 and not gap
            if gap:
                old.update(stable=None,candidate=0,runs=0,point=None,gap=True)
                old["flags"].add("TRACK_GAP")
            old.update(seen=offset_seconds,tick=self.tick)
            old["flags"].update(d.reasons);old["min_conf"]=min(old["min_conf"],d.confidence)
            signed=(vx*(cy-y1)-vy*(cx-x1))/length
            if abs(signed)<self.deadzone:
                old["runs"]=0;continue
            side=1 if signed>0 else -1
            old["runs"]=old["runs"]+1 if consecutive and old["candidate"]==side else 1
            old["candidate"]=side
            if old["runs"]<r["stableFrames"]:continue
            previous=old["point"];last=old["stable"]
            old["stable"]=side;old["point"]=(cx,cy)
            if last is None or last==side or d.track_id in self.counted:continue
            if side!=expected:
                old["flags"].add("RETURN_MOVEMENT");continue
            px,py=previous
            prev=(vx*(py-y1)-vy*(px-x1))/length
            fraction=prev/(prev-signed)
            cross=(px+fraction*(cx-px),py+fraction*(cy-py))
            projection=((cross[0]-x1)*vx+(cross[1]-y1)*vy)/(length*length)
            if not 0<=projection<=1:continue
            flags=set(old["flags"]);flags.add("CONTENT_UNVERIFIED")
            if old["min_conf"]<r["reviewConfidence"]:flags.add("LOW_CONFIDENCE")
            if any(np.hypot(cross[0]-p["point"][0],cross[1]-p["point"][1])<=r["duplicateDistance"] for p in self.recent):
                # Two real servings may legitimately cross close together: warn, do not silently delete.
                flags.add("POSSIBLE_DUPLICATE")
            self.recent.append({"time":offset_seconds,"point":cross});self.counted.add(d.track_id);self.total+=1
            emitted.append({"track_id":d.track_id,"offset_seconds":round(float(offset_seconds),3),
                "confidence":round(float(d.confidence),3),"direction":self.direction,
                "target_label":d.label,"risk_reasons":sorted(flags),"unit":"CONTAINER_EVENT"})
        return emitted


def draw_annotations(frame:np.ndarray,detections:list[Detection],line:LineCounter,count:int)->np.ndarray:
    out=frame.copy();h,w=out.shape[:2]
    r=line.rules;ax,ay,bx,by=(round(r[k]*v) for k,v in [("roiX1",w),("roiY1",h),("roiX2",w),("roiY2",h)])
    # Annotated export masks irrelevant regions; original upload remains a private review source.
    out[:ay,:]=0;out[by:,:]=0;out[:,:ax]=0;out[:,bx:]=0
    cv2.rectangle(out,(ax,ay),(bx,by),(190,150,80),1)
    x1,y1,x2,y2=line.points
    p1=(round(x1*w),round(y1*h));p2=(round(x2*w),round(y2*h))
    cv2.line(out,p1,p2,(93,211,139),3,cv2.LINE_AA)
    for d in detections:
        a,b,c,e=d.bbox
        cv2.rectangle(out,(a,b),(c,e),(91,184,90),2)
        text=f"ID {d.track_id} | {d.label}"
        cv2.putText(out,text,(max(0,a),max(18,b-6)),cv2.FONT_HERSHEY_SIMPLEX,0.51,(22,110,44),2,cv2.LINE_AA)
    cv2.rectangle(out,(12,12),(210,58),(25,57,50),-1)
    cv2.putText(out,f"Crossings: {count}",(23,43),cv2.FONT_HERSHEY_SIMPLEX,0.77,(255,255,255),2,cv2.LINE_AA)
    return out

import {useEffect,useRef,useState,type PointerEvent} from 'react'
import {Crosshair} from 'lucide-react'
import {type Stall} from '../lib/api'
import {SecondaryButton} from './Layout'

export default function CalibrationEditor({stall,onChange,disabled}:{stall:Stall;onChange:(s:Stall)=>void;disabled:boolean}){
 const [mode,setMode]=useState<'roi'|'line'>('roi'),[background,setBackground]=useState(''),[videoUrl,setVideoUrl]=useState(''),[aspect,setAspect]=useState(16/9)
 const area=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),start=useRef<[number,number]|null>(null)
 const r=stall.rules
 useEffect(()=>()=>{if(videoUrl)URL.revokeObjectURL(videoUrl)},[videoUrl])
 const frame=()=>{const v=video.current;if(!v?.videoWidth)return;v.pause();const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d')?.drawImage(v,0,0);setBackground(c.toDataURL('image/jpeg',.8));setAspect(v.videoWidth/v.videoHeight)}
 const point=(e:PointerEvent<HTMLDivElement>):[number,number]=>{const b=area.current!.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))]}
 const move=(e:PointerEvent<HTMLDivElement>)=>{if(disabled||!start.current)return;const [x1,y1]=start.current,[x2,y2]=point(e)
  if(mode==='line')onChange({...stall,lineX1:x1,lineY1:y1,lineX2:x2,lineY2:y2})
  else onChange({...stall,rules:{...r,roiX1:Math.min(x1,x2),roiY1:Math.min(y1,y2),roiX2:Math.max(x1,x2),roiY2:Math.max(y1,y2)}})
 }
 return <div><div className="business-toolbar"><label className="btn btn-secondary">选一张画面或视频做标定<input className="sr-only" type="file" accept="image/*,video/*" onChange={e=>{const f=e.target.files?.[0];if(!f)return
  if(f.type.startsWith('video/')){setVideoUrl(URL.createObjectURL(f))}else{setVideoUrl('');const reader=new FileReader();reader.onload=()=>{const src=String(reader.result);const image=new Image();image.onload=()=>setAspect(image.width/image.height);image.src=src;setBackground(src)};reader.readAsDataURL(f)}
 }}/></label><span className="helper-note">只在浏览器本地预览，不上传该参考画面。</span></div>
 {videoUrl&&<div><video ref={video} className="calibration-source" src={videoUrl} controls playsInline onLoadedData={frame}/><SecondaryButton onClick={frame}>使用当前帧作为标定背景</SecondaryButton></div>}
 <div className="segmented-tabs"><button type="button" className={mode==='roi'?'active':''} onClick={()=>setMode('roi')}>拖动框选识别区域</button><button type="button" className={mode==='line'?'active':''} onClick={()=>setMode('line')}>拖动绘制计数线</button></div>
 <div ref={area} className="calibration-canvas" style={{aspectRatio:aspect,backgroundImage:background?`url(${background})`:undefined}}
  onPointerDown={e=>{if(disabled)return;e.preventDefault();start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId)}}
  onPointerMove={move} onPointerUp={e=>{move(e);start.current=null}} onPointerCancel={()=>{start.current=null}}>
 <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="识别区域与计数线">
 <defs><mask id="roi-mask"><rect width="1000" height="1000" fill="white"/><rect x={r.roiX1*1000} y={r.roiY1*1000} width={(r.roiX2-r.roiX1)*1000} height={(r.roiY2-r.roiY1)*1000} fill="black"/></mask></defs>
 <rect width="1000" height="1000" fill="#102a25" opacity=".6" mask="url(#roi-mask)"/>
 <rect x={r.roiX1*1000} y={r.roiY1*1000} width={(r.roiX2-r.roiX1)*1000} height={(r.roiY2-r.roiY1)*1000} stroke="#fbad74" strokeWidth="4" fill="none"/>
 <line x1={stall.lineX1*1000} y1={stall.lineY1*1000} x2={stall.lineX2*1000} y2={stall.lineY2*1000} stroke="#68efad" strokeWidth="6"/>
 <circle cx={stall.lineX1*1000} cy={stall.lineY1*1000} r="10" fill="white"/><circle cx={stall.lineX2*1000} cy={stall.lineY2*1000} r="10" fill="#fbad74"/>
 </svg><span className="line-preview-badge"><Crosshair size={13}/> {mode==='roi'?'区域标定':'计数线标定'}</span></div>
 <p className="helper-note">橙色矩形是实际推理区域；绿色计数线须在区域内。区域外不会送入检测模型。画面改变或相机移动后需要重新标定。</p>
 <div className="form-grid">{(['roiX1','roiY1','roiX2','roiY2'] as const).map(k=><div className="field" key={k}><label>区域 {k.slice(3)}</label><input aria-label={k} type="number" min="0" max="1" step=".01" value={Number(r[k].toFixed(3))} disabled={disabled} onChange={e=>onChange({...stall,rules:{...r,[k]:Number(e.target.value)}})}/></div>)}
 {(['lineX1','lineY1','lineX2','lineY2'] as const).map(k=><div className="field" key={k}><label>线段 {k.slice(4)}</label><input aria-label={k} type="number" min="0" max="1" step=".01" value={Number(stall[k].toFixed(3))} disabled={disabled} onChange={e=>onChange({...stall,[k]:Number(e.target.value)})}/></div>)}</div>
 </div>
}

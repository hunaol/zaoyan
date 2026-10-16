import {useEffect,useRef,useState} from 'react'
import {api,timeText,type Origin,type VideoTask} from '../lib/api'
import {useAsyncData,useWorkspace} from '../lib/context'
import {LoadingBlock,SecondaryButton,SectionTitle,StatusTag} from './Layout'
import Pagination from './Pagination'

export default function TaskHistoryPanel({origin,onSelect,refreshKey=0}:{origin:Origin;onSelect:(t:VideoTask)=>void;refreshKey?:number}){
 const {notify}=useWorkspace();const [page,setPage]=useState(0),[q,setQ]=useState(''),[mode,setMode]=useState(''),[status,setStatus]=useState(''),[date,setDate]=useState(''),[busy,setBusy]=useState(false)
 const key=useRef(origin);key.current=origin
 const {data,loading,error,refresh}=useAsyncData(()=>api.taskSearch(origin,{page,q,mode,status,date}),[origin,page,q,mode,status,date,refreshKey])
 useEffect(()=>{setPage(0)},[origin,q,mode,status,date])
 useEffect(()=>{if(data&&!loading&&page>0&&page>=data.pages)setPage(Math.max(0,data.pages-1))},[data?.pages,page,loading])
 const reanalyze=async(t:VideoTask)=>{
  if(!window.confirm('以当前档口规则建立一个新的分析版本。旧版本与复核记录保留；新版本完成后不会自动替换已启用版本。继续吗？'))return
  const submitted=origin;setBusy(true)
  try{const next=await api.reanalyze(t.id);if(key.current!==submitted)return;onSelect(next);await refresh();notify('新版本已创建，完成并复核后可手动启用为统计版本')}
  catch(e){notify((e as Error).message,'error')}finally{setBusy(false)}
 }
 const activate=async(t:VideoTask)=>{
  const note=window.prompt('切换后本录像仅此版本参与统计；原台账将提示重新核实。请填写切换依据（新版本需要独立复核）：');if(!note?.trim())return
  const submitted=origin;setBusy(true)
  try{const next=await api.activateTask(t.id,note.trim().slice(0,300));if(key.current!==submitted)return;onSelect(next);await refresh();notify('已切换统计版本；旧事件及复核历史完整保留')}
  catch(e){notify((e as Error).message,'error')}finally{setBusy(false)}
 }
 return <div className="panel task-history-wide"><SectionTitle label="完整监测任务历史" sub="服务端分页，按录制日期、模式、状态或文件名查找；同一素材只启用一个统计版本" action={<SecondaryButton onClick={()=>void refresh()}>刷新</SecondaryButton>}/>
 <div className="business-toolbar"><input placeholder="文件名 / 任务 ID" aria-label="搜索任务" value={q} onChange={e=>setQ(e.target.value)}/><label>录制日期 <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><select aria-label="任务模式" value={mode} onChange={e=>setMode(e.target.value)}><option value="">全部模式</option><option value="UPLOAD">上传视频</option><option value="LIVE">实时摄像头</option></select><select aria-label="任务状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{['QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'].map(s=><option key={s}>{s}</option>)}</select></div>
 {error&&<div className="inline-alert danger">{error}</div>}{loading?<LoadingBlock height={120}/>:<div className="table-wrap"><table className="data-table"><thead><tr><th>录像 / 会话</th><th>拍摄时间</th><th>分析状态</th><th>统计版本</th><th>操作</th></tr></thead><tbody>{data?.items.map(t=><tr key={t.id}><td><strong>{t.originalFilename}</strong><small className="block-text">{t.id.slice(0,12)}… · {t.mode} · {t.detector}</small></td><td>{timeText(t.recordedAt)}<small className="block-text">时长 {t.durationSeconds?.toFixed(1)??'未知'} 秒</small></td><td><StatusTag status={t.status}/></td><td>{t.statsIncluded?'参与统计':t.activeTaskId?'其他版本已启用':'未完成 / 未启用'}{t.assetId&&<small className="block-text">素材 {t.assetId.slice(0,10)}…</small>}</td><td><div className="row-actions"><button className="table-action" onClick={()=>onSelect(t)}>查看</button>{t.mode==='UPLOAD'&&t.hasSourceVideo&&<button className="table-action" disabled={busy} onClick={()=>void reanalyze(t)}>新建分析版本</button>}{t.mode==='UPLOAD'&&t.assetId&&t.status==='COMPLETED'&&!t.statsIncluded&&<button className="table-action" disabled={busy} onClick={()=>void activate(t)}>启用此统计版本</button>}</div></td></tr>)}</tbody></table>{!data?.total&&<p className="history-note">没有符合条件的任务。</p>}</div>}
 <Pagination page={page} pages={data?.pages||0} total={data?.total||0} loading={loading} onChange={setPage}/>
 <p className="history-note">精确查重基于文件内容 SHA-256、档口和数据域。重新编码或重叠录制的两个不同文件，仍须在结算时核实，系统不冒充能识别所有重复场景。</p></div>
}

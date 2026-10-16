import {useEffect,useRef,useState} from 'react'
import {Check,ClipboardCheck,Plus,RefreshCw,X,Play} from 'lucide-react'
import {Link,useSearchParams} from 'react-router-dom'
import {api,authorizedBlob,timeText,toBeijingInstant,riskText,reviewReasons,type CountEvent,type ReviewStatus,type VideoTask} from '../lib/api'
import {useAsyncData,useWorkspace} from '../lib/context'
import {EmptyState,LoadingBlock,PageTitle,PrimaryButton,SecondaryButton,SectionTitle,StatusTag} from '../components/Layout'
import Pagination from '../components/Pagination'
import AuditPanel,{BusinessAuditPanel} from '../components/AuditPanel'
import VideoReviewDialog from '../components/VideoReviewDialog'

function EventDetails({event,onClose,onSaved,onVideo}:{event:CountEvent;onClose:()=>void;onSaved:()=>void;onVideo:(t:VideoTask)=>void}){
 const {origin,notify}=useWorkspace(),player=useRef<HTMLVideoElement>(null),alive=useRef(true)
 const [note,setNote]=useState(event.note||''),[reason,setReason]=useState(event.reviewReason||'NORMAL'),[status,setStatus]=useState(event.reviewStatus),[busy,setBusy]=useState(false)
 const [url,setUrl]=useState<string|null>(null),[task,setTask]=useState<VideoTask|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[auditKey,setAuditKey]=useState(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{let active=true,objectUrl:string|null=null;setLoading(true)
  void(async()=>{try{if(!event.taskId)return;const t=await api.task(event.taskId);if(!active)return;setTask(t)
   if(t.hasResultVideo||t.hasSourceVideo){const blob=await authorizedBlob(`/tasks/${t.id}/video?source=${!t.hasResultVideo}`);if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}}
  }catch(e){if(active)setError((e as Error).message)}finally{if(active)setLoading(false)}})()
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}
 },[event.id])
 const review=async(next:ReviewStatus)=>{if(!note.trim()){setError('请说明复核依据，尤其是空容器、往返和嵌套目标。');return}setBusy(true);setError('')
  try{await api.review(event.id,next,`[${reviewReasons[reason]||reason}] ${note}`.slice(0,300),reason);if(!alive.current)return;setStatus(next);setAuditKey(v=>v+1);notify('复核结果与依据已保存；来源台账将提示重新核实');onSaved()}
  catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
 }
 return <div className="modal-backdrop"><div className="modal evidence-modal" role="dialog" aria-modal="true" aria-labelledby="event-title"><div className="modal-top"><h2 id="event-title">事件 #{event.id} · 证据与复核</h2><button className="icon-button" aria-label="关闭详情" disabled={busy} onClick={onClose}><X/></button></div>
 <div className="evidence-meta"><StatusTag status={status}/><span>{timeText(event.occurredAt)}</span><span>{event.statsIncluded?'当前有效统计版本':'该分析版本不参与统计'}</span></div>
 {riskText(event.riskReasons)&&<div className="inline-alert warn">{riskText(event.riskReasons)}。这些是待核查提示，不是已证实的错误。</div>}
 {loading?<LoadingBlock height={100}/>:url?<video ref={player} className="evidence-video" src={url} controls playsInline onLoadedMetadata={()=>{if(player.current)player.current.currentTime=Math.max(0,(event.offsetSeconds||0)-1)}}/>:<p className="info-strip">{task?.mode==='LIVE'?'实时监测按隐私策略未保存原始帧，仅保留事件和规则快照。':'无可回放录像，请结合补录或业务记录核实。'}</p>}
 {task?.mode==='UPLOAD'&&task.status==='COMPLETED'&&<SecondaryButton onClick={()=>onVideo(task)}>逐段查看此录像 / 在播放位置补录</SecondaryButton>}
 <div className="field"><label>复核分类</label><select value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(reviewReasons).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></div>
 <div className="field"><label>本次复核说明（必填）</label><textarea maxLength={240} value={note} onChange={e=>setNote(e.target.value)}/></div>
 {error&&<div className="inline-alert danger">{error}</div>}<div className="record-actions"><PrimaryButton loading={busy} onClick={()=>void review('CONFIRMED')}>确认有效</PrimaryButton><SecondaryButton disabled={busy} onClick={()=>void review('REJECTED')}>剔除误计</SecondaryButton><SecondaryButton disabled={busy} onClick={()=>void review('PENDING')}>退回待复核</SecondaryButton></div>
 <h3>这条事件的完整复核历史</h3><AuditPanel key={auditKey} origin={origin} eventId={event.id}/>
 </div></div>
}

export default function EventsPage(){
 const {origin,notify}=useWorkspace(),[params,setParams]=useSearchParams(),scope=useRef(origin);scope.current=origin
 const taskId=params.get('taskId')||params.get('task')||''
 const initial=params.get('status');const [filter,setFilter]=useState<'ALL'|ReviewStatus>(initial&&['PENDING','CONFIRMED','REJECTED'].includes(initial)?initial as ReviewStatus:'ALL')
 const [date,setDate]=useState(params.get('date')||''),[page,setPage]=useState(0),[search,setSearch]=useState(''),[query,setQuery]=useState('')
 const [selected,setSelected]=useState<number[]>([]),[tab,setTab]=useState<'events'|'audit'|'business'>('events'),[saving,setSaving]=useState(false)
 const [evidence,setEvidence]=useState<CountEvent|null>(null),[videoTask,setVideoTask]=useState<VideoTask|null>(null)
 const [adding,setAdding]=useState(false),[note,setNote]=useState(''),[time,setTime]=useState(''),manualSubmission=useRef<{key:string;occurredAt:string;note:string}|null>(null)
 const {data,loading,error,refresh}=useAsyncData(()=>api.searchEvents(origin,{status:filter==='ALL'?undefined:filter,date,q:query,page,taskId}),[origin,filter,date,query,page,taskId])
 const {data:stalls}=useAsyncData(api.stalls,[])
 const {data:filteredTask,error:taskError}=useAsyncData(()=>taskId?api.task(taskId):Promise.resolve(null),[origin,taskId])
 useEffect(()=>{setEvidence(null);setVideoTask(null);setAdding(false);setSelected([]);setPage(0);setTab('events')},[origin,taskId])
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(0)},300);return()=>clearTimeout(timer)},[search])
 useEffect(()=>{setPage(0);setSelected([])},[filter,date,query])
 useEffect(()=>{setSelected([])},[page])
 useEffect(()=>{if(data&&!loading&&page>0&&page>=data.pages)setPage(Math.max(0,data.pages-1))},[data?.pages,page,loading])
 const rows=data?.items||[]
 const batch=async(status:ReviewStatus)=>{if(!selected.length||saving)return
  const reason=window.prompt(`为 ${selected.length} 条事件填写${status==='CONFIRMED'?'确认':'剔除'}依据。请勿未查看证据就批量确认。`);if(!reason?.trim())return
  const submitted=origin;setSaving(true)
  try{const result=await api.batchReview(origin,selected,status,reason.trim().slice(0,300));if(scope.current!==submitted)return;setSelected([]);notify(`已保存 ${result.changed} 条复核修改`);await refresh()}
  catch(e){notify((e as Error).message,'error')}finally{setSaving(false)}
 }
 const add=()=>{if(filteredTask?.origin===origin&&filteredTask.mode==='UPLOAD'&&filteredTask.status==='COMPLETED'){setVideoTask(filteredTask);return}setAdding(true);manualSubmission.current=null}
 const manual=async()=>{if(!stalls?.[0]||!note.trim()||saving)return;const submitted=origin;setSaving(true)
  if(!manualSubmission.current)manualSubmission.current={key:globalThis.crypto.randomUUID(),occurredAt:time?toBeijingInstant(time):new Date().toISOString(),note:note.trim()}
  try{await api.manual({stallId:stalls[0].id,origin,occurredAt:manualSubmission.current.occurredAt,note:manualSubmission.current.note,requestKey:manualSubmission.current.key});if(scope.current!==submitted)return;setAdding(false);setNote('');setTime('');manualSubmission.current=null;notify('已补录一次人工核实交付');await refresh()}
  catch(e){notify((e as Error).message,'error')}finally{setSaving(false)}
 }
 return <div className="page-enter"><PageTitle eyebrow="REVIEW CENTER / 事件中心" title="事件与人工复核" description="确认每一次独立交付，保留原始判断、人工依据和分析版本。" actions={<><SecondaryButton onClick={()=>void refresh()}><RefreshCw size={16}/> 刷新</SecondaryButton><PrimaryButton onClick={add} disabled={!stalls?.length}><Plus size={17}/> 人工补录</PrimaryButton></>}/>
 <div className="info-strip">统计口径是“容器交付次数”，并非自动确认的餐食份数。非统计版本保留可查，但不进入日报或结算；待复核记录不进入核实台账。</div>
 <div className="panel"><SectionTitle label="事件、复核与业务留痕"/><div className="segmented-tabs">{([['events','事件台账'],['audit','完整复核审计'],['business','结算与版本审计']] as const).map(([v,n])=><button key={v} className={tab===v?'active':''} onClick={()=>setTab(v)}>{n}</button>)}</div>
 {tab==='audit'?<AuditPanel key={origin} origin={origin}/>:tab==='business'?<BusinessAuditPanel key={origin} origin={origin}/>:<>
 <div className="filter-row"><div className="segmented-tabs">{(['ALL','PENDING','CONFIRMED','REJECTED'] as const).map(s=><button key={s} className={filter===s?'active':''} onClick={()=>setFilter(s)}>{({ALL:'全部',PENDING:'待复核',CONFIRMED:'已确认',REJECTED:'已剔除'} as const)[s]}</button>)}</div><input value={search} placeholder="事件号 / 跟踪 ID / 任务 / 备注" aria-label="搜索事件" onChange={e=>setSearch(e.target.value)}/></div>
 <div className="business-toolbar"><label>营业日期 <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{date&&<button className="text-link" onClick={()=>setDate('')}>全部日期</button>}{taskId&&<><span>任务 {taskId.slice(0,12)}…</span><button className="text-link" onClick={()=>setParams({})}>清除任务筛选</button></>}
 {filteredTask?.origin===origin&&filteredTask.mode==='UPLOAD'&&(filteredTask.hasSourceVideo||filteredTask.hasResultVideo)&&<SecondaryButton onClick={()=>setVideoTask(filteredTask)}><Play size={15}/> 查看整段录像 / 定位补录</SecondaryButton>}</div>
 {taskError&&<p className="error-inline">{taskError}</p>}{filteredTask&&filteredTask.origin!==origin&&<div className="inline-alert warn">该任务不属于当前工作区，请切换数据域或清除任务筛选。</div>}
 {selected.length>0&&<div className="batch-bar"><strong>已选 {selected.length} 条</strong><SecondaryButton disabled={saving} onClick={()=>void batch('CONFIRMED')}>批量确认</SecondaryButton><SecondaryButton disabled={saving} onClick={()=>void batch('REJECTED')}>批量剔除</SecondaryButton><button className="text-link" onClick={()=>setSelected([])}>取消选择</button></div>}
 {loading?<LoadingBlock/>:error?<div className="inline-alert danger">{error}</div>:rows.length?<div className="table-wrap"><table className="data-table"><thead><tr><th><input aria-label="选择本页全部" type="checkbox" checked={rows.every(e=>selected.includes(e.id))} onChange={e=>setSelected(e.target.checked?rows.map(x=>x.id):[])}/></th><th>来源 / 事件</th><th>时间</th><th>目标 / 视频位置</th><th>状态与统计口径</th><th>核查提示</th><th>操作</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td><input aria-label={`选择事件 ${e.id}`} type="checkbox" checked={selected.includes(e.id)} onChange={x=>setSelected(old=>x.target.checked?[...old,e.id]:old.filter(v=>v!==e.id))}/></td><td>#{e.id} · {e.source==='AUTO'?'视觉':'人工'}</td><td>{timeText(e.occurredAt)}</td><td>{e.targetLabel||e.trackId||'人工'}<small>{e.offsetSeconds!=null?` · ${e.offsetSeconds.toFixed(2)} 秒`:''}</small></td><td><StatusTag status={e.reviewStatus}/>{!e.statsIncluded&&<small className="error-inline">旧版 / 未启用，不参与统计</small>}</td><td className="risk-cell">{riskText(e.riskReasons)||'—'}</td><td><button className="table-action" onClick={()=>setEvidence(e)}>证据与复核</button></td></tr>)}</tbody></table></div>:<EmptyState title="没有符合条件的事件" description={taskId?'没有自动事件也可以通过“查看整段录像”检查漏计。':'调整筛选，或先分析视频。'} icon={ClipboardCheck}/>}
 <Pagination page={page} pages={data?.pages||0} total={data?.total||0} loading={loading} onChange={setPage}/>
 </>}
 </div>
 {adding&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div className="modal-top"><h2 id="manual-title">人工补录一次交付</h2><button className="icon-button" aria-label="关闭补录" disabled={saving} onClick={()=>setAdding(false)}><X/></button></div><p>没有录像定位的线下补录。视频漏计请先打开对应录像，在播放位置补录。</p><div className="field"><label>发生时间（北京时间，留空为当前时间）</label><input type="datetime-local" disabled={saving||!!manualSubmission.current} value={time} onChange={e=>{setTime(e.target.value);manualSubmission.current=null}}/></div><div className="field"><label>核实依据（必填）</label><textarea disabled={saving||!!manualSubmission.current} value={note} maxLength={300} onChange={e=>{setNote(e.target.value);manualSubmission.current=null}}/></div><PrimaryButton loading={saving} disabled={!note.trim()} onClick={()=>void manual()}>{manualSubmission.current?'重试确认同一次补录':'保存核实事件'}</PrimaryButton></div></div>}
 {evidence&&<EventDetails key={`${origin}:${evidence.id}`} event={evidence} onClose={()=>setEvidence(null)} onSaved={()=>void refresh()} onVideo={t=>{setEvidence(null);setVideoTask(t)}}/>}
 {videoTask&&<VideoReviewDialog key={`${origin}:${videoTask.id}`} task={videoTask} onClose={()=>setVideoTask(null)} onSaved={()=>void refresh()}/>}
 </div>
}

import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {api,timeText,slotName,type Origin,type MealSlot,type Prep,type Settlement,type Coverage} from '../lib/api'
import {useWorkspace} from '../lib/context'
import {PrimaryButton,SecondaryButton,SectionTitle} from './Layout'

export default function SettlementPanel({stallId,origin,date,slot,existing,onApplied}:{stallId:number;origin:Origin;date:string;slot:MealSlot;existing?:Prep;onApplied:(p:Prep)=>void}){
 const {notify}=useWorkspace();const [ratio,setRatio]=useState(1),[draft,setDraft]=useState<Settlement|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [coverage,setCoverage]=useState(false),[units,setUnits]=useState(false),[zero,setZero]=useState(false),[overwrite,setOverwrite]=useState(false),[note,setNote]=useState('')
 const key=`zaoyan-settlement:${origin}:${stallId}:${date}:${slot}`,keyRef=useRef(key);keyRef.current=key
 useEffect(()=>{let active=true;setDraft(null);setError('');setCoverage(false);setUnits(false);setZero(false);setOverwrite(false);setNote('');setRatio(1)
  const id=sessionStorage.getItem(key);if(id)void api.getSettlement(id).then(d=>{if(active&&d.origin===origin){setDraft(d);setRatio(d.portionsPerEvent)}}).catch(()=>{sessionStorage.removeItem(key)})
  return()=>{active=false}
 },[key])
 const create=async()=>{const scope=key;setBusy(true);setError('')
  try{const d=await api.settlement({stallId,origin,serviceDate:date,mealSlot:slot,portionsPerEvent:ratio});if(keyRef.current!==scope)return;setDraft(d);sessionStorage.setItem(key,d.id);setCoverage(false);setUnits(false);setZero(false);setOverwrite(false)}
  catch(e){if(keyRef.current===scope)setError((e as Error).message)}finally{setBusy(false)}
 }
 const confirm=async()=>{if(!draft)return;const scope=key;setBusy(true);setError('')
  try{const p=await api.confirmSettlement(draft.id,{coverageConfirmed:coverage,unitsConfirmed:units,zeroConfirmed:zero,overwrite,note:note.trim()});if(keyRef.current!==scope)return
   setDraft({...draft,confirmedAt:new Date().toISOString(),confirmationNote:note});onApplied(p);notify('复核汇总已确认进入台账；计划量和实际备餐量未改动')
  }catch(e){if(keyRef.current===scope)setError((e as Error).message)}finally{setBusy(false)}
 }
 let recordings:Coverage[]=[];try{recordings=JSON.parse(draft?.coverageJson||'[]') as Coverage[]}catch{}
 const done=!!draft?.confirmedAt
 return <div className="panel settlement-panel"><SectionTitle label="从事件复核生成备餐台账" sub={`${date} · ${slotName[slot]} · 先生成草稿，再确认覆盖范围和换算口径`}/>
 {existing?.verificationStale&&<div className="inline-alert warn">这条台账的源事件、统计版本或餐次发生过变化。原核实量 {existing.actualQty} 份保留，但已暂停用于新预测；请重新结算或在台账中明确人工重新核实。</div>}
 <div className="business-toolbar"><label>每次容器交付对应 <input type="number" disabled={busy} min="1" max="50" step="1" value={ratio} onChange={e=>{setRatio(Number(e.target.value));setDraft(null);sessionStorage.removeItem(key)}}/> 份餐</label><PrimaryButton loading={busy} disabled={!date||!Number.isInteger(ratio)||ratio<1||ratio>50} onClick={()=>void create()}>{draft?'重新生成草稿':'生成复核汇总草稿'}</PrimaryButton></div>
 <p className="helper-note">默认 1 次容器交付 = 1 份餐，仅在你确认后用于换算。一个托盘含多份且份数不固定时，请直接人工核实总份数，不能使用统一倍率自动推算。</p>
 {error&&<div className="inline-alert danger">{error}</div>}
 {draft&&<><div className="settlement-metrics"><div><small>已确认事件</small><strong>{draft.confirmedCount} 次</strong></div><div><small>待复核</small><strong>{draft.pendingCount} 条</strong></div><div><small>已剔除 / 非统计版本</small><strong>{draft.rejectedCount} / {draft.excludedCount}</strong></div><div><small>草稿核实出餐</small><strong>{draft.suggestedQty} 份</strong></div></div>
 <p className="history-note">统计时段：{timeText(draft.windowStart)} 至 {timeText(draft.windowEnd)}（结束时刻不包含）；来源快照 {draft.sourceDigest.slice(0,12)}…；有效期至 {timeText(draft.expiresAt)}。</p>
 {draft.pendingCount>0&&<div className="inline-alert warn">还有 {draft.pendingCount} 条待复核，不能结算。<Link className="text-link" to={`/events?date=${date}&status=PENDING`}>前往事件复核</Link>，完成后重新生成草稿。</div>}
 <details><summary>检查录像覆盖与统计版本（{recordings.length} 个相关任务）</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>录像 / 会话</th><th>开始</th><th>结束</th><th>参与统计</th><th>核查</th></tr></thead><tbody>{recordings.map(t=><tr key={t.taskId}><td>{t.filename}</td><td>{timeText(t.from)}</td><td>{t.durationKnown?timeText(t.until):'旧任务时长未知'}</td><td>{t.statsIncluded?'是':'否'}</td><td><Link className="table-action" to={`/events?task=${t.taskId}`}>事件</Link></td></tr>)}</tbody></table></div>{!recordings.length&&<p className="history-note">没有相关录像覆盖信息，只有人工记录也需要独立确认完整营业数据；不能因为没有记录就断定零出餐。</p>}</details>
 {done?<div className="inline-alert">此草稿已确认并保留来源；时间 {timeText(draft.confirmedAt)}。{draft.confirmationNote}</div>:<><div className="confirmation-checks">
 <label><input type="checkbox" checked={coverage} onChange={e=>setCoverage(e.target.checked)}/> 我已核实该餐次全部交付均被覆盖，无缺失时段、重叠录像重复统计；必要时已结合人工记录核对。</label>
 <label><input type="checkbox" checked={units} onChange={e=>setUnits(e.target.checked)}/> 我已剔除空容器、重复往返等误计，并确认所有有效事件适用 {draft.portionsPerEvent} 份/次的统一换算。</label>
 {draft.confirmedCount===0&&<label><input type="checkbox" checked={zero} onChange={e=>setZero(e.target.checked)}/> 我确认该餐次实际出餐确实为 0，不是相机停机或没有采集。</label>}
 {existing?.actualQty!=null&&<label><input type="checkbox" checked={overwrite} onChange={e=>setOverwrite(e.target.checked)}/> 当前已有核实量 {existing.actualQty} 份；同意只更新核实出餐量及依据，保留计划和实际备餐。</label>}
 </div><div className="field"><label>核实依据（必填）</label><textarea value={note} maxLength={300} onChange={e=>setNote(e.target.value)} placeholder="记录核实范围、缺段补录依据与异常处理。"/></div>
 <PrimaryButton loading={busy} disabled={draft.pendingCount>0||!coverage||!units||!note.trim()||(draft.confirmedCount===0&&!zero)||(existing?.actualQty!=null&&!overwrite)} onClick={()=>void confirm()}>确认汇总，写入台账与预测依据</PrimaryButton></>}
 </>}
 </div>
}

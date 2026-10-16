import {useEffect,useRef,useState} from 'react'
import {ArrowRight,CalendarClock,CheckCircle2,Database,Info,Plus,Sparkles,TrendingUp} from 'lucide-react'
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {api,dayText,nextDay,fmt,slotName,timeText,type Forecast,type MealSlot,type Prep} from '../lib/api'
import {useAsyncData,useWorkspace} from '../lib/context'
import {EmptyState,LoadingBlock,PageTitle,PrimaryButton,SecondaryButton,SectionTitle,StatusTag} from '../components/Layout'
const slots:MealSlot[]=['BREAKFAST','LUNCH','DINNER']
import SettlementPanel from '../components/SettlementPanel'
import Pagination from '../components/Pagination'

export default function PlanningPage(){
  const {origin,notify}=useWorkspace()
  const [date,setDate]=useState(dayText()),[slot,setSlot]=useState<MealSlot>('LUNCH'),[targetDate,setTargetDate]=useState(nextDay())
  const {data,loading,error,refresh}=useAsyncData(()=>api.prep(origin),[origin])
  const {data:stalls}=useAsyncData(api.stalls,[])
  const [historyPage,setHistoryPage]=useState(0)
  const {data:historyData,refresh:reloadHistory}=useAsyncData(()=>api.forecastSearch(origin,slot,historyPage),[origin,slot,historyPage])
  const history=historyData?.items
  const [formRevision,setFormRevision]=useState(0),[manualOverride,setManualOverride]=useState(false)
  useEffect(()=>setHistoryPage(0),[origin,slot])
  const [planned,setPlanned]=useState('0'),[prepared,setPrepared]=useState('0'),[actual,setActual]=useState(''),[note,setNote]=useState('')
  const [saving,setSaving]=useState(false),[predicting,setPredicting]=useState(false),[forecast,setForecast]=useState<Forecast|null>(null),[buffer,setBuffer]=useState(8)
  const loadedKey=useRef(''),workspace=useRef(origin),predictionKey=useRef(''),selectedHistory=useRef<string|null>(null);workspace.current=origin;predictionKey.current=`${origin}:${slot}:${targetDate}`
  const busy=!!forecast&&['RUNNING','QUEUED'].includes(forecast.status)
  const fill=(row?:Prep)=>{setFormRevision(row?.revision??0);setManualOverride(false);setPlanned(String(row?.plannedQty??0));setPrepared(String(row?.preparedQty??0));setActual(row?.actualQty==null?'':String(row.actualQty));setNote(row?.note||'')}
  useEffect(()=>{
    const key=`${origin}:${date}:${slot}`
    if(!data||loadedKey.current===key)return
    fill(data.find(p=>p.serviceDate===date&&p.mealSlot===slot));loadedKey.current=key
  },[origin,date,slot,data])
  useEffect(()=>{setForecast(null);loadedKey.current='';fill()},[origin])
  useEffect(()=>{setForecast(null)},[origin,slot,targetDate])
  useEffect(()=>{if(!forecast&&history){const latest=history.find(f=>f.id===selectedHistory.current&&f.targetDate===targetDate)||history.find(f=>f.targetDate===targetDate);selectedHistory.current=null;if(latest)setForecast(latest)}},[history,forecast,targetDate])
  useEffect(()=>{
    if(!forecast||!['QUEUED','RUNNING'].includes(forecast.status))return
    let active=true,pending=false
    const timer=setInterval(async()=>{if(pending)return;pending=true;try{const f=await api.getForecast(forecast.id);if(active){setForecast(f);if(!['QUEUED','RUNNING'].includes(f.status))void reloadHistory()}}catch(e){if(active)notify((e as Error).message,'error')}finally{pending=false}},1300)
    return()=>{active=false;clearInterval(timer)}
  },[forecast?.id,forecast?.status])
  const editScope=useRef(`${origin}:${date}:${slot}`);editScope.current=`${origin}:${date}:${slot}`
  const save=async()=>{
    if(!stalls?.[0]||saving)return
    for(const [name,value] of [['计划备餐',planned],['实际备餐',prepared],['核实出餐',actual]] as const){if(name==='核实出餐'&&!value.trim())continue;if(!value.trim()||!Number.isInteger(Number(value))||Number(value)<0||Number(value)>100000){notify(`${name}必须为 0—100000 的整数`,'error');return}}
    const submittedEdit=editScope.current;setSaving(true)
    try{const row=await api.savePrep({stallId:stalls[0].id,origin,serviceDate:date,mealSlot:slot,plannedQty:Number(planned),preparedQty:Number(prepared),actualQty:actual.trim()===''?null:Number(actual),note,expectedRevision:formRevision,manualOverride});if(row.origin!==workspace.current||editScope.current!==submittedEdit)return;fill(row);notify('台账已保存；同日期餐次更新原记录');await refresh()}
    catch(e){notify((e as Error).message,'error')}finally{setSaving(false)}
  }
  const predict=async()=>{
    if(!stalls?.[0]||busy||predicting)return
    const scope=predictionKey.current;setPredicting(true)
    try{const f=await api.forecast({stallId:stalls[0].id,origin,mealSlot:slot,bufferRate:buffer/100,targetDate});if(predictionKey.current===scope){setForecast(f);void reloadHistory()}}
    catch(e){notify((e as Error).message,'error')}finally{setPredicting(false)}
  }
  const seed=async()=>{
    if(origin!=='SIMULATION'||!stalls?.[0]||!window.confirm('填充最近 8 天当前餐次的模拟样本；已有台账不会被覆盖。这些数字不是食堂销量。继续吗？'))return
    setSaving(true);try{const r=await api.seed(stalls[0].id,slot);notify(`新增 ${r.created} 天模拟样本，跳过 ${r.skipped} 天已有记录`);await refresh()}
    catch(e){notify((e as Error).message,'error')}finally{setSaving(false)}
  }
  const apply=async()=>{
    if(!forecast?.targetDate)return
    const old=data?.find(p=>p.serviceDate===forecast.targetDate&&p.mealSlot===forecast.mealSlot)
    if(!window.confirm(`将 ${forecast.recommendedQty} 份写入 ${forecast.targetDate} ${slotName[forecast.mealSlot]} 的计划备餐量。${old?'已有计划量会被更新；':''}实际备餐量与核实出餐量保持不变。继续吗？`))return
    const submittedScope=origin;setSaving(true)
    try{const row=await api.applyForecast(forecast.id,!!old);if(workspace.current!==submittedScope)return;setDate(row.serviceDate);setSlot(row.mealSlot);fill(row);loadedKey.current=`${origin}:${row.serviceDate}:${row.mealSlot}`;await refresh();notify('建议已写入计划；实际数据未被覆盖')}
    catch(e){notify((e as Error).message,'error')}finally{setSaving(false)}
  }
  const chart=[...(data||[])].filter(x=>x.mealSlot===slot).slice(0,14).reverse().map(x=>({day:x.serviceDate.slice(5),prepared:x.preparedQty,actual:x.verificationStale?null:x.actualQty}))
  return <div className="page-enter"><PageTitle eyebrow="MEAL INTELLIGENCE / 科学备餐" title="智能备餐中心" description="录入台账、查看可解释预测，再把建议落实为计划；未核实的数据保持为空。"/>
    {error&&<div className="inline-alert danger">{error}</div>}
    {stalls?.[0]&&<SettlementPanel stallId={stalls[0].id} origin={origin} date={date} slot={slot} existing={data?.find(p=>p.serviceDate===date&&p.mealSlot===slot)} onApplied={p=>{fill(p);void refresh()}}/>}
    <div className="planning-top-grid"><div className="panel"><SectionTitle label="备餐台账登记 / 编辑" sub="选择日期和餐次会读取原记录；保存只更新该条台账"/><div className="form-grid"><div className="field"><label>台账日期</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="field"><label>餐次</label><select value={slot} onChange={e=>setSlot(e.target.value as MealSlot)}>{slots.map(s=><option key={s} value={s}>{slotName[s]}</option>)}</select></div><div className="field"><label>计划备餐量（份）</label><input type="number" min="0" max="100000" value={planned} onChange={e=>setPlanned(e.target.value)}/></div><div className="field"><label>实际备餐量（份）</label><input type="number" min="0" max="100000" value={prepared} onChange={e=>setPrepared(e.target.value)}/></div><div className="field full"><label>人工核实出餐量（份，可留空）</label><input type="number" min="0" max="100000" placeholder="未核实请留空；0 表示已确认没有出餐" value={actual} onChange={e=>setActual(e.target.value)}/></div><div className="field full"><label>记录说明</label><textarea value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></div></div>
    {data?.find(p=>p.serviceDate===date&&p.mealSlot===slot)?.verificationSource==='REVIEW_SETTLEMENT'&&<div className="confirmation-checks"><label><input type="checkbox" checked={manualOverride} onChange={e=>setManualOverride(e.target.checked)}/> 我依据独立业务记录重新核实出餐量，改为人工核实来源（需要填写依据）。只修改计划或备餐量不要勾选。</label></div>}
    <div className="form-actions-inline"><PrimaryButton disabled={!stalls?.length||loading} loading={saving} onClick={()=>void save()}><CheckCircle2 size={16}/> 保存备餐记录</PrimaryButton></div>{actual!==''&&Number(actual)>Number(prepared)&&<div className="inline-alert warn">核实出餐超过登记备餐量，请检查是否漏记补餐。系统保留差额，不会自动改写原始数量。</div>}</div>
    <div className="panel"><SectionTitle label="备餐需求预测" sub={`当前餐次：${slotName[slot]} · 仅使用目标日期之前的人工核实数据`}/><div className="field"><label>预测目标日期</label><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)}/></div><div className="predict-controls"><label>安全缓冲率 <strong>{buffer}%</strong></label><input type="range" min="0" max="30" value={buffer} onChange={e=>setBuffer(Number(e.target.value))}/><PrimaryButton loading={predicting||busy} disabled={!stalls?.length||!targetDate} onClick={()=>void predict()}><Sparkles size={16}/> 计算备餐建议</PrimaryButton></div>
      {busy?<LoadingBlock height={120}/>:forecast?.status==='COMPLETED'?<><div className="forecast-result"><div><span>预测需求</span><strong>{fmt(forecast.predictedQty)} <small>份</small></strong></div><ArrowRight size={24}/><div className="forecast-primary"><span>建议备餐</span><strong>{fmt(forecast.recommendedQty)} <small>份</small></strong></div><p>{forecast.explanation}</p></div><p className="history-note">目标：{forecast.targetDate} · 样本 {forecast.sampleSize} 天 · 来源日期 {forecast.historyStart}—{forecast.historyEnd} · 本次缓冲 {Math.round(forecast.bufferRate*100)}%</p><p className="history-note">样本波动参考范围 {forecast.lowerQty}—{forecast.upperQty} 份（不是经校准的概率置信区间）。来源变化的台账不会进入新预测。</p><details><summary>查看本次预测候选输入台账快照</summary><pre className="rule-snapshot">{forecast.sourceSnapshot||'旧记录未保存来源快照'}</pre></details><PrimaryButton loading={saving} disabled={!forecast.targetDate||forecast.targetDate<dayText()} onClick={()=>void apply()}>采用建议，写入计划量</PrimaryButton></>:forecast?.status==='INSUFFICIENT'?<div className="forecast-message"><Info size={22}/><p>{forecast.explanation}</p></div>:forecast?.status==='FAILED'?<div className="inline-alert danger">{forecast.errorMessage}</div>:<EmptyState title="等待生成备餐建议" description="至少需要目标日期之前 3 天同餐次人工核实出餐数据。" icon={TrendingUp}/>}
    </div></div>
    <div className="panel"><SectionTitle label="备餐与核实出餐对照" sub="最近 14 条同餐次台账；未核实为空白，不会画成真实的零销量"/>{chart.length?<div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid stroke="#edf1ed" vertical={false}/><XAxis dataKey="day"/><YAxis allowDecimals={false}/><Tooltip/><Bar name="实际备餐" dataKey="prepared" fill="#cbe4d6" radius={[5,5,0,0]}/><Bar name="人工核实出餐（空白为未填）" dataKey="actual" fill="#2b866e" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div>:<EmptyState title="尚无备餐台账" description="保存第一条台账，或者在模拟工作区填充明确标记的演示样本。" icon={Database}/>}</div>
    <div className="panel planning-records"><SectionTitle label="历史备餐台账" sub="计划、实际备餐、核实出餐是不同字段；差额不是实测浪费" action={origin==='SIMULATION'?<SecondaryButton disabled={saving||!stalls?.length} onClick={()=>void seed()}><Plus size={15}/> 填充模拟预测样本</SecondaryButton>:undefined}/>{loading?<LoadingBlock/>:data?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>餐次</th><th>计划</th><th>实际备餐</th><th>核实出餐</th><th>差额</th><th>备注</th><th>操作</th></tr></thead><tbody>{data.map(p=><tr key={p.id} className={p.serviceDate===date&&p.mealSlot===slot?'selected-record':''}><td>{p.serviceDate}</td><td>{slotName[p.mealSlot]}</td><td>{p.plannedQty}</td><td>{p.preparedQty}</td><td>{p.verificationStale?`${p.actualQty??'—'}（需重新核实）`:p.actualQty??'未核实'}{p.verificationSource==='REVIEW_SETTLEMENT'&&<small className="block-text">事件结算：{p.sourceEventCount} 次 × {p.portionsPerEvent} 份/次</small>}</td><td>{p.actualQty==null||p.verificationStale?'—':p.preparedQty-p.actualQty}</td><td className="truncate-cell">{p.note||'—'}</td><td><button className="table-action" onClick={()=>{setDate(p.serviceDate);setSlot(p.mealSlot);fill(p);loadedKey.current=`${origin}:${p.serviceDate}:${p.mealSlot}`;window.scrollTo({top:0,behavior:'smooth'})}}>编辑</button></td></tr>)}</tbody></table></div>:<EmptyState title="暂无历史台账" description="填写数据后保存即可。" icon={CalendarClock}/>}</div>
    <div className="panel forecast-history"><SectionTitle label="预测记录" sub="保存每次建议的目标日期、样本范围、缓冲率及解释；刷新后仍可查询" action={<SecondaryButton onClick={()=>void reloadHistory()}>刷新记录</SecondaryButton>}/>{history?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>生成时间</th><th>目标日期</th><th>状态</th><th>样本数</th><th>建议备餐</th><th>操作</th></tr></thead><tbody>{history.map(f=><tr key={f.id}><td>{timeText(f.createdAt)}</td><td>{f.targetDate||'旧记录未指定'}</td><td><StatusTag status={f.status}/></td><td>{f.sampleSize??'—'}</td><td>{f.recommendedQty??'—'}</td><td><button className="table-action" onClick={()=>{selectedHistory.current=f.id;if(f.targetDate)setTargetDate(f.targetDate);setForecast(f)}}>查看结果</button></td></tr>)}</tbody></table></div>:<p className="history-note">当前餐次暂无预测记录。</p>}<Pagination page={historyPage} pages={historyData?.pages||0} total={historyData?.total||0} onChange={setHistoryPage}/></div>
  </div>
}

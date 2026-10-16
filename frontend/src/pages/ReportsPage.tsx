import {useEffect,useState} from 'react'
import {BarChart3,CalendarDays,Download,FileSpreadsheet,FileText,RefreshCw} from 'lucide-react'
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {api,dayText,downloadCsv,slotName,timeText} from '../lib/api'
import {useAsyncData,useWorkspace} from '../lib/context'
import {EmptyState,LoadingBlock,MetricCard,PageTitle,PrimaryButton,SecondaryButton,SectionTitle,StatusTag} from '../components/Layout'

export default function ReportsPage(){
  const {origin,notify}=useWorkspace(),[date,setDate]=useState(dayText()),[exporting,setExporting]=useState(false)
  const {data,loading,error,refresh}=useAsyncData(()=>api.daily(origin,date),[origin,date])
  const hourly=data?.hourly||[]
  const exportFile=async(summary=false)=>{setExporting(true);try{await downloadCsv(origin,date,summary);notify(summary?'已导出经营汇总 CSV':'已导出出餐事件明细 CSV')}catch(e){notify((e as Error).message,'error')}finally{setExporting(false)}}
  return <div className="page-enter"><PageTitle eyebrow="ANALYTICS / 经营洞察" title="经营日报与分析" description="让每一次出餐都有清晰的记录，每一份报告都有可复核的依据。" actions={<><SecondaryButton disabled={exporting} onClick={()=>void exportFile(false)}><Download size={17}/> 事件明细 CSV</SecondaryButton><PrimaryButton loading={exporting} onClick={()=>void exportFile(true)}><Download size={17}/> 经营汇总 CSV</PrimaryButton></>}/>
    <div className="report-toolbar"><div><span className="report-icon"><CalendarDays size={19}/></span><div><strong>经营日报</strong><small>选择要分析的营业日期</small></div></div><input type="date" value={date} onChange={e=>setDate(e.target.value)}/><SecondaryButton onClick={()=>void refresh()}><RefreshCw size={16}/> 重新加载</SecondaryButton></div>
    {error&&<div className="inline-alert danger">{error}</div>}
    {loading?<LoadingBlock/>:<>
      <div className="metric-grid"><MetricCard label="有效出餐总数" value={data?.count||0} unit="次" detail="未剔除的事件数量" icon={BarChart3}/><MetricCard label="人工已确认" value={data?.confirmed||0} unit="次" detail="包括补录的记录" icon={FileText} tone="mint"/><MetricCard label="待复核事件" value={data?.pending||0} unit="条" detail="需要核验的初判结果" icon={FileSpreadsheet} tone="peach"/><MetricCard label="剔除错误事件" value={data?.rejected||0} unit="条" detail="不再计入有效出餐" icon={FileText} tone="stone"/></div>
      <div className="info-strip"><FileSpreadsheet size={18}/><span>台账实际备餐 {data?.preparedQty||0} 份；已填报核实出餐 {data?.verifiedQty||0} 份；{data?.unverifiedMeals||0} 个餐次尚未核实。仅已核实餐次的备餐−出餐差额为 {data?.balanceQty||0} 份，不能直接当作实测剩余或浪费量。</span></div>
      {!!data?.staleMeals&&<div className="inline-alert warn">{data.staleMeals} 个餐次的来源发生变化，原核实量保留但不计入当前已核实汇总，请到智能备餐重新核实。</div>}
      <div className="dashboard-panels"><div className="panel"><SectionTitle label="出餐时段分布" sub="仅当前日期 · 事件经复核剔除后自动调整"/><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourly} margin={{left:-20,top:12,bottom:8,right:10}}><CartesianGrid stroke="#edf1ed" vertical={false}/><XAxis dataKey="hour" axisLine={false} tickLine={false} interval={2} tick={{fontSize:11,fill:'#9bad9f'}}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#9bad9f'}}/><Tooltip contentStyle={{borderRadius:14,fontSize:12}}/><Bar dataKey="count" fill="#268768" radius={[6,6,0,0]} maxBarSize={30} name="有效出餐"/></BarChart></ResponsiveContainer></div></div>
      <div className="panel"><SectionTitle label="当日备餐台账" sub="备餐来自人工录入，不会自动推断为实际出餐"/>{data?.preparations?.length?<div className="report-prep-list">{data.preparations.map(p=><div className="report-prep-row" key={p.id}><div><span>{slotName[p.mealSlot]}</span><strong>{p.preparedQty} <small>份备餐</small></strong></div><div><span>人工核实出餐</span><strong>{p.verificationStale?`${p.actualQty??'—'}（待重新核实）`:p.actualQty??'未填报'}</strong></div><div><span>计划备餐</span><strong>{p.plannedQty} <small>份</small></strong></div></div>)}</div>:<EmptyState title="当日尚无备餐记录" description="在「智能备餐」中录入计划和实际备餐量后，才会出现在日报里。" icon={FileSpreadsheet}/>}</div></div>
      <div className="panel"><SectionTitle label="日报事件明细" sub={`日期：${date} · 数据口径：${origin==='SIMULATION'?'模拟实验':'授权真实场景'}`}/>{data?.events?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>来源</th><th>Track ID</th><th>审核状态</th><th>数据域</th></tr></thead><tbody>{data.events.map(e=><tr key={e.id}><td>{timeText(e.occurredAt)}</td><td>{e.source==='AUTO'?'视觉越线':'人工补录'}</td><td>{e.trackId??'—'}</td><td><StatusTag status={e.reviewStatus}/></td><td><StatusTag status={e.origin}/></td></tr>)}</tbody></table></div>:<EmptyState title="这个日期暂无出餐事件" description="选择其他日期，或运行一次模拟视频检测后查看报表。" icon={FileText}/>}</div>
    </>}
  </div>
}

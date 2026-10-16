import {ArrowRight,ArrowUpRight,CheckCheck,ChevronRight,ClipboardCheck,Eye,Flame,PackageCheck,Play,ScanLine,Sparkles,TrendingUp,Video} from 'lucide-react'
import {Area,AreaChart,Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {useNavigate} from 'react-router-dom'
import {api,fmt,timeText} from '../lib/api'
import {useWorkspace,useAsyncData} from '../lib/context'
import {EmptyState,LoadingBlock,MetricCard,PageTitle,PrimaryButton,SecondaryButton,SectionTitle,StatusTag} from '../components/Layout'

const palette={green:'#25836a',faint:'#e1ede6'}

function HeroArt(){return <div className="hero-art" aria-hidden="true"><span className="hero-orbit orbit-a"/><span className="hero-orbit orbit-b"/><span className="hero-orbit orbit-c"/>
  <div className="hero-plate"><div className="hero-plate-center"><svg width="108" height="108" viewBox="0 0 108 108"><circle cx="54" cy="54" r="32" fill="#f3f9f1"/><ellipse cx="54" cy="54" rx="19" ry="16" fill="#c9e4b6"/><path d="M40 54q15-25 30 0q-20 22-30 0" fill="#7cba94"/><circle cx="57" cy="48" r="5" fill="#f2c17a"/><circle cx="43" cy="57" r="4" fill="#f2c17a"/><path d="M64 70Q83 58 81 47" fill="none" stroke="#529e76" strokeWidth="4" strokeLinecap="round"/></svg></div></div>
  <div className="hero-mini hero-mini-a"><span className="hero-mini-icon"><ScanLine size={16}/></span><span>视觉检测<br/><strong>ACTIVE</strong></span></div>
  <div className="hero-mini hero-mini-b"><span className="hero-mini-icon peach"><TrendingUp size={16}/></span><span>每份出餐<br/><strong>都有迹可循</strong></span></div>
  <span className="hero-twinkle twinkle-a">✦</span><span className="hero-twinkle twinkle-b">✦</span></div>}

export default function DashboardPage(){
  const {origin}=useWorkspace(),navigate=useNavigate()
  const {data,loading,error,refresh}=useAsyncData(()=>api.dashboard(origin),[origin])
  const isSim=origin==='SIMULATION'
  const trend=data?.trend||[],hourly=data?.hourly||[]
  return <div className="page-enter">
    <PageTitle eyebrow="DASHBOARD / 数据总览" title="经营驾驶舱" description="从出餐的每一个瞬间，看见更聪明的经营决策。"
      actions={<SecondaryButton onClick={()=>void refresh()}><span className="refresh-symbol">↻</span> 刷新数据</SecondaryButton>}/>
    <section className="welcome-hero"><div className="welcome-content"><span className="welcome-label"><Sparkles size={14}/> SMART FOODSERVICE INTELLIGENCE</span><h2>洞察每一份出餐，<br/><em>预见每一餐需求。</em></h2><p>从视频监测到数据复核，再到科学备餐。<br/>用轻量 AI，把日常经营变成清晰的数据。</p>
      <div className="welcome-actions"><PrimaryButton onClick={()=>navigate('/monitor')}>开启 AI 监测 <ArrowUpRight size={17}/></PrimaryButton><button className="hero-ghost" onClick={()=>navigate('/planning')}>探索备餐分析 <ArrowRight size={16}/></button></div></div><HeroArt/></section>
    {error&&<div className="inline-alert danger">{error} <button onClick={()=>void refresh()}>重试</button></div>}
    <div className="block-heading"><div><span className="small-eyebrow">DATA SNAPSHOT</span><h2>今日运行概览</h2></div><span className="muted-caption">{data?.date||'—'} · {isSim?'模拟实验数据':'真实场景数据'}</span></div>
    {loading?<LoadingBlock height={160}/>:<div className="metric-grid">
      <MetricCard label="今日有效出餐" value={fmt(data?.todayCount)} unit="次" detail="自动初判（非剔除）+ 人工确认" icon={PackageCheck} tone="green"/>
      <MetricCard label="待人工复核" value={fmt(data?.pendingCount)} unit="条" detail="等待操作员进一步确认" icon={ScanLine} tone="peach"/>
      <MetricCard label="已确认事件" value={fmt(data?.confirmedCount)} unit="条" detail="含人工补录的有效事件" icon={CheckCheck} tone="mint"/>
      <MetricCard label="今日记录备餐" value={fmt(data?.preparedCount)} unit="份" detail="来自已登记的实际备餐量" icon={Flame} tone="stone"/>
    </div>}
    <div className="dashboard-panels">
      <div className="panel panel-trend"><SectionTitle label="出餐趋势" sub="近 7 日 · 有效出餐事件的日期变化" action={<span className="chart-legend"><span/> 出餐次数</span>}/>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{left:-20,right:8,top:16,bottom:3}}>
          <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#45a786" stopOpacity={.22}/><stop offset="95%" stopColor="#45a786" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="#edf1ed" strokeDasharray="4 6" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#90a39a'}} dy={11}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#90a39a'}}/>
          <Tooltip contentStyle={{borderRadius:14,border:'1px solid #e8eee9',boxShadow:'0 10px 32px #18392b12',fontSize:12}} formatter={(v)=>[`${v} 次`,'有效出餐']}/>
          <Area type="monotone" dataKey="count" stroke={palette.green} strokeWidth={2.8} fill="url(#trendFill)" dot={{r:3,strokeWidth:2,fill:'#fff',stroke:palette.green}} activeDot={{r:6}}/>
        </AreaChart></ResponsiveContainer></div>
        <div className="chart-footnote"><span className="chart-footnote-icon"><Eye size={15}/></span>{data?.todayCount?'统计依据为已入库的越线事件，人工剔除后会重新计算。':'暂无出餐数据：上传模拟视频即可生成真实处理链路的事件记录。'}</div>
      </div>
      <div className="panel panel-quick"><SectionTitle label="运行引导" sub="用三步完成一次完整的业务验证"/>
        <div className="steps-list">
          {[{n:'01',icon:Video,name:'采集或上传视频',detail:'固定机位，设置越线方向',to:'/monitor'},{n:'02',icon:ClipboardCheck,name:'核对出餐事件',detail:'复核误计、补录漏计',to:'/events'},{n:'03',icon:TrendingUp,name:'形成备餐建议',detail:'录入历史实际出餐量',to:'/planning'}].map(({n,icon:Icon,name,detail,to})=><button onClick={()=>navigate(to)} className="step-row" key={n}><span className="step-number">{n}</span><span className="step-icon"><Icon size={18}/></span><span className="step-info"><strong>{name}</strong><small>{detail}</small></span><ChevronRight size={17} color="#95aaa0"/></button>)}
        </div><div className="quick-footer"><span className="quick-footer-star">✳</span><div><strong>从模拟到实际</strong><p>授权试点前，所有实验数据都会独立标记。</p></div></div>
      </div>
    </div>
    <div className="dashboard-panels dashboard-bottom">
      <div className="panel"><SectionTitle label="时段出餐分布" sub="00:00—24:00 · 当前统计版本的事件汇总"/><div className="chart-wrap small-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourly} margin={{left:-19,right:3,top:8,bottom:2}}><CartesianGrid stroke="#edf1ed" vertical={false}/><XAxis dataKey="hour" tickLine={false} axisLine={false} interval={2} tick={{fontSize:10,fill:'#93a49d'}}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#93a49d'}}/><Tooltip contentStyle={{borderRadius:14,fontSize:12}} formatter={(v)=>[`${v} 次`,'出餐']}/><Bar dataKey="count" fill="#7bbda0" radius={[5,5,0,0]} maxBarSize={25}/></BarChart></ResponsiveContainer></div></div>
      <div className="panel recent-panel"><SectionTitle label="最新出餐动态" sub="仅展示当前选定数据域的事件" action={<button className="text-link" onClick={()=>navigate('/events')}>全部事件 <ArrowRight size={14}/></button>}/>
        {data?.recentEvents?.length?<div className="recent-list">{data.recentEvents.map(e=><div className="recent-row" key={e.id}><span className="recent-row-icon"><ScanLine size={17}/></span><span><strong>{e.source==='AUTO'?'视觉检测出餐':'人工补录出餐'}</strong><small>{timeText(e.occurredAt)} · {e.trackId?`Track #${e.trackId}`:'手工核实'}</small></span><StatusTag status={e.reviewStatus}/></div>)}</div>:<EmptyState title="等待第一条出餐事件" description="还没有记录。可以先使用自带的模拟视频验证整个算法流程。" icon={ScanLine} action={<button className="text-link" onClick={()=>navigate('/monitor')}>前往 AI 监测 <ArrowRight size={15}/></button>}/>}
      </div>
    </div>
  </div>
}

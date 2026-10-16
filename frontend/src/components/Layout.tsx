import {type ReactNode,useState} from 'react'
import {NavLink,useNavigate} from 'react-router-dom'
import {Activity,ArrowUpRight,BarChart3,CalendarDays,ChevronDown,ClipboardList,Eye,Flame,Headphones,LayoutDashboard,LogOut,Menu,RadioTower,Settings2,ShieldCheck,Sparkles,Video,X} from 'lucide-react'
import {useWorkspace} from '../lib/context'
import {api} from '../lib/api'

const nav=[
  {to:'/dashboard',icon:LayoutDashboard,label:'经营驾驶舱',sub:'Overview'},
  {to:'/monitor',icon:RadioTower,label:'AI 出餐监测',sub:'AI Monitoring'},
  {to:'/events',icon:ClipboardList,label:'事件与复核',sub:'Review Center'},
  {to:'/planning',icon:Flame,label:'智能备餐',sub:'Meal Planning'},
  {to:'/reports',icon:BarChart3,label:'数据报表',sub:'Analytics'},
  {to:'/settings',icon:Settings2,label:'档口与系统',sub:'Configuration'},
]

export function Brand({dark=false}:{dark?:boolean}){
  return <div className="brand"><div className={`brand-mark ${dark?'brand-mark-dark':''}`}>
    <Eye size={23} strokeWidth={2.6}/><span className="brand-mark-dot"/></div>
    <div><div className="brand-name">灶眼<span> AI</span></div><div className="brand-english">SMART KITCHEN INTELLIGENCE</div></div>
  </div>
}

export default function Layout({children}:{children:ReactNode}){
  const {user,origin,setOrigin,setUser}=useWorkspace()
  const [opened,setOpened]=useState(false)
  const navigate=useNavigate()
  const logout=async()=>{try{await api.logout()}finally{setUser(null);navigate('/login')}}
  return <div className="app-shell">
    {opened&&<button className="mobile-backdrop" aria-label="关闭导航" onClick={()=>setOpened(false)}/>}
    <aside className={`sidebar ${opened?'sidebar-open':''}`}>
      <div className="sidebar-top"><Brand/><button className="sidebar-close icon-button" aria-label="关闭" onClick={()=>setOpened(false)}><X size={18}/></button></div>
      <div className="sidebar-overline">WORKSPACE / 工作空间</div>
      <div className="sidebar-nav">{nav.map(({to,icon:Icon,label,sub})=><NavLink key={to} to={to} onClick={()=>setOpened(false)} className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
        <span className="nav-icon"><Icon size={19} strokeWidth={1.9}/></span><span className="nav-label"><strong>{label}</strong><small>{sub}</small></span><span className="nav-dot"/>
      </NavLink>)}</div>
      <div className="sidebar-bottom">
        <div className="sidebar-insight"><div className="sidebar-insight-icon"><Sparkles size={18}/></div><div className="sidebar-insight-head">让每份出餐，都有迹可循。</div><p>用真实数据照亮每一次备餐决策。</p><div className="sidebar-insight-art"><span/><span/><span/><span/><span/></div></div>
        <div className="sidebar-footer"><ShieldCheck size={15}/> 隐私优先 · 本地优先</div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={()=>setOpened(true)}><Menu size={22}/></button>
          <span className="topbar-project"><span className="online-dot"/> ZAOYAN WORKSPACE</span><span className="topbar-separator"/><span className="topbar-description">智慧出餐决策平台</span>
        </div>
        <div className="topbar-right">
          <div className="origin-control" title="模拟数据与真实场景数据独立统计"><button onClick={()=>setOrigin('SIMULATION')} className={origin==='SIMULATION'?'selected':''}>模拟实验</button><button onClick={()=>setOrigin('REAL')} className={origin==='REAL'?'selected':''}>真实场景</button></div>
          <span className="topbar-line"/>
          <div className="user-panel"><div className="avatar">{user?.username?.slice(0,1).toUpperCase()||'Z'}</div><div className="user-info"><strong>{user?.username||'访客'}</strong><small>{user?.role==='ADMIN'?'系统管理员':'档口操作员'}</small></div><ChevronDown size={14} color="#728c81"/></div>
          <button className="topbar-logout icon-button" title="退出登录" aria-label="退出登录" onClick={logout}><LogOut size={18}/></button>
        </div>
      </header>
      <main className="main-content">
        <div className={`origin-banner ${origin==='REAL'?'origin-real':'origin-simulation'}`}>
          <span><span className="origin-banner-dot"/>{origin==='SIMULATION'?'当前工作区为「模拟实验」：数据仅用于算法验证与演示，不代表食堂真实经营成果。':'当前工作区为「真实场景」：请确保拥有视频采集授权；与模拟记录完全隔离。'}</span>
          <span>{origin==='SIMULATION'?'SANDBOX':'AUTHORIZED ENVIRONMENT'}</span>
        </div>
        {children}
      </main>
      <footer className="app-footer"><span>© 2026 灶眼 AI 创新团队 · Built for smarter kitchens.</span><span>V1.2 · 科技创新项目原型</span></footer>
    </div>
  </div>
}

export function PageTitle({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:ReactNode}){
  return <div className="page-heading"><div><div className="section-kicker"><span className="kicker-line"/>{eyebrow}</div><h1>{title}<span className="title-period">.</span></h1><p>{description}</p></div>{actions&&<div className="page-actions">{actions}</div>}</div>
}
export function SectionTitle({label,sub,action}:{label:string;sub?:string;action?:ReactNode}){
  return <div className="panel-heading"><div><h3>{label}</h3>{sub&&<p>{sub}</p>}</div>{action}</div>
}
export function EmptyState({title,description,icon:Icon=Activity,action}:{title:string;description:string;icon?:typeof Activity;action?:ReactNode}){
  return <div className="empty-state"><div className="empty-graphic"><Icon size={27} strokeWidth={1.5}/><span className="empty-graphic-ring"/></div><h4>{title}</h4><p>{description}</p>{action}</div>
}
export function StatusTag({status}:{status:string}){
  const map:Record<string,[string,string]>={QUEUED:['等待处理','warn'],RUNNING:['正在分析','blue'],COMPLETED:['已完成','success'],FAILED:['失败','danger'],CANCELLED:['已取消','neutral'],
    PENDING:['待人工复核','warn'],CONFIRMED:['已确认','success'],REJECTED:['已剔除','danger'],INSUFFICIENT:['数据不足','warn'],
    SIMULATION:['模拟实验','warn'],REAL:['真实数据','success']}
  const [label,color]=map[status]||[status,'neutral']
  return <span className={`status-tag status-${color}`}><span/>{label}</span>
}
export function MetricCard({label,value,unit,detail,icon:Icon,tone='green',children}:{label:string;value:string|number;unit?:string;detail:string;icon:typeof Activity;tone?:'green'|'mint'|'peach'|'stone';children?:ReactNode}){
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={20} strokeWidth={1.8}/></span></div><div className="metric-number">{value}<span>{unit}</span></div><div className="metric-detail">{children}{detail}</div></div>
}
export function PrimaryButton({children,onClick,disabled=false,loading=false,type='button'}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;loading?:boolean;type?:'submit'|'button'}){
  return <button className="btn btn-primary" onClick={onClick} disabled={disabled||loading} type={type}>{loading?<span className="mini-spinner"/>:null}{children}</button>
}
export function SecondaryButton({children,onClick,disabled=false,type='button'}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;type?:'button'|'submit'}){
  return <button className="btn btn-secondary" onClick={onClick} disabled={disabled} type={type}>{children}</button>
}
export function LoadingBlock({height=220}:{height?:number}){return <div className="loading-block" style={{minHeight:height}}><span className="spinner"/><span>正在加载数据...</span></div>}

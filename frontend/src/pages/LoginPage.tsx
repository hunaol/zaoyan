import {useState,type FormEvent} from 'react'
import {useNavigate} from 'react-router-dom'
import {ArrowRight,Eye,EyeOff,LockKeyhole,ScanEye,ShieldCheck,Sparkles} from 'lucide-react'
import {api} from '../lib/api'
import {useWorkspace} from '../lib/context'
import {Brand,PrimaryButton} from '../components/Layout'

export default function LoginPage(){
  const {setUser}=useWorkspace();const navigate=useNavigate()
  const [username,setUsername]=useState('demo'),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const user=await api.login(username,password);setUser(user);navigate('/dashboard',{replace:true})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <div className="login-page">
    <div className="login-art"><div className="login-art-top"><Brand dark/><div className="login-art-pill"><span className="online-dot"/> 智能餐饮 · 从这里开始</div></div>
      <div className="login-art-main"><span className="login-eyebrow"><Sparkles size={14}/> AI-POWERED FOODSERVICE</span><h1>让每一份出餐<br/>都被<span>看见。</span></h1><p>以计算机视觉洞察真实出餐过程，<br/>让食堂备餐，从经验走向数据。</p>
      <div className="login-art-visual"><div className="login-radar-circle radar-one"/><div className="login-radar-circle radar-two"/><div className="login-radar-circle radar-three"/><div className="login-visual-target"><ScanEye size={58} strokeWidth={1.1}/></div><div className="login-floating floating-one"><span className="pulse-dot"/> 视觉识别就绪</div><div className="login-floating floating-two">出餐事件 <strong>✓</strong></div></div></div>
      <div className="login-art-bottom"><span>ZAOYAN AI / 2026</span><span>看见出餐 · 预见需求</span></div>
    </div>
    <div className="login-form-side"><div className="login-form-wrap"><span className="form-eyebrow">WELCOME BACK / 欢迎回来</span><h2>登录工作空间<span>.</span></h2><p>进入属于你的智慧餐饮管理中心</p>
      <form onSubmit={submit}><label htmlFor="username">账号</label><div className="input-wrap"><span className="input-adornment">@</span><input id="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="请输入用户名" required/></div>
        <label htmlFor="password">密码</label><div className="input-wrap"><LockKeyhole size={17} className="input-adornment"/><input id="password" type={visible?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="请输入密码" required/><button type="button" className="input-reveal" onClick={()=>setVisible(!visible)} aria-label={visible?'隐藏密码':'显示密码'}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
        {error&&<div className="form-error" role="alert">{error}</div>}
        <PrimaryButton loading={busy} type="submit">进入工作空间 <ArrowRight size={18}/></PrimaryButton>
      </form>
      <div className="login-hint"><ShieldCheck size={18}/><div>本地演示账号默认是 <strong>demo</strong>，初始密码请查看项目 README。首次正式部署前务必修改环境变量中的密码。</div></div>
    </div><div className="login-form-footer">灶眼 AI 创新团队 · 2026 济宁市青年创新创业大赛</div></div>
  </div>
}

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { api } from '../lib/api'
import { useWorkspace } from '../lib/context'
import { Brand, PrimaryButton } from '../components/Layout'
import './LoginPage.css'

/**
 * 登录页。
 *
 * v1 是深绿渐变 + 雷达靶心装饰 + 两个浮动标签。装饰元素与业务无关，
 * 却占了整个左半屏，也让「这是什么系统」这件事被视觉噪音盖住。
 *
 * 现在左边只留排版：一个超大标题、一句说明、一条到实际功能的路径。
 * 右边是窄表单。整页只有黑白两色。
 */
export default function LoginPage() {
  const { setUser } = useWorkspace()
  const navigate = useNavigate()
  const [username, setUsername] = useState('demo')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await api.login(username, password)
      setUser(user)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-brand-top">
          <Brand tone="light" />
        </div>

        <div className="login-brand-main">
          <h1>
            让每一份出餐
            <br />
            都有据可查。
          </h1>
          <p>
            用计算机视觉记录真实出餐过程，把食堂备餐从经验判断
            变成可以复核、可以追溯的数据。
          </p>

          <ul className="login-points">
            <li><span className="login-point-num">01</span>视频越线计数，事件逐条留痕</li>
            <li><span className="login-point-num">02</span>人工复核兜底，误计可剔除、漏计可补录</li>
            <li><span className="login-point-num">03</span>复核结果直接写入备餐台账与预测依据</li>
          </ul>
        </div>

        <p className="login-brand-foot">
          灶眼 AI 创新团队 · 2026 济宁市青年创新创业大赛
        </p>
      </section>

      <section className="login-form-side">
        <div className="login-form-wrap">
          <h2>登录</h2>
          <p className="login-form-desc">使用管理员或档口操作员账号进入工作空间。</p>

          <form onSubmit={submit} className="login-form">
            <div className="field">
              <label htmlFor="username">账号</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="请输入用户名"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">密码</label>
              <div className="login-password">
                <input
                  id="password"
                  className="input"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  required
                />
                <button
                  type="button"
                  className="login-reveal"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                >
                  {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error && <p className="field-error" role="alert">{error}</p>}

            <PrimaryButton loading={busy} type="submit">
              进入工作空间 <ArrowRight size={16} aria-hidden="true" />
            </PrimaryButton>
          </form>

          <p className="login-hint">
            演示账号 <code>demo</code>，初始密码见项目 README。正式部署前请先修改环境变量中的密码。
          </p>
        </div>
      </section>
    </div>
  )
}

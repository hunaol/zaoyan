import { type ReactNode, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, ClipboardList, Eye, Flame, LayoutDashboard,
  LogOut, Menu, RadioTower, RefreshCw, Settings2, ShieldCheck, X,
} from 'lucide-react'
import { useWorkspace } from '../lib/context'
import { api } from '../lib/api'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: '经营驾驶舱' },
  { to: '/monitor', icon: RadioTower, label: 'AI 出餐监测' },
  { to: '/events', icon: ClipboardList, label: '事件与复核' },
  { to: '/planning', icon: Flame, label: '智能备餐' },
  { to: '/reports', icon: BarChart3, label: '数据报表' },
  { to: '/settings', icon: Settings2, label: '档口与系统' },
]

export function Brand({ tone }: { tone?: 'light' }) {
  return (
    <div className={`brand ${tone === 'light' ? 'brand-tone-light' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        <Eye size={18} strokeWidth={2.2} />
      </span>
      <span className="brand-text">
        <span className="brand-name">灶眼<span>AI</span></span>
        <span className="brand-sub">Smart Kitchen</span>
      </span>
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, origin, setOrigin, setUser } = useWorkspace()
  const [opened, setOpened] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // 路由变化时收起移动端抽屉，否则跳转后遮罩会一直盖住内容。
  useEffect(() => { setOpened(false) }, [location.pathname])

  // 抽屉打开时锁滚动，并支持 Esc 关闭。
  useEffect(() => {
    if (!opened) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpened(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [opened])

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try { await api.logout() } finally { setUser(null); navigate('/login') }
  }

  const isSimulation = origin === 'SIMULATION'
  const isAdmin = user?.role === 'ADMIN'

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>

      {opened && (
        <button
          className="mobile-backdrop"
          aria-label="关闭导航菜单"
          onClick={() => setOpened(false)}
        />
      )}

      <aside className={`sidebar ${opened ? 'sidebar-open' : ''}`} aria-label="主导航">
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-btn mobile-only"
            aria-label="关闭导航菜单"
            onClick={() => setOpened(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
            >
              <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>本地优先 · 隐私优先</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn mobile-only"
              aria-label="打开导航菜单"
              onClick={() => setOpened(true)}
            >
              <Menu size={19} />
            </button>
            {/* 顶栏是 sticky 的，滚动到页面中段时大标题已经离开视口，
                这里显示当前所在页面，避免用户失去位置感。 */}
            <span className="topbar-context">
              {NAV.find(item => location.pathname.startsWith(item.to))?.label ?? '灶眼工作台'}
            </span>
          </div>

          <div className="topbar-right">
            <div className="segmented" role="group" aria-label="数据域切换">
              <button
                onClick={() => setOrigin('SIMULATION')}
                aria-pressed={isSimulation}
                title="模拟数据与真实场景数据独立统计，互不混合"
              >
                模拟实验
              </button>
              <button
                onClick={() => setOrigin('REAL')}
                aria-pressed={!isSimulation}
                title="真实场景数据需要视频采集授权"
              >
                {!isSimulation && <span className="live-dot" aria-hidden="true" />}
                真实场景
              </button>
            </div>

            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {user?.username?.slice(0, 1).toUpperCase() || 'Z'}
              </span>
              <span className="user-meta">
                <strong>{user?.username || '访客'}</strong>
                <small>{isAdmin ? '系统管理员' : '档口操作员'}</small>
              </span>
            </div>

            <button
              className="icon-btn"
              title="退出登录"
              aria-label="退出登录"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main className="main-content" id="main-content">
          <p className="origin-note" data-origin={origin}>
            <span className="dot" aria-hidden="true" />
            {isSimulation
              ? '模拟实验数据，仅用于算法验证与演示，不代表真实经营成果。'
              : '真实场景数据，请确保已取得视频采集授权；与模拟记录完全隔离。'}
          </p>
          {children}
        </main>

        <footer className="app-footer">
          <span>© 2026 灶眼 AI 创新团队</span>
          <span>V1.2 · 科技创新项目原型</span>
        </footer>
      </div>
    </div>
  )
}

/* ============================================================================
   共用展示组件
   页面直接依赖的公开 API，签名保持不变。
   ========================================================================== */

export function PageTitle({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: string; description?: string; actions?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="overline" style={{ marginBottom: 'var(--sp-3)' }}>{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ label, sub, action }: {
  label: string; sub?: string; action?: ReactNode
}) {
  return (
    <div className="card-head">
      <div>
        <h3>{label}</h3>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ title, description, icon: Icon = Activity, action }: {
  title: string; description: string; icon?: typeof Activity; action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.7} />
      </span>
      <h4>{title}</h4>
      <p>{description}</p>
      {action}
    </div>
  )
}

const STATUS_MAP: Record<string, [string, string]> = {
  QUEUED: ['等待处理', 'warn'],
  RUNNING: ['正在分析', 'info'],
  COMPLETED: ['已完成', 'ok'],
  FAILED: ['失败', 'danger'],
  CANCELLED: ['已取消', ''],
  PENDING: ['待人工复核', 'warn'],
  CONFIRMED: ['已确认', 'ok'],
  REJECTED: ['已剔除', 'danger'],
  INSUFFICIENT: ['数据不足', 'warn'],
  SIMULATION: ['模拟实验', ''],
  REAL: ['真实数据', 'ok'],
}

export function StatusTag({ status }: { status: string }) {
  const [label, tone] = STATUS_MAP[status] ?? [status, '']
  return <span className={`tag tag-dot ${tone ? `tag-${tone}` : ''}`}>{label}</span>
}

export function MetricCard({ label, value, unit, detail, icon: Icon, children }: {
  label: string; value: string | number; unit?: string; detail: string
  icon: typeof Activity; tone?: string; children?: ReactNode
}) {
  return (
    <div className="card stat">
      <span className="stat-label">
        {label}
        <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </p>
      <p className="stat-detail">{children}{detail}</p>
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled = false, loading = false, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean
  type?: 'submit' | 'button'
}) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={disabled || loading} type={type}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function SecondaryButton({ children, onClick, disabled = false, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'
}) {
  return (
    <button className="btn btn-secondary" onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  )
}

export function RefreshButton({ onClick, loading = false, children = '刷新' }: {
  onClick: () => void; loading?: boolean; children?: ReactNode
}) {
  return (
    <SecondaryButton onClick={onClick} disabled={loading}>
      <RefreshCw size={15} className={loading ? 'spin' : undefined} aria-hidden="true" /> {children}
    </SecondaryButton>
  )
}

export function LoadingBlock({ height = 220 }: { height?: number }) {
  return (
    <div className="empty" style={{ minHeight: Math.min(height, 140) }} aria-busy="true" aria-live="polite">
      <span className="spinner spinner-lg" aria-hidden="true" />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-4)' }}>正在加载…</span>
    </div>
  )
}

export function SkeletonRows({ rows = 4, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="stack stack-sm" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

/**
 * 风险提示的展示。
 *
 * 后端把 riskReasons 存成逗号分隔的编码（`CONTENT_UNVERIFIED,LOW_CONFIDENCE`），
 * 直接当文本渲染会变成一串英文常量，复核人员看不懂。这里拆成独立标签，
 * 并区分严重程度：需要人工判断的用警告色，仅供参考的用中性色。
 *
 * 未知编码**原样保留**而不是丢弃——后端将来新增风险类型时，
 * 这里必须仍然显示出来，否则会出现「有提示但界面不显示」的静默遗漏。
 */
const RISK_TONE: Record<string, string> = {
  CONTENT_UNVERIFIED: 'warn',
  LOW_CONFIDENCE: 'warn',
  POSSIBLE_DUPLICATE: 'danger',
  NESTED_TARGET: 'warn',
  OVERLAP: 'warn',
  TRACK_GAP: '',
  RETURN_MOVEMENT: '',
  OUT_OF_SEGMENT: 'danger',
  TRUNCATED_TARGET: '',
}

const RISK_LABELS: Record<string, string> = {
  CONTENT_UNVERIFIED: '内容物待核实',
  LOW_CONFIDENCE: '低置信度',
  POSSIBLE_DUPLICATE: '疑似重复',
  NESTED_TARGET: '嵌套容器',
  OVERLAP: '遮挡重叠',
  TRACK_GAP: '轨迹中断',
  RETURN_MOVEMENT: '曾反向经过',
  OUT_OF_SEGMENT: '越线在计数线外',
  TRUNCATED_TARGET: '目标贴边',
}

export function RiskTags({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const codes = (value ?? '').split(',').map(v => v.trim()).filter(Boolean)
  if (!codes.length) return <span className="cell-muted">{fallback}</span>
  return (
    <span className="row row-wrap" style={{ gap: 'var(--sp-1)' }}>
      {codes.map(code => {
        const tone = RISK_TONE[code] ?? ''
        return (
          <span key={code} className={`tag ${tone ? `tag-${tone}` : ''}`}>
            {RISK_LABELS[code] ?? code}
          </span>
        )
      })}
    </span>
  )
}

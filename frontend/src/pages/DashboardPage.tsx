import { useMemo } from 'react'
import { ArrowRight, BarChart3, ClipboardCheck, Flame, PackageCheck, ScanLine, TrendingUp, Video } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { api, fmt, timeText, type CountEvent } from '../lib/api'
import { useWorkspace, useAsyncData } from '../lib/context'
import {
  EmptyState, LoadingBlock, MetricCard, PageTitle, PrimaryButton, RefreshButton, StatusTag,
} from '../components/Layout'
import './DashboardPage.css'

const STEPS = [
  { n: '01', icon: Video, name: '采集或上传视频', detail: '固定机位，设置越线方向', to: '/monitor' },
  { n: '02', icon: ClipboardCheck, name: '核对出餐事件', detail: '复核误计、补录漏计', to: '/events' },
  { n: '03', icon: TrendingUp, name: '形成备餐建议', detail: '录入历史实际出餐量', to: '/planning' },
] as const

/** 图表统一使用自绘浮层，避免多处重复的内联样式对象。 */
function ChartTip({ active, payload, label, unit }: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string | number
  unit: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <span>{label}</span>
      <strong>{payload[0]?.value} {unit}</strong>
    </div>
  )
}

function EventRow({ event }: { event: CountEvent }) {
  return (
    <div className="feed-row">
      <span className="feed-icon" aria-hidden="true"><ScanLine size={14} /></span>
      <span className="feed-body">
        <strong>{event.source === 'AUTO' ? '视觉检测出餐' : '人工补录出餐'}</strong>
        <small>
          {timeText(event.occurredAt)}
          {event.trackId ? ` · 轨迹 #${event.trackId}` : ' · 手工核实'}
        </small>
      </span>
      <StatusTag status={event.reviewStatus} />
    </div>
  )
}

export default function DashboardPage() {
  const { origin } = useWorkspace()
  const navigate = useNavigate()
  const { data, loading, error, refresh } = useAsyncData(() => api.dashboard(origin), [origin])

  const isSim = origin === 'SIMULATION'
  const trend = data?.trend ?? []
  const hourly = data?.hourly ?? []

  // 趋势整体为 0 时画一条贴底的折线没有信息量，改为显示空状态。
  const hasTrend = useMemo(() => trend.some(p => p.count > 0), [trend])
  const hasHourly = useMemo(() => hourly.some(p => p.count > 0), [hourly])

  return (
    <>
      <PageTitle
        title="经营驾驶舱"
        description="从出餐的每一个瞬间，看见更聪明的经营决策。"
        actions={<RefreshButton onClick={() => void refresh()} loading={loading} />}
      />

      {error && (
        <div className="notice notice-danger" role="alert">
          <strong>数据加载失败：</strong>{error}
        </div>
      )}

      {/* ---- 今日指标 ---- */}
      <section className="dash-section">
        <div className="dash-section-head">
          <h2>今日运行概览</h2>
          <span>{data?.date ?? '—'} · {isSim ? '模拟实验数据' : '真实场景数据'}</span>
        </div>

        {loading && !data ? (
          <LoadingBlock height={150} />
        ) : (
          <div className="grid grid-4">
            <MetricCard label="今日有效出餐" value={fmt(data?.todayCount)} unit="次"
              detail="自动初判（非剔除）+ 人工确认" icon={PackageCheck} />
            <MetricCard label="待人工复核" value={fmt(data?.pendingCount)} unit="条"
              detail="等待操作员进一步确认" icon={ScanLine} />
            <MetricCard label="已确认事件" value={fmt(data?.confirmedCount)} unit="条"
              detail="含人工补录的有效事件" icon={ClipboardCheck} />
            <MetricCard label="今日记录备餐" value={fmt(data?.preparedCount)} unit="份"
              detail="来自已登记的实际备餐量" icon={Flame} />
          </div>
        )}
      </section>

      {/* ---- 出餐趋势（主图） ---- */}
      <section className="card dash-section">
        <div className="card-head">
          <div>
            <h3>出餐趋势</h3>
            <p>近 7 日有效出餐事件的变化</p>
          </div>
          <span className="chart-legend"><span aria-hidden="true" />出餐次数</span>
        </div>

        {hasTrend ? (
          <div className="chart chart-lg">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0a0a0a" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#0a0a0a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#efefef" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} dy={10}
                  tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32}
                  tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                <Tooltip content={<ChartTip unit="次" />} cursor={{ stroke: '#d4d4d4' }} />
                <Area type="monotone" dataKey="count" stroke="#0a0a0a" strokeWidth={2}
                  fill="url(#trendFill)" dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff', fill: '#0a0a0a' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            title="暂无出餐数据"
            description="上传一段模拟视频即可跑通完整链路，生成真实的事件记录。"
            icon={BarChart3}
            action={
              <PrimaryButton onClick={() => navigate('/monitor')}>
                前往 AI 监测 <ArrowRight size={14} aria-hidden="true" />
              </PrimaryButton>
            }
          />
        )}

        <p className="dash-foot">
          {hasTrend
            ? '统计依据为已入库的越线事件，人工剔除后会重新计算。'
            : '还没有可用于统计的事件。'}
        </p>
      </section>

      {/* ---- 时段分布 + 最新动态 ---- */}
      <section className="dash-split">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>时段出餐分布</h3>
              <p>00:00—24:00 汇总，用于推断备餐节奏</p>
            </div>
          </div>
          {hasHourly ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#efefef" vertical={false} />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={2} dy={10}
                    tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32}
                    tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                  <Tooltip content={<ChartTip unit="次" />} cursor={{ fill: '#f6f6f6' }} />
                  <Bar dataKey="count" fill="#0a0a0a" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="暂无时段分布"
              description="产生出餐事件后，这里会按小时汇总出餐高峰。"
              icon={BarChart3}
            />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>最新出餐动态</h3>
              <p>仅展示当前数据域的事件</p>
            </div>
            <button className="text-link" onClick={() => navigate('/events')}>
              全部事件 <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>

          {data?.recentEvents?.length ? (
            <div className="feed">
              {data.recentEvents.map(e => <EventRow key={e.id} event={e} />)}
            </div>
          ) : (
            <EmptyState
              title="等待第一条出餐事件"
              description="还没有任何记录。可以先用自带的模拟视频验证整条算法链路。"
              icon={ScanLine}
              action={
                <PrimaryButton onClick={() => navigate('/monitor')}>
                  前往 AI 监测 <ArrowRight size={14} aria-hidden="true" />
                </PrimaryButton>
              }
            />
          )}
        </div>
      </section>

      {/* ---- 首次使用引导 ---- */}
      <section className="card dash-guide">
        <div className="dash-guide-head">
          <h3>用三步完成一次完整的业务验证</h3>
          <p>从录像到备餐建议，每步都可以回溯到原始记录。</p>
        </div>
        <div className="dash-steps">
          {STEPS.map(({ n, icon: Icon, name, detail, to }) => (
            <button key={n} className="dash-step" onClick={() => navigate(to)}>
              <span className="dash-step-num">{n}</span>
              <span className="dash-step-icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="dash-step-text">
                <strong>{name}</strong>
                <small>{detail}</small>
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

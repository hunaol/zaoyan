import { useState } from 'react'
import { BarChart3, CircleAlert, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, dayText, downloadCsv, slotName, timeText } from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import {
  EmptyState, LoadingBlock, MetricCard, PageTitle, PrimaryButton, RefreshButton, SecondaryButton, SectionTitle, StatusTag,
} from '../components/Layout'
import './ReportsPage.css'

/** 图表浮层：与驾驶舱保持同一套自绘样式，避免内联样式对象到处复制。 */
function ChartTip({ active, payload, label }: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="reports-chart-tip">
      <span>{label}</span>
      <strong>{payload[0]?.value} 次</strong>
    </div>
  )
}

export default function ReportsPage() {
  const { origin, notify } = useWorkspace()
  const [date, setDate] = useState(dayText())
  const [exporting, setExporting] = useState(false)
  const { data, loading, error, refresh } = useAsyncData(() => api.daily(origin, date), [origin, date])
  const hourly = data?.hourly || []
  const scopeName = origin === 'SIMULATION' ? '模拟实验' : '授权真实场景'

  const exportFile = async (summary = false) => {
    setExporting(true)
    try {
      await downloadCsv(origin, date, summary)
      notify(summary ? '已导出经营汇总 CSV' : '已导出出餐事件明细 CSV')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageTitle
        title="经营日报与分析"
        description="按营业日期查看有效出餐汇总、出餐时段分布与逐条事件明细。"
        actions={
          <>
            <SecondaryButton disabled={exporting} onClick={() => void exportFile(false)}>
              <Download size={17} aria-hidden="true" /> 事件明细 CSV
            </SecondaryButton>
            <PrimaryButton loading={exporting} onClick={() => void exportFile(true)}>
              <Download size={17} aria-hidden="true" /> 经营汇总 CSV
            </PrimaryButton>
          </>
        }
      />

      {/* ---- 日期与刷新 ---- */}
      <section className="card reports-toolbar">
        <div className="field reports-date">
          <label htmlFor="report-date">营业日期</label>
          <input
            id="report-date"
            className="input"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div className="reports-toolbar-side">
          <span className="reports-scope">数据口径：{scopeName}</span>
          <RefreshButton onClick={() => void refresh()} loading={loading}>重新加载</RefreshButton>
        </div>
      </section>

      {error && (
        <div className="notice notice-danger" role="alert">
          <strong>日报加载失败：</strong>{error}
        </div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {/* ---- 核心指标 ---- */}
          <div className="grid grid-4">
            <MetricCard label="有效出餐总数" value={data?.count || 0} unit="次"
              detail="未剔除的事件数量" icon={BarChart3} />
            <MetricCard label="人工已确认" value={data?.confirmed || 0} unit="次"
              detail="包括补录的记录" icon={FileText} />
            <MetricCard label="待复核事件" value={data?.pending || 0} unit="条"
              detail="需要核验的初判结果" icon={FileSpreadsheet} />
            <MetricCard label="剔除错误事件" value={data?.rejected || 0} unit="条"
              detail="不再计入有效出餐" icon={FileText} />
          </div>

          {/* ---- 台账口径说明 ---- */}
          <div className="notice">
            <FileSpreadsheet size={16} aria-hidden="true" />
            <span>
              台账实际备餐 {data?.preparedQty || 0} 份；已填报核实出餐 {data?.verifiedQty || 0} 份；
              {data?.unverifiedMeals || 0} 个餐次尚未核实。仅已核实餐次的备餐−出餐差额为 {data?.balanceQty || 0} 份，
              不能直接当作实测剩余或浪费量。
            </span>
          </div>

          {!!data?.staleMeals && (
            <div className="notice notice-warn" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                {data.staleMeals} 个餐次的来源发生变化，原核实量保留但不计入当前已核实汇总，请到智能备餐重新核实。
              </span>
            </div>
          )}

          {/* ---- 时段分布 + 备餐台账 ---- */}
          <section className="reports-split">
            <div className="card">
              <SectionTitle label="出餐时段分布" sub="仅当前日期 · 事件经复核剔除后自动调整" />
              <div className="reports-chart" role="img" aria-label={`${date} 出餐时段分布柱状图`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#efefef" vertical={false} />
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={2} dy={10}
                      tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32}
                      tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: '#f6f6f6' }} />
                    <Bar dataKey="count" fill="#0a0a0a" radius={[3, 3, 0, 0]} maxBarSize={18} name="有效出餐" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <SectionTitle label="当日备餐台账" sub="备餐来自人工录入，不会自动推断为实际出餐" />
              {data?.preparations?.length ? (
                <div className="reports-prep">
                  {data.preparations.map(p => (
                    <div className="reports-prep-row" key={p.id}>
                      <div className="reports-prep-cell">
                        <span>{slotName[p.mealSlot]}</span>
                        <strong className="num">{p.preparedQty} <small>份备餐</small></strong>
                      </div>
                      <div className="reports-prep-cell">
                        <span>人工核实出餐</span>
                        <strong className="num">
                          {p.verificationStale ? `${p.actualQty ?? '—'}（待重新核实）` : p.actualQty ?? '未填报'}
                        </strong>
                      </div>
                      <div className="reports-prep-cell">
                        <span>计划备餐</span>
                        <strong className="num">{p.plannedQty} <small>份</small></strong>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="当日尚无备餐记录"
                  description="在「智能备餐」中录入计划和实际备餐量后，才会出现在日报里。"
                  icon={FileSpreadsheet}
                />
              )}
            </div>
          </section>
        </>
      )}

      {/* ---- 事件明细 ---- */}
      {!loading && (
        <section className="card">
          <SectionTitle
            label="日报事件明细"
            sub={`日期：${date} · 数据口径：${scopeName}`}
          />
          {data?.events?.length ? (
            <div className="table-wrap">
              <table className="table" aria-label="日报事件明细">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>来源</th>
                    <th>Track ID</th>
                    <th>审核状态</th>
                    <th>数据域</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map(e => (
                    <tr key={e.id}>
                      <td className="cell-strong">{timeText(e.occurredAt)}</td>
                      <td>{e.source === 'AUTO' ? '视觉越线' : '人工补录'}</td>
                      <td className={e.trackId == null ? 'cell-muted' : 'num'}>{e.trackId ?? '—'}</td>
                      <td><StatusTag status={e.reviewStatus} /></td>
                      <td><StatusTag status={e.origin} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="这个日期暂无出餐事件"
              description="选择其他日期，或运行一次模拟视频检测后查看报表。"
              icon={FileText}
            />
          )}
        </section>
      )}
    </>
  )
}

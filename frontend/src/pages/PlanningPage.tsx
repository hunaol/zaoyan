import { useEffect, useRef, useState } from 'react'
import {
  CalendarClock, CheckCircle2, CircleAlert, Database, Info, Plus, Sparkles, TrendingUp,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, dayText, nextDay, fmt, slotName, timeText, type Forecast, type MealSlot, type Prep } from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import {
  EmptyState, LoadingBlock, PageTitle, PrimaryButton, SecondaryButton, SectionTitle, StatusTag,
} from '../components/Layout'
import SettlementPanel from '../components/SettlementPanel'
import Pagination from '../components/Pagination'
import { useDialog } from '../components/Dialog'
import './PlanningPage.css'

const slots: MealSlot[] = ['BREAKFAST', 'LUNCH', 'DINNER']

/** 图表浮层。未核实的柱为空值，对应行直接不渲染，避免把「空」画成 0。 */
function ChartTip({ active, payload, label }: {
  active?: boolean
  payload?: { name?: string; value?: number | null; color?: string }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(item => item.value != null)
  if (!rows.length) return null
  return (
    <div className="plan-tip">
      <span>{label}</span>
      {rows.map(item => (
        <strong key={item.name}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.name} · {item.value}
        </strong>
      ))}
    </div>
  )
}

export default function PlanningPage() {
  const { origin, notify } = useWorkspace()
  const { confirm } = useDialog()
  const [date, setDate] = useState(dayText())
  const [slot, setSlot] = useState<MealSlot>('LUNCH')
  const [targetDate, setTargetDate] = useState(nextDay())

  const { data, loading, error, refresh } = useAsyncData(() => api.prep(origin), [origin])
  const { data: stalls } = useAsyncData(api.stalls, [])
  const [historyPage, setHistoryPage] = useState(0)
  const { data: historyData, refresh: reloadHistory } = useAsyncData(
    () => api.forecastSearch(origin, slot, historyPage),
    [origin, slot, historyPage]
  )
  const history = historyData?.items

  const [formRevision, setFormRevision] = useState(0)
  const [manualOverride, setManualOverride] = useState(false)
  useEffect(() => { setHistoryPage(0) }, [origin, slot])

  const [planned, setPlanned] = useState('0')
  const [prepared, setPrepared] = useState('0')
  const [actual, setActual] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [predicting, setPredicting] = useState(false)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [buffer, setBuffer] = useState(8)

  const loadedKey = useRef('')
  const workspace = useRef(origin)
  const predictionKey = useRef('')
  const selectedHistory = useRef<string | null>(null)
  workspace.current = origin
  predictionKey.current = `${origin}:${slot}:${targetDate}`

  const busy = !!forecast && ['RUNNING', 'QUEUED'].includes(forecast.status)
  const existingRow = data?.find(p => p.serviceDate === date && p.mealSlot === slot)

  const fill = (row?: Prep) => {
    setFormRevision(row?.revision ?? 0)
    setManualOverride(false)
    setPlanned(String(row?.plannedQty ?? 0))
    setPrepared(String(row?.preparedQty ?? 0))
    setActual(row?.actualQty == null ? '' : String(row.actualQty))
    setNote(row?.note || '')
  }

  useEffect(() => {
    const key = `${origin}:${date}:${slot}`
    if (!data || loadedKey.current === key) return
    fill(data.find(p => p.serviceDate === date && p.mealSlot === slot))
    loadedKey.current = key
  }, [origin, date, slot, data])

  useEffect(() => {
    setForecast(null)
    loadedKey.current = ''
    fill()
  }, [origin])

  useEffect(() => { setForecast(null) }, [origin, slot, targetDate])

  useEffect(() => {
    if (!forecast && history) {
      const latest = history.find(f => f.id === selectedHistory.current && f.targetDate === targetDate)
        || history.find(f => f.targetDate === targetDate)
      selectedHistory.current = null
      if (latest) setForecast(latest)
    }
  }, [history, forecast, targetDate])

  useEffect(() => {
    if (!forecast || !['QUEUED', 'RUNNING'].includes(forecast.status)) return
    let active = true
    let pending = false
    const timer = setInterval(async () => {
      if (pending) return
      pending = true
      try {
        const f = await api.getForecast(forecast.id)
        if (active) {
          setForecast(f)
          if (!['QUEUED', 'RUNNING'].includes(f.status)) void reloadHistory()
        }
      } catch (e) {
        if (active) notify((e as Error).message, 'error')
      } finally {
        pending = false
      }
    }, 1300)
    return () => { active = false; clearInterval(timer) }
  }, [forecast?.id, forecast?.status])

  const editScope = useRef(`${origin}:${date}:${slot}`)
  editScope.current = `${origin}:${date}:${slot}`

  const save = async () => {
    if (!stalls?.[0] || saving) return
    for (const [name, value] of [['计划备餐', planned], ['实际备餐', prepared], ['核实出餐', actual]] as const) {
      if (name === '核实出餐' && !value.trim()) continue
      if (!value.trim() || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100000) {
        notify(`${name}必须为 0—100000 的整数`, 'error')
        return
      }
    }
    const submittedEdit = editScope.current
    setSaving(true)
    try {
      const row = await api.savePrep({
        stallId: stalls[0].id,
        origin,
        serviceDate: date,
        mealSlot: slot,
        plannedQty: Number(planned),
        preparedQty: Number(prepared),
        actualQty: actual.trim() === '' ? null : Number(actual),
        note,
        expectedRevision: formRevision,
        manualOverride,
      })
      if (row.origin !== workspace.current || editScope.current !== submittedEdit) return
      fill(row)
      notify('台账已保存；同日期餐次更新原记录')
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const predict = async () => {
    if (!stalls?.[0] || busy || predicting) return
    const scope = predictionKey.current
    setPredicting(true)
    try {
      const f = await api.forecast({ stallId: stalls[0].id, origin, mealSlot: slot, bufferRate: buffer / 100, targetDate })
      if (predictionKey.current === scope) { setForecast(f); void reloadHistory() }
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setPredicting(false)
    }
  }

  const seed = async () => {
    if (origin !== 'SIMULATION' || !stalls?.[0]) return
    const ok = await confirm({
      title: '填充模拟预测样本？',
      description: '为最近 8 天当前餐次写入模拟台账样本，已有记录会被跳过。这些数字是演示数据，不是食堂销量。',
      confirmText: '填充样本',
      cancelText: '取消',
    })
    if (!ok) return
    setSaving(true)
    try {
      const r = await api.seed(stalls[0].id, slot)
      notify(`新增 ${r.created} 天模拟样本，跳过 ${r.skipped} 天已有记录`)
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const apply = async () => {
    if (!forecast?.targetDate) return
    const old = data?.find(p => p.serviceDate === forecast.targetDate && p.mealSlot === forecast.mealSlot)
    const ok = await confirm({
      title: '采用这条备餐建议？',
      description: `将 ${forecast.recommendedQty} 份写入 ${forecast.targetDate} ${slotName[forecast.mealSlot]} 的计划备餐量。`
        + (old ? '已有计划量会被更新；' : '')
        + '实际备餐量与核实出餐量保持不变。',
      confirmText: '写入计划量',
      cancelText: '取消',
    })
    if (!ok) return
    const submittedScope = origin
    setSaving(true)
    try {
      const row = await api.applyForecast(forecast.id, !!old)
      if (workspace.current !== submittedScope) return
      setDate(row.serviceDate)
      setSlot(row.mealSlot)
      fill(row)
      loadedKey.current = `${origin}:${row.serviceDate}:${row.mealSlot}`
      await refresh()
      notify('建议已写入计划；实际数据未被覆盖')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const chart = [...(data || [])]
    .filter(x => x.mealSlot === slot)
    .slice(0, 14)
    .reverse()
    .map(x => ({
      day: x.serviceDate.slice(5),
      prepared: x.preparedQty,
      actual: x.verificationStale ? null : x.actualQty,
    }))

  return (
    <>
      <PageTitle
        title="智能备餐中心"
        description="录入台账、查看可解释预测，再把建议落实为计划；未核实的数据保持为空。"
      />

      {error && (
        <div className="notice notice-danger" role="alert">
          <strong>台账加载失败：</strong>{error}
        </div>
      )}

      {stalls?.[0] && (
        <SettlementPanel
          stallId={stalls[0].id}
          origin={origin}
          date={date}
          slot={slot}
          existing={existingRow}
          onApplied={p => { fill(p); void refresh() }}
        />
      )}

      {/* ---- 备餐台账登记 / 编辑 ---- */}
      <section className="card">
        <SectionTitle label="备餐台账登记 / 编辑" sub="选择日期和餐次会读取原记录；保存只更新该条台账" />

        <div className="plan-form">
          <div className="field">
            <label htmlFor="prep-date">台账日期</label>
            <input id="prep-date" className="input" type="date" value={date}
              onChange={e => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prep-slot">餐次</label>
            <select id="prep-slot" className="select" value={slot}
              onChange={e => setSlot(e.target.value as MealSlot)}>
              {slots.map(s => <option key={s} value={s}>{slotName[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prep-planned">计划备餐量（份）</label>
            <input id="prep-planned" className="input" type="number" min="0" max="100000" value={planned}
              onChange={e => setPlanned(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prep-prepared">实际备餐量（份）</label>
            <input id="prep-prepared" className="input" type="number" min="0" max="100000" value={prepared}
              onChange={e => setPrepared(e.target.value)} />
          </div>
          <div className="field full">
            <label htmlFor="prep-actual">人工核实出餐量（份，可留空）</label>
            <input id="prep-actual" className="input" type="number" min="0" max="100000"
              placeholder="未核实请留空；0 表示已确认没有出餐" value={actual}
              onChange={e => setActual(e.target.value)} />
          </div>
          <div className="field full">
            <label htmlFor="prep-note">记录说明</label>
            <textarea id="prep-note" className="textarea" value={note} maxLength={300}
              onChange={e => setNote(e.target.value)} />
          </div>
        </div>

        {existingRow?.verificationSource === 'REVIEW_SETTLEMENT' && (
          <div className="plan-override">
            <label className="check">
              <input type="checkbox" checked={manualOverride} onChange={e => setManualOverride(e.target.checked)} />
              我依据独立业务记录重新核实出餐量，改为人工核实来源（需要填写依据）。只修改计划或备餐量不要勾选。
            </label>
          </div>
        )}

        <div className="plan-actions">
          <PrimaryButton disabled={!stalls?.length || loading} loading={saving} onClick={() => void save()}>
            <CheckCircle2 size={16} aria-hidden="true" /> 保存备餐记录
          </PrimaryButton>
        </div>

        {actual !== '' && Number(actual) > Number(prepared) && (
          <div className="notice notice-warn plan-warn plan-notice" role="status">
            <CircleAlert size={15} aria-hidden="true" />
            <div>核实出餐超过登记备餐量，请检查是否漏记补餐。系统保留差额，不会自动改写原始数量。</div>
          </div>
        )}
      </section>

      {/* ---- 备餐需求预测 ---- */}
      <section className="card">
        <SectionTitle label="备餐需求预测" sub={`当前餐次：${slotName[slot]} · 仅使用目标日期之前的人工核实数据`} />

        <div className="plan-predict">
          <div className="field plan-field-sm">
            <label htmlFor="forecast-target">预测目标日期</label>
            <input id="forecast-target" className="input" type="date" value={targetDate}
              onChange={e => setTargetDate(e.target.value)} />
          </div>
          <div className="plan-buffer">
            <label className="field-label" htmlFor="forecast-buffer">
              安全缓冲率 <strong className="num">{buffer}%</strong>
            </label>
            <input id="forecast-buffer" className="range" type="range" min="0" max="30" value={buffer}
              onChange={e => setBuffer(Number(e.target.value))} />
          </div>
          <PrimaryButton loading={predicting || busy} disabled={!stalls?.length || !targetDate}
            onClick={() => void predict()}>
            <Sparkles size={16} aria-hidden="true" /> 计算备餐建议
          </PrimaryButton>
        </div>

        {busy
          ? <LoadingBlock height={140} />
          : forecast?.status === 'COMPLETED'
            ? (
              <>
                <div className="plan-forecast-stats">
                  <div className="stat">
                    <span className="stat-label">预测需求</span>
                    <p className="stat-value">{fmt(forecast.predictedQty)}<span className="stat-unit">份</span></p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">
                      建议备餐
                      <span className="tag">缓冲 {Math.round(forecast.bufferRate * 100)}%</span>
                    </span>
                    <p className="stat-value">{fmt(forecast.recommendedQty)}<span className="stat-unit">份</span></p>
                  </div>
                </div>

                <p className="plan-note">{forecast.explanation}</p>
                <p className="plan-note">
                  目标：{forecast.targetDate} · 样本 {forecast.sampleSize} 天 · 来源日期 {forecast.historyStart}—{forecast.historyEnd} · 本次缓冲 {Math.round(forecast.bufferRate * 100)}%
                </p>
                <p className="plan-note">
                  样本波动参考范围 {forecast.lowerQty}—{forecast.upperQty} 份（不是经校准的概率置信区间）。来源变化的台账不会进入新预测。
                </p>

                <details className="plan-disclosure">
                  <summary>查看本次预测候选输入台账快照</summary>
                  <pre className="plan-snapshot">{forecast.sourceSnapshot || '旧记录未保存来源快照'}</pre>
                </details>

                <div className="plan-actions">
                  <PrimaryButton loading={saving} disabled={!forecast.targetDate || forecast.targetDate < dayText()}
                    onClick={() => void apply()}>
                    采用建议，写入计划量
                  </PrimaryButton>
                </div>
              </>
            )
            : forecast?.status === 'INSUFFICIENT'
              ? (
                <div className="notice plan-notice" role="status">
                  <Info size={15} aria-hidden="true" />
                  <div>{forecast.explanation}</div>
                </div>
              )
              : forecast?.status === 'FAILED'
                ? <div className="notice notice-danger" role="alert"><div>{forecast.errorMessage}</div></div>
                : (
                  <EmptyState
                    title="等待生成备餐建议"
                    description="至少需要目标日期之前 3 天同餐次人工核实出餐数据。"
                    icon={TrendingUp}
                  />
                )}
      </section>

      {/* ---- 对照图 + 历史台账 ---- */}
      <div className="plan-split">
        <section className="card">
          <SectionTitle
            label="备餐与核实出餐对照"
            sub="最近 14 条同餐次台账；未核实为空白，不会画成真实的零销量"
            action={chart.length ? (
              <span className="plan-legend">
                <span><i className="is-prepared" aria-hidden="true" />实际备餐</span>
                <span><i className="is-actual" aria-hidden="true" />人工核实出餐</span>
              </span>
            ) : undefined}
          />
          {chart.length ? (
            <div className="plan-chart" role="img" aria-label={`${slotName[slot]}备餐与核实出餐对照柱状图`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: -22, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke="#efefef" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} dy={8}
                    tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38}
                    tick={{ fontSize: 11, fill: '#a3a3a3' }} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: '#f6f6f6' }} />
                  <Bar name="实际备餐" dataKey="prepared" fill="#d4d4d4" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar name="人工核实出餐" dataKey="actual" fill="#0a0a0a" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="尚无备餐台账"
              description="保存第一条台账，或者在模拟工作区填充明确标记的演示样本。"
              icon={Database}
            />
          )}
        </section>

        <section className="card">
          <SectionTitle
            label="历史备餐台账"
            sub="计划、实际备餐、核实出餐是不同字段；差额不是实测浪费"
            action={origin === 'SIMULATION' ? (
              <SecondaryButton disabled={saving || !stalls?.length} onClick={() => void seed()}>
                <Plus size={15} aria-hidden="true" /> 填充模拟预测样本
              </SecondaryButton>
            ) : undefined}
          />

          {loading
            ? <LoadingBlock />
            : data?.length
              ? (
                <div className="table-wrap">
                  <table className="table" aria-label="历史备餐台账">
                    <thead>
                      <tr>
                        <th>日期</th><th>餐次</th><th>计划</th><th>实际备餐</th>
                        <th>核实出餐</th><th>差额</th><th>备注</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(p => (
                        <tr key={p.id} data-selected={p.serviceDate === date && p.mealSlot === slot}>
                          <td className="cell-strong num">{p.serviceDate}</td>
                          <td>{slotName[p.mealSlot]}</td>
                          <td className="num">{p.plannedQty}</td>
                          <td className="num">{p.preparedQty}</td>
                          <td>
                            {p.verificationStale
                              ? `${p.actualQty ?? '—'}（需重新核实）`
                              : p.actualQty ?? '未核实'}
                            {p.verificationSource === 'REVIEW_SETTLEMENT' && (
                              <small className="plan-cell-sub">
                                事件结算：{p.sourceEventCount} 次 × {p.portionsPerEvent} 份/次
                              </small>
                            )}
                          </td>
                          <td className="num">
                            {p.actualQty == null || p.verificationStale ? '—' : p.preparedQty - p.actualQty}
                          </td>
                          <td>{p.note || '—'}</td>
                          <td>
                            <button
                              className="plan-action"
                              onClick={() => {
                                setDate(p.serviceDate)
                                setSlot(p.mealSlot)
                                fill(p)
                                loadedKey.current = `${origin}:${p.serviceDate}:${p.mealSlot}`
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                            >
                              编辑
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
              : (
                <EmptyState
                  title="暂无历史台账"
                  description="填写数据后保存即可。"
                  icon={CalendarClock}
                />
              )}
        </section>
      </div>

      {/* ---- 预测记录 ---- */}
      <section className="card plan-history">
        <SectionTitle
          label="预测记录"
          sub="保存每次建议的目标日期、样本范围、缓冲率及解释；刷新后仍可查询"
          action={<SecondaryButton onClick={() => void reloadHistory()}>刷新记录</SecondaryButton>}
        />
        {history?.length
          ? (
            <div className="table-wrap">
              <table className="table" aria-label="预测记录">
                <thead>
                  <tr>
                    <th>生成时间</th><th>目标日期</th><th>状态</th><th>样本数</th><th>建议备餐</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(f => (
                    <tr key={f.id}>
                      <td className="num">{timeText(f.createdAt)}</td>
                      <td className="num">{f.targetDate || '旧记录未指定'}</td>
                      <td><StatusTag status={f.status} /></td>
                      <td className="num">{f.sampleSize ?? '—'}</td>
                      <td className="num">{f.recommendedQty ?? '—'}</td>
                      <td>
                        <button
                          className="plan-action"
                          onClick={() => {
                            selectedHistory.current = f.id
                            if (f.targetDate) setTargetDate(f.targetDate)
                            setForecast(f)
                          }}
                        >
                          查看结果
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : <p className="plan-note">当前餐次暂无预测记录。</p>}
        <Pagination page={historyPage} pages={historyData?.pages || 0} total={historyData?.total || 0} onChange={setHistoryPage} />
      </section>

      {/* ---- 预测口径（页尾轻量说明，v1 这里是一块半屏高的深绿大卡） ---- */}
      <section className="card plan-rules">
        <p className="overline">Forecast Rule / 预测口径</p>
        <p className="plan-rules-lead">
          未核实的数据，不会进入预测。建议备餐只来自目标日期之前的人工核实出餐数据；未核实的数据保持为空，不会画成真实的零销量。
        </p>
        <ol className="plan-rules-list">
          <li><span aria-hidden="true">01</span>仅使用目标日期之前的人工核实数据</li>
          <li><span aria-hidden="true">02</span>至少需要目标日期之前 3 天同餐次人工核实出餐数据</li>
          <li><span aria-hidden="true">03</span>计划、实际备餐、核实出餐是不同字段；差额不是实测浪费</li>
        </ol>
      </section>
    </>
  )
}

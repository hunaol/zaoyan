import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api, timeText, slotName, type Origin, type MealSlot, type Prep, type Settlement, type Coverage } from '../lib/api'
import { useWorkspace } from '../lib/context'
import { PrimaryButton, SectionTitle } from './Layout'
import './SettlementPanel.css'

/** 结算草稿 → 人工确认 → 写入台账。草稿 ID 存 sessionStorage，刷新页面后仍可继续确认。 */
export default function SettlementPanel({ stallId, origin, date, slot, existing, onApplied }: {
  stallId: number; origin: Origin; date: string; slot: MealSlot
  existing?: Prep; onApplied: (p: Prep) => void
}) {
  const { notify } = useWorkspace()
  const [ratio, setRatio] = useState(1)
  const [draft, setDraft] = useState<Settlement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [coverage, setCoverage] = useState(false)
  const [units, setUnits] = useState(false)
  const [zero, setZero] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [note, setNote] = useState('')
  const key = `zaoyan-settlement:${origin}:${stallId}:${date}:${slot}`
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    let active = true
    setDraft(null)
    setError('')
    setCoverage(false)
    setUnits(false)
    setZero(false)
    setOverwrite(false)
    setNote('')
    setRatio(1)
    const id = sessionStorage.getItem(key)
    if (id) {
      void api.getSettlement(id)
        .then(d => {
          if (active && d.origin === origin) { setDraft(d); setRatio(d.portionsPerEvent) }
        })
        .catch(() => { sessionStorage.removeItem(key) })
    }
    return () => { active = false }
  }, [key])

  const create = async () => {
    const scope = key
    setBusy(true)
    setError('')
    try {
      const d = await api.settlement({ stallId, origin, serviceDate: date, mealSlot: slot, portionsPerEvent: ratio })
      if (keyRef.current !== scope) return
      setDraft(d)
      sessionStorage.setItem(key, d.id)
      setCoverage(false)
      setUnits(false)
      setZero(false)
      setOverwrite(false)
    } catch (e) {
      if (keyRef.current === scope) setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!draft) return
    const scope = key
    setBusy(true)
    setError('')
    try {
      const p = await api.confirmSettlement(draft.id, {
        coverageConfirmed: coverage,
        unitsConfirmed: units,
        zeroConfirmed: zero,
        overwrite,
        note: note.trim(),
      })
      if (keyRef.current !== scope) return
      setDraft({ ...draft, confirmedAt: new Date().toISOString(), confirmationNote: note })
      onApplied(p)
      notify('复核汇总已确认进入台账；计划量和实际备餐量未改动')
    } catch (e) {
      if (keyRef.current === scope) setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  let recordings: Coverage[] = []
  try { recordings = JSON.parse(draft?.coverageJson || '[]') as Coverage[] } catch {}
  const done = !!draft?.confirmedAt

  return (
    <section className="card settle-panel">
      <SectionTitle
        label="从事件复核生成备餐台账"
        sub={`${date} · ${slotName[slot]} · 先生成草稿，再确认覆盖范围和换算口径`}
      />

      {existing?.verificationStale && (
        <div className="notice notice-warn" role="status">
          <div>
            这条台账的源事件、统计版本或餐次发生过变化。原核实量 {existing.actualQty} 份保留，但已暂停用于新预测；请重新结算或在台账中明确人工重新核实。
          </div>
        </div>
      )}

      <div className="settle-block">
        <div className="settle-toolbar">
          <div className="settle-ratio">
            <label htmlFor="settle-ratio">每次容器交付对应</label>
            <input id="settle-ratio" className="input num" type="number" disabled={busy} min="1" max="50" step="1"
              value={ratio}
              onChange={e => { setRatio(Number(e.target.value)); setDraft(null); sessionStorage.removeItem(key) }} />
            <span>份餐</span>
          </div>
          <PrimaryButton
            loading={busy}
            disabled={!date || !Number.isInteger(ratio) || ratio < 1 || ratio > 50}
            onClick={() => void create()}
          >
            {draft ? '重新生成草稿' : '生成复核汇总草稿'}
          </PrimaryButton>
        </div>

        <p className="settle-help">
          默认 1 次容器交付 = 1 份餐，仅在你确认后用于换算。一个托盘含多份且份数不固定时，请直接人工核实总份数，不能使用统一倍率自动推算。
        </p>
      </div>

      {error && <div className="notice notice-danger" role="alert"><div>{error}</div></div>}

      {draft && (
        <>
          <div className="settle-block">
            <div className="settle-metrics">
              <div className="stat">
                <span className="stat-label">已确认事件</span>
                <p className="stat-value">{draft.confirmedCount}<span className="stat-unit">次</span></p>
              </div>
              <div className="stat">
                <span className="stat-label">待复核</span>
                <p className="stat-value">{draft.pendingCount}<span className="stat-unit">条</span></p>
              </div>
              <div className="stat">
                <span className="stat-label">已剔除 / 非统计版本</span>
                <p className="stat-value num">{draft.rejectedCount} / {draft.excludedCount}</p>
              </div>
              <div className="stat">
                <span className="stat-label">草稿核实出餐</span>
                <p className="stat-value">{draft.suggestedQty}<span className="stat-unit">份</span></p>
              </div>
            </div>

            <p className="settle-note">
              统计时段：{timeText(draft.windowStart)} 至 {timeText(draft.windowEnd)}（结束时刻不包含）；
              来源快照 {draft.sourceDigest.slice(0, 12)}…；有效期至 {timeText(draft.expiresAt)}。
            </p>
          </div>

          {draft.pendingCount > 0 && (
            <div className="notice notice-warn" role="status">
              <div>
                还有 {draft.pendingCount} 条待复核，不能结算。
                <Link className="settle-link" to={`/events?date=${date}&status=PENDING`}>前往事件复核</Link>，完成后重新生成草稿。
              </div>
            </div>
          )}

          <details className="settle-disclosure">
            <summary>检查录像覆盖与统计版本（{recordings.length} 个相关任务）</summary>
            <div className="table-wrap">
              <table className="table" aria-label="录像覆盖与统计版本">
                <thead>
                  <tr>
                    <th>录像 / 会话</th><th>开始</th><th>结束</th><th>参与统计</th><th>核查</th>
                  </tr>
                </thead>
                <tbody>
                  {recordings.map(t => (
                    <tr key={t.taskId}>
                      <td>{t.filename}</td>
                      <td className="num">{timeText(t.from)}</td>
                      <td className="num">{t.durationKnown ? timeText(t.until) : '旧任务时长未知'}</td>
                      <td>{t.statsIncluded ? '是' : '否'}</td>
                      <td><Link className="settle-link" to={`/events?task=${t.taskId}`}>事件</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!recordings.length && (
              <p className="settle-note">
                没有相关录像覆盖信息，只有人工记录也需要独立确认完整营业数据；不能因为没有记录就断定零出餐。
              </p>
            )}
          </details>

          {done ? (
            <div className="notice notice-ok settle-notice" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <div>此草稿已确认并保留来源；时间 {timeText(draft.confirmedAt)}。{draft.confirmationNote}</div>
            </div>
          ) : (
            <>
              <div className="settle-checks">
                <label className="check">
                  <input type="checkbox" checked={coverage} onChange={e => setCoverage(e.target.checked)} />
                  我已核实该餐次全部交付均被覆盖，无缺失时段、重叠录像重复统计；必要时已结合人工记录核对。
                </label>
                <label className="check">
                  <input type="checkbox" checked={units} onChange={e => setUnits(e.target.checked)} />
                  我已剔除空容器、重复往返等误计，并确认所有有效事件适用 {draft.portionsPerEvent} 份/次的统一换算。
                </label>
                {draft.confirmedCount === 0 && (
                  <label className="check">
                    <input type="checkbox" checked={zero} onChange={e => setZero(e.target.checked)} />
                    我确认该餐次实际出餐确实为 0，不是相机停机或没有采集。
                  </label>
                )}
                {existing?.actualQty != null && (
                  <label className="check">
                    <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                    当前已有核实量 {existing.actualQty} 份；同意只更新核实出餐量及依据，保留计划和实际备餐。
                  </label>
                )}
              </div>

              <div className="field">
                <label htmlFor="settlement-note">核实依据（必填）</label>
                <textarea id="settlement-note" className="textarea" value={note} maxLength={300}
                  onChange={e => setNote(e.target.value)}
                  placeholder="记录核实范围、缺段补录依据与异常处理。" />
              </div>

              <div className="settle-actions">
                <PrimaryButton
                  loading={busy}
                  disabled={draft.pendingCount > 0 || !coverage || !units || !note.trim()
                    || (draft.confirmedCount === 0 && !zero)
                    || (existing?.actualQty != null && !overwrite)}
                  onClick={() => void confirm()}
                >
                  确认汇总，写入台账与预测依据
                </PrimaryButton>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

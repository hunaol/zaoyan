import { useEffect, useRef, useState } from 'react'
import { CircleAlert, ClipboardCheck, Info, Play, Plus, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  api, authorizedBlob, timeText, toBeijingInstant, reviewReasons,
  type CountEvent, type ReviewStatus, type VideoTask,
} from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import {
  EmptyState, LoadingBlock, PageTitle, PrimaryButton, RefreshButton, RiskTags,
  SecondaryButton, SectionTitle, StatusTag,
} from '../components/Layout'
import Pagination from '../components/Pagination'
import AuditPanel, { BusinessAuditPanel } from '../components/AuditPanel'
import VideoReviewDialog from '../components/VideoReviewDialog'
import { useDialog } from '../components/Dialog'
import './EventsPage.css'

const FILTERS = [
  ['ALL', '全部'],
  ['PENDING', '待复核'],
  ['CONFIRMED', '已确认'],
  ['REJECTED', '已剔除'],
] as const

const TABS = [
  ['events', '事件台账'],
  ['audit', '完整复核审计'],
  ['business', '结算与版本审计'],
] as const

/** 单条事件的证据与复核：回放录像、填写依据、保存后刷新审计轨迹。 */
function EventDetails({ event, onClose, onSaved, onVideo }: {
  event: CountEvent; onClose: () => void; onSaved: () => void; onVideo: (t: VideoTask) => void
}) {
  const { origin, notify } = useWorkspace()
  const player = useRef<HTMLVideoElement>(null)
  const alive = useRef(true)
  const [note, setNote] = useState(event.note || '')
  const [reason, setReason] = useState(event.reviewReason || 'NORMAL')
  const [status, setStatus] = useState(event.reviewStatus)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [task, setTask] = useState<VideoTask | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [auditKey, setAuditKey] = useState(0)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setLoading(true)
    void (async () => {
      try {
        if (!event.taskId) return
        const t = await api.task(event.taskId)
        if (!active) return
        setTask(t)
        if (t.hasResultVideo || t.hasSourceVideo) {
          const blob = await authorizedBlob(`/tasks/${t.id}/video?source=${!t.hasResultVideo}`)
          if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
        }
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [event.id])

  const review = async (next: ReviewStatus) => {
    if (!note.trim()) {
      setError('请说明复核依据，尤其是空容器、往返和嵌套目标。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.review(event.id, next, `[${reviewReasons[reason] || reason}] ${note}`.slice(0, 300), reason)
      if (!alive.current) return
      setStatus(next)
      setAuditKey(v => v + 1)
      notify('复核结果与依据已保存；来源台账将提示重新核实')
      onSaved()
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="backdrop">
      <div className="modal events-modal events-dialog" role="dialog" aria-modal="true" aria-labelledby="event-title">
        <div className="modal-head">
          <h2 id="event-title">事件 #{event.id} · 证据与复核</h2>
          <button className="icon-btn" aria-label="关闭详情" disabled={busy} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body stack">
          <div className="events-meta">
            <StatusTag status={status} />
            <span className="num">{timeText(event.occurredAt)}</span>
            <span>{event.statsIncluded ? '当前有效统计版本' : '该分析版本不参与统计'}</span>
          </div>

          {event.riskReasons?.trim() && (
            <div className="notice notice-warn events-notice" role="status">
              <CircleAlert size={15} aria-hidden="true" />
              <div>
                <RiskTags value={event.riskReasons} />
                <p className="events-risk-note">以上是待核查提示，不是已证实的错误。</p>
              </div>
            </div>
          )}

          {loading
            ? <LoadingBlock height={100} />
            : url
              ? (
                <video
                  ref={player}
                  className="events-video"
                  src={url}
                  controls
                  playsInline
                  onLoadedMetadata={() => {
                    if (player.current) player.current.currentTime = Math.max(0, (event.offsetSeconds || 0) - 1)
                  }}
                />
              )
              : (
                <p className="events-hint">
                  {task?.mode === 'LIVE'
                    ? '实时监测按隐私策略未保存原始帧，仅保留事件和规则快照。'
                    : '无可回放录像，请结合补录或业务记录核实。'}
                </p>
              )}

          {task?.mode === 'UPLOAD' && task.status === 'COMPLETED' && (
            <div className="events-actions">
              <SecondaryButton onClick={() => onVideo(task)}>逐段查看此录像 / 在播放位置补录</SecondaryButton>
            </div>
          )}

          <div className="field">
            <label htmlFor="review-reason">复核分类</label>
            <select id="review-reason" className="select" value={reason} onChange={e => setReason(e.target.value)}>
              {Object.entries(reviewReasons).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="review-note">本次复核说明（必填）</label>
            <textarea id="review-note" className="textarea" maxLength={240} value={note}
              onChange={e => setNote(e.target.value)} />
          </div>

          {error && <div className="notice notice-danger" role="alert"><div>{error}</div></div>}

          <div className="events-actions">
            <PrimaryButton loading={busy} onClick={() => void review('CONFIRMED')}>确认有效</PrimaryButton>
            <SecondaryButton disabled={busy} onClick={() => void review('REJECTED')}>剔除误计</SecondaryButton>
            <SecondaryButton disabled={busy} onClick={() => void review('PENDING')}>退回待复核</SecondaryButton>
          </div>

          <h3>这条事件的完整复核历史</h3>
          <AuditPanel key={auditKey} origin={origin} eventId={event.id} />
        </div>
      </div>
    </div>
  )
}

export default function EventsPage() {
  const { origin, notify } = useWorkspace()
  const { prompt } = useDialog()
  const [params, setParams] = useSearchParams()
  const scope = useRef(origin)
  scope.current = origin

  const taskId = params.get('taskId') || params.get('task') || ''
  const initial = params.get('status')
  const [filter, setFilter] = useState<'ALL' | ReviewStatus>(
    initial && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(initial) ? initial as ReviewStatus : 'ALL'
  )
  const [date, setDate] = useState(params.get('date') || '')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [tab, setTab] = useState<'events' | 'audit' | 'business'>('events')
  const [saving, setSaving] = useState(false)
  const [evidence, setEvidence] = useState<CountEvent | null>(null)
  const [videoTask, setVideoTask] = useState<VideoTask | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [time, setTime] = useState('')
  const manualSubmission = useRef<{ key: string; occurredAt: string; note: string } | null>(null)

  const { data, loading, error, refresh } = useAsyncData(
    () => api.searchEvents(origin, { status: filter === 'ALL' ? undefined : filter, date, q: query, page, taskId }),
    [origin, filter, date, query, page, taskId]
  )
  const { data: stalls } = useAsyncData(api.stalls, [])
  const { data: filteredTask, error: taskError } = useAsyncData(
    () => taskId ? api.task(taskId) : Promise.resolve(null),
    [origin, taskId]
  )

  useEffect(() => {
    setEvidence(null); setVideoTask(null); setAdding(false); setSelected([]); setPage(0); setTab('events')
  }, [origin, taskId])

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { setPage(0); setSelected([]) }, [filter, date, query])
  useEffect(() => { setSelected([]) }, [page])
  useEffect(() => {
    if (data && !loading && page > 0 && page >= data.pages) setPage(Math.max(0, data.pages - 1))
  }, [data?.pages, page, loading])

  const rows = data?.items || []

  const batch = async (status: ReviewStatus) => {
    if (!selected.length || saving) return
    const reason = await prompt({
      title: `批量${status === 'CONFIRMED' ? '确认' : '剔除'} ${selected.length} 条事件`,
      description: '请先逐条查看证据再批量处理。填写的依据会写入复核审计。',
      label: '复核依据',
      placeholder: status === 'CONFIRMED' ? '例如：已核对录像，确认为独立一次交付' : '例如：同一次交付被重复计数',
      maxLength: 300,
      required: true,
      danger: status === 'REJECTED',
      confirmText: status === 'CONFIRMED' ? '确认有效' : '剔除误计',
    })
    if (!reason) return
    const submitted = origin
    setSaving(true)
    try {
      const result = await api.batchReview(origin, selected, status, reason.slice(0, 300))
      if (scope.current !== submitted) return
      setSelected([])
      notify(`已保存 ${result.changed} 条复核修改`)
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const add = () => {
    if (filteredTask?.origin === origin && filteredTask.mode === 'UPLOAD' && filteredTask.status === 'COMPLETED') {
      setVideoTask(filteredTask)
      return
    }
    setAdding(true)
    manualSubmission.current = null
  }

  const manual = async () => {
    if (!stalls?.[0] || !note.trim() || saving) return
    const submitted = origin
    setSaving(true)
    if (!manualSubmission.current) {
      manualSubmission.current = {
        key: globalThis.crypto.randomUUID(),
        occurredAt: time ? toBeijingInstant(time) : new Date().toISOString(),
        note: note.trim(),
      }
    }
    try {
      await api.manual({
        stallId: stalls[0].id,
        origin,
        occurredAt: manualSubmission.current.occurredAt,
        note: manualSubmission.current.note,
        requestKey: manualSubmission.current.key,
      })
      if (scope.current !== submitted) return
      setAdding(false)
      setNote('')
      setTime('')
      manualSubmission.current = null
      notify('已补录一次人工核实交付')
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasSource = filteredTask?.origin === origin && filteredTask.mode === 'UPLOAD'
    && (filteredTask.hasSourceVideo || filteredTask.hasResultVideo)

  return (
    <>
      <PageTitle
        eyebrow="REVIEW CENTER / 事件中心"
        title="事件与人工复核"
        description="确认每一次独立交付，保留原始判断、人工依据和分析版本。"
        actions={
          <>
            <RefreshButton onClick={() => void refresh()} loading={loading} />
            <PrimaryButton onClick={add} disabled={!stalls?.length}>
              <Plus size={17} aria-hidden="true" /> 人工补录
            </PrimaryButton>
          </>
        }
      />

      <div className="notice events-notice">
        <Info size={15} aria-hidden="true" />
        <span>统计口径是“容器交付次数”，并非自动确认的餐食份数。非统计版本保留可查，但不进入日报或结算；待复核记录不进入核实台账。</span>
      </div>

      <div className="card">
        <SectionTitle label="事件、复核与业务留痕" />

        <div className="segmented segmented-lg events-tabs" role="tablist" aria-label="事件中心视图">
          {TABS.map(([v, n]) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>
              {n}
            </button>
          ))}
        </div>

        {tab === 'audit'
          ? <AuditPanel key={origin} origin={origin} />
          : tab === 'business'
            ? <BusinessAuditPanel key={origin} origin={origin} />
            : (
              <>
                <div className="events-filters">
                  <div className="segmented" role="group" aria-label="复核状态筛选">
                    {FILTERS.map(([s, n]) => (
                      <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input events-search"
                    value={search}
                    placeholder="事件号 / 跟踪 ID / 任务 / 备注"
                    aria-label="搜索事件"
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                <div className="events-tools">
                  <label>
                    营业日期
                    <input className="input events-date" type="date" value={date}
                      onChange={e => setDate(e.target.value)} />
                  </label>
                  {date && <button className="text-link" onClick={() => setDate('')}>全部日期</button>}
                  {taskId && (
                    <>
                      <span className="events-task">任务 {taskId.slice(0, 12)}…</span>
                      <button className="text-link" onClick={() => setParams({})}>清除任务筛选</button>
                    </>
                  )}
                  {hasSource && filteredTask && (
                    <SecondaryButton onClick={() => setVideoTask(filteredTask)}>
                      <Play size={15} aria-hidden="true" /> 查看整段录像 / 定位补录
                    </SecondaryButton>
                  )}
                </div>

                {taskError && <p className="events-error">{taskError}</p>}
                {filteredTask && filteredTask.origin !== origin && (
                  <div className="notice notice-warn events-alert" role="status">
                    <div>该任务不属于当前工作区，请切换数据域或清除任务筛选。</div>
                  </div>
                )}

                {selected.length > 0 && (
                  <div className="events-batch">
                    <strong>已选 <span className="num">{selected.length}</span> 条</strong>
                    <SecondaryButton disabled={saving} onClick={() => void batch('CONFIRMED')}>批量确认</SecondaryButton>
                    <SecondaryButton disabled={saving} onClick={() => void batch('REJECTED')}>批量剔除</SecondaryButton>
                    <button className="text-link" onClick={() => setSelected([])}>取消选择</button>
                  </div>
                )}

                <div className="events-ledger">
                  {loading
                    ? <LoadingBlock />
                    : error
                      ? <div className="notice notice-danger" role="alert"><div>{error}</div></div>
                      : rows.length
                        ? (
                          <div className="table-wrap">
                            <table className="table" aria-label="出餐事件台账">
                              <thead>
                                <tr>
                                  <th className="events-check-cell">
                                    <input className="events-check" aria-label="选择本页全部事件" type="checkbox"
                                      checked={rows.every(e => selected.includes(e.id))}
                                      onChange={e => setSelected(e.target.checked ? rows.map(x => x.id) : [])} />
                                  </th>
                                  <th>来源 / 事件</th>
                                  <th>时间</th>
                                  <th>目标 / 视频位置</th>
                                  <th>状态与统计口径</th>
                                  <th>核查提示</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(e => (
                                  <tr key={e.id} data-selected={selected.includes(e.id) ? 'true' : undefined}>
                                    <td className="events-check-cell">
                                      <input className="events-check" aria-label={`选择事件 ${e.id}`} type="checkbox"
                                        checked={selected.includes(e.id)}
                                        onChange={x => setSelected(old => x.target.checked ? [...old, e.id] : old.filter(v => v !== e.id))} />
                                    </td>
                                    <td className="cell-strong">#{e.id} · {e.source === 'AUTO' ? '视觉' : '人工'}</td>
                                    <td className="num">{timeText(e.occurredAt)}</td>
                                    <td>
                                      {e.targetLabel || e.trackId || '人工'}
                                      {e.offsetSeconds != null && (<small className="cell-muted"> · {e.offsetSeconds.toFixed(2)} 秒</small>)}
                                    </td>
                                    <td>
                                      <StatusTag status={e.reviewStatus} />
                                      {!e.statsIncluded && <small className="events-flag">旧版 / 未启用，不参与统计</small>}
                                    </td>
                                    <td className="events-risk"><RiskTags value={e.riskReasons} /></td>
                                    <td>
                                      <button className="btn btn-ghost btn-sm" onClick={() => setEvidence(e)}>证据与复核</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                        : (
                          <EmptyState
                            title="没有符合条件的事件"
                            description={taskId
                              ? '没有自动事件也可以通过“查看整段录像”检查漏计。'
                              : '调整筛选，或先分析视频。'}
                            icon={ClipboardCheck}
                          />
                        )}

                  <Pagination page={page} pages={data?.pages || 0} total={data?.total || 0} loading={loading} onChange={setPage} />
                </div>
              </>
            )}
      </div>

      {adding && (
        <div className="backdrop">
          <div className="modal events-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-title">
            <div className="modal-head">
              <h2 id="manual-title">人工补录一次交付</h2>
              <button className="icon-btn" aria-label="关闭补录" disabled={saving} onClick={() => setAdding(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="modal-body stack">
              <p className="events-hint">没有录像定位的线下补录。视频漏计请先打开对应录像，在播放位置补录。</p>

              <div className="field">
                <label htmlFor="manual-time">发生时间（北京时间，留空为当前时间）</label>
                <input id="manual-time" className="input" type="datetime-local" disabled={saving || !!manualSubmission.current}
                  value={time}
                  onChange={e => { setTime(e.target.value); manualSubmission.current = null }} />
              </div>

              <div className="field">
                <label htmlFor="manual-note">核实依据（必填）</label>
                <textarea id="manual-note" className="textarea" disabled={saving || !!manualSubmission.current}
                  value={note} maxLength={300}
                  onChange={e => { setNote(e.target.value); manualSubmission.current = null }} />
              </div>

              <div className="events-actions">
                <PrimaryButton loading={saving} disabled={!note.trim()} onClick={() => void manual()}>
                  {manualSubmission.current ? '重试确认同一次补录' : '保存核实事件'}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {evidence && (
        <EventDetails
          key={`${origin}:${evidence.id}`}
          event={evidence}
          onClose={() => setEvidence(null)}
          onSaved={() => void refresh()}
          onVideo={t => { setEvidence(null); setVideoTask(t) }}
        />
      )}

      {videoTask && (
        <VideoReviewDialog
          key={`${origin}:${videoTask.id}`}
          task={videoTask}
          onClose={() => setVideoTask(null)}
          onSaved={() => void refresh()}
        />
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api, authorizedBlob, timeText, type VideoTask } from '../lib/api'
import { useWorkspace, useAsyncData } from '../lib/context'
import { PrimaryButton, RiskTags, SecondaryButton, LoadingBlock, StatusTag } from './Layout'
import Pagination from './Pagination'
import './VideoReviewDialog.css'

/** Works for a completed video with ZERO automatic events as well as an existing event's video. */
export default function VideoReviewDialog({ task, onClose, onSaved }: {
  task: VideoTask; onClose: () => void; onSaved: () => void
}) {
  const { origin, notify } = useWorkspace()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState(!task.hasResultVideo)
  const [note, setNote] = useState('')
  const [position, setPosition] = useState(0)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(0)
  const player = useRef<HTMLVideoElement>(null)
  const submission = useRef<{ key: string; offset: number; note: string } | null>(null)
  const alive = useRef(true)

  const { data, refresh, loading } = useAsyncData(
    () => api.searchEvents(origin, { taskId: task.id, page }),
    [origin, task.id, page]
  )

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setError('')
    void authorizedBlob(`/tasks/${task.id}/video?source=${source}`)
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(e => { if (active) setError(e.message) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [task.id, source])

  const save = async () => {
    if (saving || !player.current || !note.trim()) return
    player.current.pause()
    setSaving(true)
    setError('')
    // Freeze the whole payload, not just its key, while a response might have been lost.
    if (!submission.current) {
      submission.current = {
        key: globalThis.crypto.randomUUID(),
        offset: player.current.currentTime,
        note: note.trim(),
      }
    }
    const { offset, key, note: submittedNote } = submission.current
    try {
      await api.manual({
        stallId: task.stallId,
        origin: task.origin,
        taskId: task.id,
        offsetSeconds: offset,
        occurredAt: new Date(new Date(task.recordedAt).getTime() + offset * 1000).toISOString(),
        note: submittedNote,
        requestKey: key,
      })
      if (!alive.current) return
      submission.current = null
      setNote('')
      notify(`已在 ${offset.toFixed(2)} 秒补录；原有记录保留`)
      await refresh()
      onSaved()
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  return (
    <>
      <div className="backdrop" aria-hidden="true" />

      <div className="modal videorev-modal" role="dialog" aria-modal="true" aria-labelledby="video-review-title">
        <div className="modal-head">
          <h2 id="video-review-title">逐段复核与视频定位补录</h2>
          <button
            className="icon-btn videorev-close"
            aria-label="关闭视频复核"
            disabled={saving}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <p className="videorev-meta">
            {task.originalFilename} · 拍摄开始 {timeText(task.recordedAt)} ·{' '}
            <strong>{task.statsIncluded ? '当前统计版本' : '此版本不参与统计'}</strong>
          </p>

          <div className="notice">
            每次补录代表一次独立交付。发现空容器或嵌套重复，请剔除对应事件；同一份餐来回移动不要反复补录。
          </div>

          {error && <div className="notice notice-danger" role="alert">{error}</div>}

          {url ? (
            <div className="videorev-player">
              <video
                ref={player}
                src={url}
                controls
                playsInline
                onTimeUpdate={() => { setPosition(player.current?.currentTime || 0) }}
              />
            </div>
          ) : !error && <LoadingBlock height={180} />}

          <div className="videorev-toolbar">
            <strong className="num">当前视频位置：{position.toFixed(2)} 秒</strong>
            {task.hasResultVideo && task.hasSourceVideo && (
              <SecondaryButton disabled={saving} onClick={() => setSource(v => !v)}>
                切换为{source ? '标注结果' : '原始录像'}
              </SecondaryButton>
            )}
          </div>

          <div className="field">
            <label htmlFor="video-review-note">补录依据 / 原因（必填）</label>
            <textarea
              id="video-review-note"
              className="textarea"
              maxLength={300}
              disabled={saving || !!submission.current}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例如：当前画面右侧餐盒被遮挡，已人工确认完成一次交付。"
            />
          </div>

          {task.durationSeconds == null && (
            <p className="videorev-warn">旧任务没有可靠视频时长，请先重新分析再定位补录。</p>
          )}

          <h3 className="videorev-subhead">本录像事件（包含补录与已剔除记录）</h3>

          {loading ? (
            <LoadingBlock height={80} />
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="本录像的出餐事件">
                <thead>
                  <tr>
                    <th>事件</th>
                    <th>位置</th>
                    <th>状态</th>
                    <th>复核提示</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map(e => (
                    <tr key={e.id}>
                      <td>
                        <strong className="cell-strong num">#{e.id}</strong>
                        <small className="cell-muted"> · {e.source === 'MANUAL' ? '人工' : '算法'}</small>
                      </td>
                      <td><span className="num">{e.offsetSeconds?.toFixed(2) ?? '—'} 秒</span></td>
                      <td><StatusTag status={e.reviewStatus} /></td>
                      <td>
                        {e.riskReasons?.trim()
                          ? <RiskTags value={e.riskReasons} />
                          : (e.note || <span className="cell-muted">—</span>)}
                      </td>
                      <td>
                        <button
                          className="videorev-action"
                          disabled={e.offsetSeconds == null}
                          onClick={() => {
                            if (player.current) player.current.currentTime = Math.max(0, (e.offsetSeconds || 0) - 1)
                          }}
                        >
                          定位
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pages={data?.pages || 0} total={data?.total || 0} onChange={setPage} />

          <p className="videorev-note">原始录像仅经认证读取。实时摄像头默认不保留画面，不能在此伪造视频回放。</p>
        </div>

        <div className="modal-foot">
          {submission.current && (
            <p className="videorev-foot-note">
              上一次请求尚未确认结果；重试沿用原位置和说明，避免网络重试造成重复计数。
            </p>
          )}
          <PrimaryButton
            loading={saving}
            disabled={!url || !note.trim() || task.status !== 'COMPLETED' || task.durationSeconds == null}
            onClick={() => void save()}
          >
            {submission.current
              ? `重试确认 ${submission.current.offset.toFixed(2)} 秒处的补录`
              : '在当前播放位置补录一次'}
          </PrimaryButton>
        </div>
      </div>
    </>
  )
}

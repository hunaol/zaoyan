import { useEffect, useRef, useState } from 'react'
import { api, timeText, type Origin, type VideoTask } from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import { LoadingBlock, RefreshButton, SectionTitle, StatusTag } from './Layout'
import Pagination from './Pagination'
import { useDialog } from './Dialog'
import './TaskHistoryPanel.css'

/** 服务端分页的完整任务历史；同一素材只允许一个统计版本。 */
export default function TaskHistoryPanel({ origin, onSelect, refreshKey = 0 }: {
  origin: Origin; onSelect: (t: VideoTask) => void; refreshKey?: number
}) {
  const { notify } = useWorkspace()
  const { confirm, prompt } = useDialog()
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  // 异步回调里需要判断「用户是否已经切走」，用 ref 读取最新数据域。
  const key = useRef(origin)
  key.current = origin

  const { data, loading, error, refresh } = useAsyncData(
    () => api.taskSearch(origin, { page, q, mode, status, date }),
    [origin, page, q, mode, status, date, refreshKey]
  )

  useEffect(() => { setPage(0) }, [origin, q, mode, status, date])
  useEffect(() => {
    if (data && !loading && page > 0 && page >= data.pages) setPage(Math.max(0, data.pages - 1))
  }, [data?.pages, page, loading])

  const reanalyze = async (t: VideoTask) => {
    const ok = await confirm({
      title: '新建分析版本？',
      description: '以当前档口规则重新分析这段录像。旧版本与复核记录会保留；新版本完成后不会自动替换已启用的统计版本。',
      confirmText: '新建版本',
      cancelText: '取消',
    })
    if (!ok) return
    const submitted = origin
    setBusy(true)
    try {
      const next = await api.reanalyze(t.id)
      if (key.current !== submitted) return
      onSelect(next)
      await refresh()
      notify('新版本已创建，完成并复核后可手动启用为统计版本')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const activate = async (t: VideoTask) => {
    const note = await prompt({
      title: '启用此统计版本',
      description: '切换后本录像仅此版本参与统计，原台账会提示重新核实。',
      label: '切换依据',
      placeholder: '例如：新版本修正了遮挡导致的漏计',
      maxLength: 300,
      required: true,
      confirmText: '启用此版本',
      hint: '该依据会写入业务留痕，供日后追溯。',
    })
    if (!note) return
    const submitted = origin
    setBusy(true)
    try {
      const next = await api.activateTask(t.id, note.trim().slice(0, 300))
      if (key.current !== submitted) return
      onSelect(next)
      await refresh()
      notify('已切换统计版本；旧事件及复核历史完整保留')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <SectionTitle
        label="完整监测任务历史"
        sub="服务端分页，按录制日期、模式、状态或文件名查找；同一素材只启用一个统计版本"
        action={<RefreshButton onClick={() => void refresh()} loading={loading} />}
      />

      <div className="taskhist-filters">
        <div className="field">
          <label htmlFor="taskhist-q">文件名 / 任务 ID</label>
          <input
            id="taskhist-q"
            className="input"
            placeholder="文件名 / 任务 ID"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="taskhist-date">录制日期</label>
          <input
            id="taskhist-date"
            className="input"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="taskhist-mode">任务模式</label>
          <select id="taskhist-mode" className="select" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="">全部模式</option>
            <option value="UPLOAD">上传视频</option>
            <option value="LIVE">实时摄像头</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="taskhist-status">任务状态</label>
          <select id="taskhist-status" className="select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {loading ? (
        <LoadingBlock height={120} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table" aria-label="监测任务历史">
              <thead>
                <tr>
                  <th>录像 / 会话</th>
                  <th>拍摄时间</th>
                  <th>分析状态</th>
                  <th>统计版本</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map(t => (
                  <tr key={t.id}>
                    <td>
                      <strong className="cell-strong taskhist-name">{t.originalFilename}</strong>
                      <small className="cell-muted taskhist-sub">
                        {t.id.slice(0, 12)}… · {t.mode} · {t.detector}
                      </small>
                    </td>
                    <td>
                      <span className="num">{timeText(t.recordedAt)}</span>
                      <small className="cell-muted taskhist-sub">
                        时长 {t.durationSeconds?.toFixed(1) ?? '未知'} 秒
                      </small>
                    </td>
                    <td><StatusTag status={t.status} /></td>
                    <td>
                      <span className={t.statsIncluded ? 'cell-strong' : undefined}>
                        {t.statsIncluded ? '参与统计' : t.activeTaskId ? '其他版本已启用' : '未完成 / 未启用'}
                      </span>
                      {t.assetId && <small className="cell-muted taskhist-sub">素材 {t.assetId.slice(0, 10)}…</small>}
                    </td>
                    <td>
                      <div className="taskhist-actions">
                        <button className="taskhist-action" onClick={() => onSelect(t)}>查看</button>
                        {t.mode === 'UPLOAD' && t.hasSourceVideo && (
                          <button className="taskhist-action" disabled={busy} onClick={() => void reanalyze(t)}>
                            新建分析版本
                          </button>
                        )}
                        {t.mode === 'UPLOAD' && t.assetId && t.status === 'COMPLETED' && !t.statsIncluded && (
                          <button className="taskhist-action" disabled={busy} onClick={() => void activate(t)}>
                            启用此统计版本
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data?.total && <p className="taskhist-empty">没有符合条件的任务。</p>}
        </>
      )}

      <Pagination page={page} pages={data?.pages || 0} total={data?.total || 0} loading={loading} onChange={setPage} />

      <p className="taskhist-note">
        精确查重基于文件内容 SHA-256、档口和数据域。重新编码或重叠录制的两个不同文件，仍须在结算时核实，系统不冒充能识别所有重复场景。
      </p>
    </section>
  )
}

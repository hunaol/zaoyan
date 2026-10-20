import { useState } from 'react'
import { api, timeText, reviewReasons, type Origin } from '../lib/api'
import { useAsyncData } from '../lib/context'
import { LoadingBlock, StatusTag } from './Layout'
import Pagination from './Pagination'
import './AuditPanel.css'

/** 单条事件的完整复核轨迹：谁在什么时候把哪条记录改成了什么状态。 */
export default function AuditPanel({ origin, eventId }: { origin: Origin; eventId?: number }) {
  const [page, setPage] = useState(0)
  const [date, setDate] = useState('')
  const [q, setQ] = useState('')
  const { data, loading, error } = useAsyncData(
    () => api.auditSearch(origin, { eventId, page, date, q }),
    [origin, eventId, page, date, q]
  )

  return (
    <div className="audit-panel">
      <div className="audit-toolbar">
        <label>
          操作日期
          <input className="input audit-date" type="date" value={date}
            onChange={e => { setDate(e.target.value); setPage(0) }} />
        </label>
        <input
          className="input audit-search"
          aria-label="搜索复核审计"
          placeholder="操作人 / 备注"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(0) }}
        />
      </div>

      {loading
        ? <LoadingBlock height={100} />
        : error
          ? <div className="notice notice-danger" role="alert"><div>{error}</div></div>
          : (
            <>
              <div className="table-wrap">
                <table className="table" aria-label="人工复核审计记录">
                  <thead>
                    <tr>
                      <th>时间</th><th>操作人</th><th>事件</th><th>状态变化</th><th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.items.map(a => (
                      <tr key={a.id}>
                        <td className="num">{timeText(a.operatedAt)}</td>
                        <td>{a.operatorName}</td>
                        <td className="num">#{a.eventId}</td>
                        <td>
                          <span className="audit-flow">
                            <StatusTag status={a.fromStatus} />
                            <span className="audit-arrow" aria-hidden="true">→</span>
                            <StatusTag status={a.toStatus} />
                          </span>
                        </td>
                        <td>
                          {a.toReason && <small className="audit-reason">{reviewReasons[a.toReason] || a.toReason}</small>}
                          {a.note || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data?.total && <p className="audit-note">没有符合条件的审计记录。</p>}
            </>
          )}

      <Pagination page={page} pages={data?.pages || 0} total={data?.total || 0} loading={loading} onChange={setPage} />
    </div>
  )
}

/** 规则、统计版本与结算确认等非事件级操作留痕。 */
const ACTION_NAMES: Record<string, string> = {
  SAVE_RULES: '规则设置',
  ACTIVATE_ANALYSIS: '切换统计版本',
  CONFIRM_SETTLEMENT: '确认复核结算',
}

export function BusinessAuditPanel({ origin }: { origin: Origin }) {
  const [page, setPage] = useState(0)
  const { data, loading, error } = useAsyncData(() => api.businessAudits(origin, page), [origin, page])

  return (
    <div className="audit-panel">
      {error && <div className="notice notice-danger" role="alert"><div>{error}</div></div>}

      {loading
        ? <LoadingBlock height={100} />
        : (
          <div className="table-wrap">
            <table className="table" aria-label="结算与版本审计记录">
              <thead>
                <tr>
                  <th>时间</th><th>操作人</th><th>操作</th><th>详情</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map(a => (
                  <tr key={a.id}>
                    <td className="num">{timeText(a.operatedAt)}</td>
                    <td>{a.operatorName}</td>
                    <td className="cell-strong">{ACTION_NAMES[a.action] || a.action}</td>
                    <td>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && !data?.total && <p className="audit-note">没有符合条件的审计记录。</p>}

      <Pagination page={page} pages={data?.pages || 0} total={data?.total || 0} loading={loading} onChange={setPage} />
    </div>
  )
}

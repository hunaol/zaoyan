import {useState} from 'react'
import {api,timeText,reviewReasons,type Origin} from '../lib/api'
import {useAsyncData} from '../lib/context'
import {LoadingBlock} from './Layout'
import Pagination from './Pagination'
export default function AuditPanel({origin,eventId}:{origin:Origin;eventId?:number}){
 const [page,setPage]=useState(0),[date,setDate]=useState(''),[q,setQ]=useState('')
 const {data,loading,error}=useAsyncData(()=>api.auditSearch(origin,{eventId,page,date,q}),[origin,eventId,page,date,q])
 return <div><div className="business-toolbar"><label>操作日期 <input type="date" value={date} onChange={e=>{setDate(e.target.value);setPage(0)}}/></label>
 <input aria-label="搜索复核审计" placeholder="操作人 / 备注" value={q} onChange={e=>{setQ(e.target.value);setPage(0)}}/></div>
 {loading?<LoadingBlock height={100}/>:error?<div className="inline-alert danger">{error}</div>:<div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>操作人</th><th>事件</th><th>状态变化</th><th>说明</th></tr></thead><tbody>
 {data?.items.map(a=><tr key={a.id}><td>{timeText(a.operatedAt)}</td><td>{a.operatorName}</td><td>#{a.eventId}</td><td>{a.fromStatus} → {a.toStatus}</td><td>{a.toReason&&<small className="block-text">{reviewReasons[a.toReason]||a.toReason}</small>}{a.note||'—'}</td></tr>)}
 </tbody></table>{!data?.total&&<p className="history-note">没有符合条件的审计记录。</p>}</div>}
 <Pagination page={page} pages={data?.pages||0} total={data?.total||0} loading={loading} onChange={setPage}/></div>
}
export function BusinessAuditPanel({origin}:{origin:Origin}){
 const [page,setPage]=useState(0);const {data,loading,error}=useAsyncData(()=>api.businessAudits(origin,page),[origin,page])
 const names:Record<string,string>={SAVE_RULES:'规则设置',ACTIVATE_ANALYSIS:'切换统计版本',CONFIRM_SETTLEMENT:'确认复核结算'}
 return <div>{error&&<div className="inline-alert danger">{error}</div>}{loading?<LoadingBlock height={100}/>:<div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>详情</th></tr></thead><tbody>{data?.items.map(a=><tr key={a.id}><td>{timeText(a.operatedAt)}</td><td>{a.operatorName}</td><td>{names[a.action]||a.action}</td><td>{a.detail}</td></tr>)}</tbody></table></div>}
 <Pagination page={page} pages={data?.pages||0} total={data?.total||0} loading={loading} onChange={setPage}/></div>
}

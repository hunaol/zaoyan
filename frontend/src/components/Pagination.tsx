import {SecondaryButton} from './Layout'
export default function Pagination({page,pages,total,loading=false,onChange}:{page:number;pages:number;total:number;loading?:boolean;onChange:(page:number)=>void}){
 return <div className="pagination"><span>第 {page+1} / {Math.max(1,pages)} 页 · 共 {total} 条</span><div>
 <SecondaryButton disabled={loading||page===0} onClick={()=>onChange(page-1)}>上一页</SecondaryButton>
 <SecondaryButton disabled={loading||page+1>=pages} onClick={()=>onChange(page+1)}>下一页</SecondaryButton></div></div>
}

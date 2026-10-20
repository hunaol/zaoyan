import { SecondaryButton } from './Layout'

/* 样式在全局层（base.css 的 .pager）：本组件被任务历史、事件台账、
   审计面板与备餐台账共用，样式跟着任何一个面板走都会造成隐式耦合。 */
export default function Pagination({ page, pages, total, loading = false, onChange }: {
  page: number; pages: number; total: number; loading?: boolean; onChange: (page: number) => void
}) {
  const lastPage = Math.max(1, pages)
  return (
    <nav className="pager" aria-label="分页导航">
      <span className="pager-info num">第 {page + 1} / {lastPage} 页 · 共 {total} 条</span>
      <div className="pager-actions">
        <SecondaryButton disabled={loading || page === 0} onClick={() => onChange(page - 1)}>上一页</SecondaryButton>
        <SecondaryButton disabled={loading || page + 1 >= pages} onClick={() => onChange(page + 1)}>下一页</SecondaryButton>
      </div>
    </nav>
  )
}

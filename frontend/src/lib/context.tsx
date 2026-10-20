import {createContext,useContext,useMemo,useState,useEffect,useCallback,useRef,type ReactNode} from 'react'
import {Toaster,toast} from 'sonner'
import {api,session,type Origin,type User} from './api'

/**
 * 通知等级。原有的 notify 只支持 success/error，
 * 这里向前兼容地把 warning/info 也暴露出来，
 * 因为业务上「轨迹曾中断」这类提示既不是成功也不是失败。
 */
export type NoticeKind = 'success' | 'error' | 'warning' | 'info'

type Workspace = {
  user: User | null
  origin: Origin
  setOrigin: (v: Origin) => void
  setUser: (v: User | null) => void
  notify: (message: string, kind?: NoticeKind) => void
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function WorkspaceProvider({children}:{children:ReactNode}) {
  const [user,setUserState] = useState<User|null>(() => session.get())
  const [origin,setOriginState] = useState<Origin>(
    () => (localStorage.getItem('zaoyan-origin') === 'REAL' ? 'REAL' : 'SIMULATION')
  )

  const setUser = useCallback((value: User|null) => {
    if (value) session.set(value)
    else session.clear()
    setUserState(value)
  },[])

  const setOrigin = useCallback((v: Origin) => {
    setOriginState(v)
    localStorage.setItem('zaoyan-origin', v)
  },[])

  const notify = useCallback((message: string, kind: NoticeKind = 'success') => {
    // 用通知库而不是自绘 toast：它已经处理了排队、堆叠、
    // aria-live 播报与"悬停时不自动消失"这些容易被忽略的细节。
    const options = {duration: kind === 'error' ? 6000 : 4200}
    if (kind === 'error') toast.error(message, options)
    else if (kind === 'warning') toast.warning(message, options)
    else if (kind === 'info') toast.info(message, options)
    else toast.success(message, options)
  },[])

  useEffect(() => {
    // 会话失效（401）时结束本地登录态。跳转交给路由守卫处理，
    // 这里只清理状态，避免在数据层里做导航。
    const callback = () => setUserState(null)
    window.addEventListener('zaoyan:unauthorized', callback)
    return () => window.removeEventListener('zaoyan:unauthorized', callback)
  },[])

  const value = useMemo(
    () => ({user, origin, setOrigin, setUser, notify}),
    [user, origin, setOrigin, setUser, notify]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <Toaster
        className="app-toaster"
        position="top-right"
        closeButton
        richColors
        toastOptions={{unstyled: false}}
      />
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('WorkspaceProvider is missing')
  return ctx
}

/**
 * 声明式数据获取：自动跟踪依赖、丢弃过期响应、窗口重新聚焦时刷新。
 *
 * 关键点是 `sequence` 票据：切换数据域时会同时发出多个请求，
 * 只有最后一张票据的结果会被写入状态，从而避免
 * 「切到真实场景却显示模拟数据」这类竞态。
 */
export function useAsyncData<T>(fetcher:()=>Promise<T>, dependencies:unknown[]) {
  const key = JSON.stringify(dependencies)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const keyRef = useRef(key)
  keyRef.current = key
  const sequence = useRef(0)
  const [state,setState] = useState<{key:string;data:T|null;loading:boolean;error:string|null}>(
    {key, data:null, loading:true, error:null}
  )

  const refresh = useCallback(async () => {
    if (keyRef.current !== key) return // 旧表单不得刷新已经切换走的工作区
    const ticket = ++sequence.current
    setState(prev => ({key, data: prev.key === key ? prev.data : null, loading:true, error:null}))
    try {
      const data = await fetchRef.current()
      if (sequence.current === ticket && keyRef.current === key) setState({key, data, loading:false, error:null})
    } catch (e) {
      if (sequence.current === ticket && keyRef.current === key)
        setState({key, data:null, loading:false, error:(e as Error).message})
    }
  },[key])

  useEffect(() => {
    void refresh()
    return () => { sequence.current++ }
  },[refresh])

  useEffect(() => {
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  },[refresh])

  return {
    data: state.key === key ? state.data : null,
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    refresh,
    setData: (data: T|null) => setState({key, data, loading:false, error:null}),
  }
}

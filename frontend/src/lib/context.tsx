import {createContext,useContext,useMemo,useState,useEffect,useCallback,useRef,type ReactNode} from 'react'
import {api,session,type Origin,type User} from './api'

type Workspace = {user:User|null;origin:Origin;setOrigin:(v:Origin)=>void;setUser:(v:User|null)=>void;notify:(message:string,kind?:'success'|'error')=>void}
const WorkspaceContext=createContext<Workspace|null>(null)
export function WorkspaceProvider({children}:{children:ReactNode}){
  const [user,setUserState]=useState<User|null>(()=>session.get())
  const [origin,setOriginState]=useState<Origin>(()=>localStorage.getItem('zaoyan-origin')==='REAL'?'REAL':'SIMULATION')
  const [notice,setNotice]=useState<{message:string;kind:'success'|'error'}|null>(null)
  const setUser=(value:User|null)=>{if(value)session.set(value);else session.clear();setUserState(value)}
  const setOrigin=(v:Origin)=>{setOriginState(v);localStorage.setItem('zaoyan-origin',v)}
  useEffect(()=>{
    const callback=()=>setUserState(null)
    window.addEventListener('zaoyan:unauthorized',callback)
    return ()=>window.removeEventListener('zaoyan:unauthorized',callback)
  },[])
  useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(null),4600);return()=>clearTimeout(timer)}},[notice])
  const value=useMemo(()=>({user,origin,setOrigin,setUser,notify:(message:string,kind:'success'|'error'='success')=>setNotice({message,kind})}),[user,origin])
  return <WorkspaceContext.Provider value={value}>{children}
    {notice&&<div role="status" className={`toast pop-in ${notice.kind==='error'?'toast-error':'toast-success'}`}><span>{notice.kind==='error'?'!':'✓'}</span>{notice.message}<button onClick={()=>setNotice(null)} aria-label="关闭提示">×</button></div>}
  </WorkspaceContext.Provider>
}
export function useWorkspace(){const ctx=useContext(WorkspaceContext);if(!ctx)throw new Error('WorkspaceProvider is missing');return ctx}

export function useAsyncData<T>(fetcher:()=>Promise<T>,dependencies:unknown[]){
  const key=JSON.stringify(dependencies)
  const fetchRef=useRef(fetcher);fetchRef.current=fetcher
  const keyRef=useRef(key);keyRef.current=key
  const sequence=useRef(0)
  const [state,setState]=useState<{key:string;data:T|null;loading:boolean;error:string|null}>({key,data:null,loading:true,error:null})
  const refresh=useCallback(async()=>{
    if(keyRef.current!==key)return // An old form must not refresh a different workspace.
    const ticket=++sequence.current
    setState(prev=>({key,data:prev.key===key?prev.data:null,loading:true,error:null}))
    try{const data=await fetchRef.current();if(sequence.current===ticket&&keyRef.current===key)setState({key,data,loading:false,error:null})}
    catch(e){if(sequence.current===ticket&&keyRef.current===key)setState({key,data:null,loading:false,error:(e as Error).message})}
  },[key])
  useEffect(()=>{void refresh();return()=>{sequence.current++}},[refresh])
  useEffect(()=>{const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)},[refresh])
  return {data:state.key===key?state.data:null,loading:state.key!==key||state.loading,error:state.key===key?state.error:null,refresh,
    setData:(data:T|null)=>setState({key,data,loading:false,error:null})}
}

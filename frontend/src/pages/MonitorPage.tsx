import {useEffect,useRef,useState,type ChangeEvent,type DragEvent} from 'react'
import {ArrowDownToLine,ArrowRight,Camera,Check,ChevronRight,CircleAlert,Clock3,CloudUpload,Eye,FileVideo,Info,LoaderCircle,Play,RadioTower,RefreshCw,ScanLine,Settings2,ShieldCheck,Sparkles,Square,UploadCloud,Video,X} from 'lucide-react'
import {useNavigate} from 'react-router-dom'
import {api,authorizedBlob,timeText,beijingInputNow,toBeijingInstant,type CountEvent,type Detector,type LiveFrame,type VideoTask} from '../lib/api'
import {useWorkspace,useAsyncData} from '../lib/context'
import {EmptyState,LoadingBlock,PageTitle,PrimaryButton,SecondaryButton,SectionTitle,StatusTag} from '../components/Layout'

import TaskHistoryPanel from '../components/TaskHistoryPanel'
import VideoReviewDialog from '../components/VideoReviewDialog'
type Tab='upload'|'live'
export default function MonitorPage(){
  const {origin,notify}=useWorkspace(),navigate=useNavigate()
  const [reviewVideo,setReviewVideo]=useState<VideoTask|null>(null),[historyTick,setHistoryTick]=useState(0)
  const liveSnapshot=useRef<VideoTask|null>(null)
  const [tab,setTab]=useState<Tab>('upload'),[detector,setDetector]=useState<Detector>(origin==='REAL'?'yolo':'demo-color')
  const [file,setFile]=useState<File|null>(null),[dragging,setDragging]=useState(false),[recordedAt,setRecordedAt]=useState(beijingInputNow())
  const [uploading,setUploading]=useState(false),[task,setTask]=useState<VideoTask|null>(null),[taskBusy,setTaskBusy]=useState(false)
  const [taskEvents,setTaskEvents]=useState<CountEvent[]>([]),[videoUrl,setVideoUrl]=useState<string|null>(null),[resultError,setResultError]=useState('')
  const {data:tasks,error:tasksError,refresh:reloadTasks}=useAsyncData(()=>api.tasks(origin),[origin])
  const {data:stalls}=useAsyncData(api.stalls,[])
  const {data:capabilities}=useAsyncData(api.capabilities,[])
  const [liveSession,setLiveSession]=useState<string|null>(null),[liveStarting,setLiveStarting]=useState(false)
  const [liveError,setLiveError]=useState(''),[liveCount,setLiveCount]=useState(0),[liveBoxes,setLiveBoxes]=useState<LiveFrame['boxes']>([])
  const videoRef=useRef<HTMLVideoElement|null>(null),overlayRef=useRef<HTMLCanvasElement|null>(null),streamRef=useRef<MediaStream|null>(null),framePending=useRef(false)
  const sessionRef=useRef<string|null>(null),liveGeneration=useRef(0),scope=useRef(origin);scope.current=origin
  const selectedKey=`zaoyan-task:${origin}`
  const stopLocal=()=>{streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;setLiveBoxes([]);const canvas=overlayRef.current;canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height)}
  const stopLive=async(silent=false)=>{liveGeneration.current++;const id=sessionRef.current;sessionRef.current=null;setLiveSession(null);setLiveStarting(false);stopLocal();if(id)try{await api.liveStop(id);void reloadTasks();setHistoryTick(v=>v+1);if(!silent)notify('摄像头监测已停止，事件记录已保存')}catch(e){if(!silent)notify((e as Error).message,'error')}}
  const switchTab=(next:Tab)=>{if(next==='upload')void stopLive(true);setTab(next)}
  useEffect(()=>{
    setReviewVideo(null);setTask(null);setTaskEvents([]);setVideoUrl(null);setFile(null);setLiveCount(0);setLiveError('');setResultError('');setDetector(origin==='REAL'?'yolo':'demo-color')
    void stopLive(true)
  },[origin])
  useEffect(()=>{
    if(task||!tasks?.length)return
    const saved=sessionStorage.getItem(selectedKey)
    const latest=tasks.find(t=>t.id===saved)||tasks.find(t=>t.mode==='UPLOAD')
    if(latest)setTask(latest)
    if(saved&&!tasks.some(t=>t.id===saved))void api.task(saved).then(t=>{if(t.origin===scope.current)setTask(t)}).catch(()=>{})
  },[tasks,origin])
  useEffect(()=>{if(task&&task.origin===origin)sessionStorage.setItem(selectedKey,task.id)},[task?.id,origin])
  useEffect(()=>{
    if(!task||!['QUEUED','RUNNING'].includes(task.status))return
    let active=true,pending=false
    const timer=setInterval(async()=>{if(pending)return;pending=true;try{const next=await api.task(task.id);if(active&&next.origin===origin)setTask(next)}catch(e){if(active)notify((e as Error).message,'error')}finally{pending=false}},1500)
    return()=>{active=false;clearInterval(timer)}
  },[task?.id,task?.status,origin])
  useEffect(()=>{
    let active=true;let url:string|null=null
    setTaskEvents([]);setVideoUrl(null);setResultError('')
    if(!task||task.origin!==origin||!['COMPLETED','FAILED','CANCELLED'].includes(task.status))return
    void (async()=>{
      try{
        const events=await api.taskEvents(task.id);if(active)setTaskEvents(events)
        if(task.hasResultVideo){const blob=await authorizedBlob(`/tasks/${task.id}/video`);if(active){url=URL.createObjectURL(blob);setVideoUrl(url)}}
        if(active){void reloadTasks();setHistoryTick(v=>v+1)}
      }catch(e){if(active)setResultError((e as Error).message)}
    })()
    return()=>{active=false;if(url)URL.revokeObjectURL(url)}
  },[task?.id,task?.status,origin])
  const chooseFile=(f:File|null)=>{
    if(!f)return
    if(f.size>200*1024*1024){notify('请上传不超过 200MB 的视频','error');return}
    if(!/\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)){notify('仅支持 MP4、MOV、AVI、MKV、WEBM','error');return}
    setFile(f);setTask(null);setTaskEvents([]);setVideoUrl(null);setResultError('')
  }
  const onDrop=(e:DragEvent)=>{e.preventDefault();setDragging(false);chooseFile(e.dataTransfer.files?.[0]||null)}
  const sample=async()=>{
    if(origin!=='SIMULATION')return
    try{const resp=await fetch('/samples/demo-trays.mp4');if(!resp.ok)throw new Error('无法读取内置样本');const blob=await resp.blob();if(scope.current!=='SIMULATION')return;chooseFile(new File([blob],'zaoyan-synthetic-trays.mp4',{type:'video/mp4'}));setDetector('demo-color');setRecordedAt(beijingInputNow());notify('已载入自建模拟视频，默认计数线下预计 3 次正向越线')}
    catch(e){notify((e as Error).message,'error')}
  }
  const upload=async()=>{
    if(!file||!stalls?.[0]||uploading)return
    const submittedOrigin=origin;setUploading(true)
    try{const result=await api.upload(file,origin,detector,stalls[0].id,recordedAt?toBeijingInstant(recordedAt):undefined);if(scope.current===submittedOrigin){setTask(result);setTaskEvents([]);notify(result.reusedUpload?'检测到同一录像，已打开原任务，没有创建重复统计。重新分析请在任务历史中新建版本。':'异步任务已创建，可以离开页面后再回来查看');setHistoryTick(v=>v+1);await reloadTasks()}}
    catch(e){notify((e as Error).message,'error')}finally{setUploading(false)}
  }
  const taskAction=async(action:'cancel'|'retry')=>{
    if(!task||taskBusy)return
    if(action==='cancel'&&!window.confirm('取消当前分析？尚未完成的结果不会导入事件台账。'))return
    const id=task.id;setTaskBusy(true)
    try{const next=await(action==='cancel'?api.cancelTask(id):api.retryTask(id));if(next.origin===scope.current)setTask(next);await reloadTasks();notify(action==='cancel'?(next.status==='CANCELLED'?'任务已取消':'任务已结束，未执行取消；请按当前状态查看结果'):'已重新提交分析，沿用原拍摄时间和计数线')}
    catch(e){notify((e as Error).message,'error')}finally{setTaskBusy(false)}
  }
  const startLive=async()=>{
    if(!stalls?.[0]||liveStarting||sessionRef.current)return
    const generation=++liveGeneration.current;setLiveError('');setLiveStarting(true)
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('摄像头需要 localhost 或 HTTPS 安全环境')
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'environment'},audio:false})
      if(generation!==liveGeneration.current){stream.getTracks().forEach(t=>t.stop());return}
      streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}
      if(generation!==liveGeneration.current)return
      const s=await api.liveStart({stallId:stalls[0].id,origin,detector})
      if(generation!==liveGeneration.current){void api.liveStop(s.sessionId).catch(()=>{});return}
      sessionRef.current=s.sessionId;const snapshot=await api.task(s.sessionId);if(generation!==liveGeneration.current){void api.liveStop(s.sessionId).catch(()=>{});return}
      liveSnapshot.current=snapshot;sessionRef.current=s.sessionId;setLiveSession(s.sessionId);setLiveCount(0);notify('实时监测已启动；默认不保存原始图像')
    }catch(e){if(generation===liveGeneration.current){const failedId=sessionRef.current;sessionRef.current=null;if(failedId)void api.liveStop(failedId).catch(()=>{});stopLocal();setLiveError((e as Error).message);notify((e as Error).message,'error')}}
    finally{if(generation===liveGeneration.current)setLiveStarting(false)}
  }
  useEffect(()=>{
    if(!liveSession)return
    let running=true
    async function sendFrame(){
      const video=videoRef.current,id=liveSession
      if(!running||!video||!video.videoWidth||framePending.current||sessionRef.current!==id)return
      framePending.current=true
      try{
        const canvas=document.createElement('canvas'),w=Math.min(960,video.videoWidth),h=Math.round(w*video.videoHeight/video.videoWidth)
        canvas.width=w;canvas.height=h;const image=canvas.getContext('2d')!;image.drawImage(video,0,0,w,h)
        const roi=liveSnapshot.current?.rules
        if(roi){image.fillStyle='#000';image.fillRect(0,0,w,h*roi.roiY1);image.fillRect(0,h*roi.roiY2,w,h*(1-roi.roiY2));image.fillRect(0,0,w*roi.roiX1,h);image.fillRect(w*roi.roiX2,0,w*(1-roi.roiX2),h)}
        const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.72))
        if(!blob||!running||sessionRef.current!==id)return
        const result=await api.liveFrame(id!,blob)
        if(!running)return
        setLiveCount(result.sessionCount);setLiveBoxes(result.boxes)
        const overlay=overlayRef.current
        if(overlay){overlay.width=w;overlay.height=h;const c=overlay.getContext('2d');if(c){c.clearRect(0,0,w,h);c.lineWidth=3;c.strokeStyle='#85f4b4';c.setLineDash([12,7]);c.beginPath();c.moveTo(w*(liveSnapshot.current?.lineX1??.08),h*(liveSnapshot.current?.lineY1??.54));c.lineTo(w*(liveSnapshot.current?.lineX2??.92),h*(liveSnapshot.current?.lineY2??.54));c.stroke();c.setLineDash([]);result.boxes.forEach(b=>{c.strokeStyle='#74e0a4';c.strokeRect(b.x*w,b.y*h,b.width*w,b.height*h);c.fillStyle='#0f583e';c.fillRect(b.x*w,Math.max(0,b.y*h-22),130,21);c.fillStyle='#fff';c.font='13px sans-serif';c.fillText(`ID ${b.trackId} · ${b.label}`,b.x*w+5,Math.max(16,b.y*h-6))})}}
      }catch(e){if(running){const message=(e as Error).message;setLiveError(message);notify(message,'error');void stopLive(true)}}
      finally{framePending.current=false}
    }
    const timer=setInterval(()=>void sendFrame(),250)
    return()=>{running=false;clearInterval(timer)}
  },[liveSession,stalls])
  useEffect(()=>()=>{liveGeneration.current++;const id=sessionRef.current;sessionRef.current=null;streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;if(id)void api.liveStop(id).catch(()=>{})},[])
  const displayed=tasks||[]
  return <div className="page-enter"><PageTitle eyebrow="VISION INTELLIGENCE / 视觉中枢" title="AI 出餐监测" description="检测 · 跟踪 · 越线 · 去重。让每一次出餐都有可追溯的记录。"
    actions={<SecondaryButton onClick={()=>navigate('/settings')}><Settings2 size={16}/> 配置计数线</SecondaryButton>}/>
    <div className="monitor-toolbar"><div className="monitor-tabs"><button onClick={()=>switchTab('upload')} className={tab==='upload'?'active':''}><FileVideo size={17}/> 视频上传分析</button><button onClick={()=>switchTab('live')} className={tab==='live'?'active':''}><RadioTower size={17}/> 实时摄像头</button></div>
      <span className="monitor-rule"><ShieldCheck size={15}/> 视频采集必须有合法授权</span></div>
    <div className="monitor-layout"><div className="monitor-main">
      {tab==='upload'?<>
        <div className="panel upload-panel"><SectionTitle label="提交视觉分析任务" sub="Java 异步调用 Python，每帧真实计算，处理进度可查询"/>
          <div className={`upload-area ${dragging?'upload-area-dragging':''} ${file?'upload-area-hasfile':''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}>
            <div className="upload-cloud"><CloudUpload size={31} strokeWidth={1.8}/></div><strong>{file?file.name:'拖拽出餐视频到这里'}</strong><span>{file?`${(file.size/1024/1024).toFixed(2)} MB · 已选择待上传文件`:'支持 MP4、MOV、AVI、MKV、WEBM · 不超过 200MB'}</span>
            <div className="upload-actions"><label className="btn btn-primary upload-file-button"><UploadCloud size={16}/> {file?'重新选择视频':'选择本地视频'}<input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mkv" onChange={(e:ChangeEvent<HTMLInputElement>)=>chooseFile(e.target.files?.[0]||null)} hidden/></label>
              <button onClick={()=>void sample()} className="btn btn-secondary" disabled={origin==='REAL'}><Play size={15}/> 使用模拟视频</button></div>
          </div>
          <div className="detector-config"><div><strong>识别算法模式</strong><span>不同模式不可混淆评测指标</span></div><div className="mode-pills"><button className={detector==='demo-color'?'selected':''} disabled={origin==='REAL'||!!liveSession||liveStarting} onClick={()=>setDetector('demo-color')}>模拟色块视觉检测</button><button className={detector==='yolo'?'selected':''} onClick={()=>setDetector('yolo')}>YOLO + ByteTrack</button></div></div>
          <div className="mode-info"><Info size={16}/>{detector==='demo-color'?'通过 OpenCV 阈值分割 + 目标匹配验证自制青绿色餐盒视频；不是训练完成的真实食堂餐盒模型。':'需提前安装 Ultralytics，并配置 YOLO_WEIGHTS 指向本地可用模型；普通 COCO 权重不能保证识别餐盒。'}</div>
          <div className="field upload-time"><label>视频开始拍摄时间（北京时间）</label><input type="datetime-local" value={recordedAt} onChange={e=>setRecordedAt(e.target.value)}/><small>事件归档时间 = 拍摄开始时间 + 视频内偏移；历史视频不会全部计入今天。</small></div>
          <div className="upload-submit"><div><strong>分析目标</strong><span>{stalls?.[0]?.name||'正在读取档口'} · 固定计数线 · 单方向越线</span></div><PrimaryButton onClick={()=>void upload()} disabled={!file||!stalls?.length||!!liveSession||(detector==='yolo'&&!capabilities?.yoloConfigured)} loading={uploading}><ScanLine size={17}/> 开始分析任务 <ArrowRight size={16}/></PrimaryButton></div>
        </div>
        {tasksError&&<div className="inline-alert danger">{tasksError}</div>}
        {detector==='yolo'&&!capabilities?.yoloConfigured&&<div className="inline-alert warn">YOLO 依赖或权重尚未配置；真实识别未就绪，不能用模拟结果代替。可前往系统设置查看环境状态。</div>}
        {task&&task.origin===origin&&<div className="panel task-result"><SectionTitle label="任务处理结果" sub={`任务编号 ${task.id.slice(0,13)}… · ${task.detector==='demo-color'?'模拟视觉基线':'YOLO 模型'}`} action={<StatusTag status={task.status}/>}/>
          <div className="task-progress-label"><span>处理进度</span><strong>{task.progress}%</strong></div><div className="task-progress-track"><span style={{width:`${task.progress}%`}}/></div>
          {['FAILED','CANCELLED'].includes(task.status)?<div className="inline-alert danger">{task.errorMessage||'分析失败，请检查算法环境'}</div>:task.status==='COMPLETED'?<>
            <div className="result-stats"><div><span>有效越线（机器初判）</span><strong>{task.rawCount}</strong></div><div><span>处理视频帧数</span><strong>{task.frameCount}</strong></div><div><span>事件待复核</span><strong>{taskEvents.filter(e=>e.reviewStatus==='PENDING').length}</strong></div></div>
            {videoUrl?<div className="processed-player"><video controls playsInline src={videoUrl}/><span className="player-watermark">AI ANNOTATED VIDEO · {origin==='SIMULATION'?'SIMULATION':'REAL'}</span></div>:task.hasResultVideo&&!resultError?<LoadingBlock height={180}/>:<p className="history-note">{task.mode==='LIVE'?'实时会话按隐私策略未保存视频，可进入台账复核结构化事件。':'没有可播放结果，详见任务状态。'}</p>}
            <button className="text-link" onClick={()=>navigate(`/events?taskId=${task.id}`)}>前往人工复核 <ArrowRight size={16}/></button>
          </>:<div className="task-waiting"><LoaderCircle size={18} className="spin"/> {task.mode==='LIVE'?'实时监测仍在运行；摄像头会话在发起页面中停止。':'Python 正在逐帧分析，可离开本页面后回来查看。'}</div>}
          {resultError&&<div className="inline-alert danger">{resultError}</div>}
          <div className="task-actions">{task.mode==='UPLOAD'&&['QUEUED','RUNNING'].includes(task.status)&&<SecondaryButton disabled={taskBusy} onClick={()=>void taskAction('cancel')}>取消任务</SecondaryButton>}{task.mode==='UPLOAD'&&['FAILED','CANCELLED'].includes(task.status)&&<SecondaryButton disabled={taskBusy} onClick={()=>void taskAction('retry')}>重试分析</SecondaryButton>}{videoUrl&&<a className="btn btn-secondary" href={videoUrl} download={`zaoyan-${task.id}.mp4`}>保存标注视频</a>}</div>
          <p className="history-note">开始拍摄：{timeText(task.recordedAt)} · 处理尝试：{task.attempt||1} · 计数线使用提交时快照</p>
        </div>}
      </>:<div className="panel live-panel"><SectionTitle label="实时摄像头视觉监测" sub="浏览器采集 JPEG 帧 → Spring Boot → 常驻 Python 算法进程" action={<span className={liveSession?'live-indicator on':'live-indicator'}><span/>{liveSession?'LIVE / 识别中':'IDLE / 未连接'}</span>}/>
        <div className={`live-video-wrap ${liveSession?'live-on':''}`}>
          <video ref={videoRef} muted playsInline autoPlay className="live-video"/>
          <canvas ref={overlayRef} className="live-overlay"/>
          {!liveSession&&<div className="live-placeholder"><div className="live-placeholder-icon"><Camera size={37}/></div><h3>摄像头尚未连接</h3><p>支持电脑或手机摄像头采集，适合受控的出餐模拟实验。</p></div>}
          <div className="live-corner top-left"/><div className="live-corner top-right"/><div className="live-corner bottom-left"/><div className="live-corner bottom-right"/>
          {liveSession&&<div className="live-overlay-count"><span>已检测有效越线</span><strong>{liveCount}<small> 次</small></strong></div>}
        </div>
        {liveError&&<div className="inline-alert danger"><CircleAlert size={16}/>{liveError}</div>}
        <div className="live-controls"><div><span>当前识别模式</span><div className="mode-pills"><button className={detector==='demo-color'?'selected':''} disabled={origin==='REAL'||!!liveSession||liveStarting} onClick={()=>setDetector('demo-color')}>模拟色块</button><button disabled={!!liveSession} className={detector==='yolo'?'selected':''} onClick={()=>setDetector('yolo')}>YOLO 模型</button></div></div>
          {liveSession?<button className="btn btn-stop" onClick={()=>void stopLive()}><Square size={16}/> 结束监测</button>:<PrimaryButton loading={liveStarting} disabled={!stalls?.length||(detector==='yolo'&&!capabilities?.yoloConfigured)} onClick={()=>void startLive()}><Play size={16}/> 启动实时监测</PrimaryButton>}
        </div>
        <div className="mode-info"><Info size={16}/> 本地摄像头通常要求 HTTPS 或 localhost 环境。算法只传输抽样帧用于实时分析，默认不持久化原始视频，事件结果进入当前数据域。实际食堂采集必须取得授权。</div>
        {liveSession&&<div className="live-stats"><div><span className="live-stat-dot"/> 实时监测中</div><div>当前画面识别目标 <strong>{liveBoxes.length}</strong></div><div>有效越线计数 <strong>{liveCount}</strong></div></div>}
      </div>}
    </div><aside className="monitor-side"><div className="monitor-info-card"><span className="small-eyebrow">VISION PIPELINE</span><h3>不止于识别，<br/><em>更关注真实出餐。</em></h3><div className="pipeline-steps"><div><span>01</span><strong>目标检测</strong><small>输出图像目标框</small></div><div><span>02</span><strong>跨帧跟踪</strong><small>给目标分配稳定 ID</small></div><div><span>03</span><strong>轨迹越线</strong><small>检查方向与边界</small></div><div><span>04</span><strong>事件去重</strong><small>记录一次有效越线</small></div></div></div>
      <div className="monitor-privacy"><ShieldCheck size={19}/><div><strong>隐私保护提示</strong><p>尽量在受控场景拍摄，限制无关人员进入画面，不做人脸识别。</p></div></div>
    </aside></div>
    {task&&task.origin===origin&&<div className="panel"><SectionTitle label="当前任务的计数口径与规则快照" sub="修改设置不会追溯改变本任务；需要新建分析版本再选择是否启用"/>
      <div className="business-toolbar"><StatusTag status={task.status}/><strong>{task.statsIncluded?'当前参与统计':'当前不参与统计'}</strong><span>起始时间 {timeText(task.recordedAt)} · 时长 {task.durationSeconds?.toFixed(1)??'未知'} 秒</span>
      {task.mode==='UPLOAD'&&(task.hasSourceVideo||task.hasResultVideo)&&<SecondaryButton onClick={()=>setReviewVideo(task)}>逐段复核 / 视频定位补录</SecondaryButton>}</div>
      <details><summary>查看不可变规则快照</summary><pre className="rule-snapshot">{JSON.stringify({line:[task.lineX1,task.lineY1,task.lineX2,task.lineY2],direction:task.direction,...task.rules},null,2)}</pre></details>
    </div>}
    <TaskHistoryPanel origin={origin} refreshKey={historyTick} onSelect={t=>{if(t.mode==='LIVE'){navigate('/events?taskId='+t.id);return}switchTab('upload');setTask(t);window.scrollTo({top:0,behavior:'smooth'})}}/>
    {reviewVideo&&<VideoReviewDialog key={origin+reviewVideo.id} task={reviewVideo} onClose={()=>setReviewVideo(null)} onSaved={()=>{setHistoryTick(v=>v+1);void reloadTasks();if(task){const id=task.id,domain=origin;void api.taskEvents(id).then(rows=>{if(scope.current===domain)setTaskEvents(rows)}).catch(e=>notify(e.message,'error'))}}}/>}
  </div>
}

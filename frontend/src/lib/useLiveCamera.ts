import {useCallback,useEffect,useRef,useState} from 'react'
import {api,type Detector,type LiveFrame,type Origin,type VideoTask,type CountingRules} from './api'

/**
 * 实时摄像头监测。
 *
 * 从 MonitorPage 里整体抽出来，原因是原实现把摄像头生命周期、
 * 帧发送节流、画布叠绘和任务历史刷新全部塞在一个 190 行的组件里，
 * 十几个 ref 互相交叉，任何一处改动都可能破坏竞态处理。
 *
 * 这里保留原实现中所有必要的防护，并补充说明它们各自防的是什么：
 *
 * 1. `generation` 代次票据：用户在启动过程中切换数据域或离开页面时，
 *    异步回调仍会返回。只有代次匹配时才允许落地状态。
 * 2. `sessionRef` 与 state 并存：state 更新是异步的，而清理函数需要
 *    立刻知道当前会话 id，否则会漏掉 stop 请求、在服务端留下僵尸会话。
 * 3. `framePending` 帧闸：上传比采样慢时必须丢帧而不是排队，
 *    否则请求会无限堆积。
 * 4. ROI 遮罩：发送前把识别区域外涂黑，避免把画面里无关的人脸
 *    或环境内容传到服务端——这是隐私边界，不是性能优化。
 */

const SAMPLE_INTERVAL_MS = 250
const SEND_WIDTH = 960

type LiveState = {
  sessionId: string | null
  starting: boolean
  error: string
  count: number
  boxes: LiveFrame['boxes']
}

export function useLiveCamera(options:{
  origin: Origin
  stallId: number | undefined
  detector: Detector
  onSessionEnded: () => void
  notify: (message: string, kind?: 'success' | 'error' | 'warning' | 'info') => void
}) {
  const {origin, stallId, detector, onSessionEnded, notify} = options

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const framePendingRef = useRef(false)
  // ROI 与计数线都取自**本会话自己的任务快照**，而不是调用方传进来的
  // 某个上传任务的规则——两者可能属于不同档口，混用会把遮罩区域画错，
  // 那是一个隐私问题，不只是显示问题。
  const rulesRef = useRef<CountingRules | null>(null)
  const lineRef = useRef<{x1:number; y1:number; x2:number; y2:number} | null>(null)

  const [state,setState] = useState<LiveState>({
    sessionId:null, starting:false, error:'', count:0, boxes:[],
  })

  const patch = useCallback((next: Partial<LiveState>) => {
    setState(prev => ({...prev, ...next}))
  },[])

  const stopLocalStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    const canvas = overlayRef.current
    canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height)
  },[])

  /** 结束会话。静默模式下不提示、也不刷新历史（用于卸载清理）。 */
  const stop = useCallback(async (silent = false) => {
    generationRef.current += 1
    const id = sessionRef.current
    sessionRef.current = null
    setState({sessionId:null, starting:false, error:'', count:0, boxes:[]})
    stopLocalStream()
    if (!id) return
    try {
      await api.liveStop(id)
      onSessionEnded()
      if (!silent) notify('摄像头监测已停止，事件记录已保存')
    } catch (e) {
      if (!silent) notify((e as Error).message,'error')
    }
  },[notify,onSessionEnded,stopLocalStream])

  const start = useCallback(async () => {
    if (stallId === undefined || sessionRef.current || state.starting) return
    const generation = ++generationRef.current
    patch({error:'', starting:true})
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('摄像头需要 localhost 或 HTTPS 安全环境')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{width:{ideal:1280}, height:{ideal:720}, facingMode:'environment'},
        audio:false,
      })
      if (generation !== generationRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      if (generation !== generationRef.current) return

      const session = await api.liveStart({stallId, origin, detector})
      if (generation !== generationRef.current) {
        void api.liveStop(session.sessionId).catch(()=>{})
        return
      }
      sessionRef.current = session.sessionId
      // 取本会话自己的任务快照：ROI 用于发送前遮罩，计数线用于叠绘。
      const snapshot: VideoTask = await api.task(session.sessionId)
      if (generation !== generationRef.current) {
        void api.liveStop(session.sessionId).catch(()=>{})
        return
      }
      rulesRef.current = snapshot.rules ?? null
      lineRef.current = snapshot.lineX1 !== null && snapshot.lineY1 !== null
        && snapshot.lineX2 !== null && snapshot.lineY2 !== null
        ? {x1:snapshot.lineX1, y1:snapshot.lineY1, x2:snapshot.lineX2, y2:snapshot.lineY2}
        : null
      patch({sessionId:session.sessionId, count:0, boxes:[]})
      notify('实时监测已启动；默认不保存原始图像')
    } catch (e) {
      if (generation === generationRef.current) {
        const failed = sessionRef.current
        sessionRef.current = null
        if (failed) void api.liveStop(failed).catch(()=>{})
        stopLocalStream()
        patch({error:(e as Error).message})
        notify((e as Error).message,'error')
      }
    } finally {
      if (generation === generationRef.current) patch({starting:false})
    }
  },[detector,notify,origin,patch,stallId,state.starting,stopLocalStream])

  /* --- 帧采样与叠绘 --- */
  // 采样定时器只应随会话 id 重建。stop/notify/patch 放进 ref，
  // 否则上层任何一次重渲染都可能重建函数、重置定时器并丢帧。
  const stopRef = useRef(stop)
  stopRef.current = stop
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const patchRef = useRef(patch)
  patchRef.current = patch

  useEffect(() => {
    const sessionId = state.sessionId
    if (!sessionId) return
    // 显式绑定成非空常量：嵌套函数里的收窄在闭包边界上不总是被
    // TypeScript 保留，这里固定住类型，也顺便表明"本次定时器只服务这一个会话"。
    const activeSessionId: string = sessionId
    let running = true

    async function sendFrame() {
      const video = videoRef.current
      if (!running || !video?.videoWidth) return
      if (framePendingRef.current || sessionRef.current !== activeSessionId) return
      framePendingRef.current = true
      try {
        const width = Math.min(SEND_WIDTH, video.videoWidth)
        const height = Math.round(width * video.videoHeight / video.videoWidth)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video,0,0,width,height)

        // ROI 之外涂黑再上传：隐私边界，避免无关环境内容离开本机。
        const active = rulesRef.current
        if (active) {
          ctx.fillStyle = '#000'
          ctx.fillRect(0,0,width,height * active.roiY1)
          ctx.fillRect(0,height * active.roiY2,width,height * (1 - active.roiY2))
          ctx.fillRect(0,0,width * active.roiX1,height)
          ctx.fillRect(width * active.roiX2,0,width * (1 - active.roiX2),height)
        }

        const blob = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve,'image/jpeg',0.72))
        if (!blob || !running || sessionRef.current !== activeSessionId) return

        const result = await api.liveFrame(activeSessionId, blob)
        if (!running) return
        setState(prev => ({...prev, count:result.sessionCount, boxes:result.boxes}))
        drawOverlay(overlayRef.current, result.boxes, width, height, rulesRef.current, lineRef.current)
      } catch (e) {
        if (running) {
          const message = (e as Error).message
          patchRef.current({error:message})
          notifyRef.current(message,'error')
          void stopRef.current(true)
        }
      } finally {
        framePendingRef.current = false
      }
    }

    const timer = setInterval(() => void sendFrame(), SAMPLE_INTERVAL_MS)
    return () => { running = false; clearInterval(timer) }
  },[state.sessionId])

  /* --- 卸载时清理，避免留下僵尸会话 --- */
  useEffect(() => () => {
    generationRef.current += 1
    const id = sessionRef.current
    sessionRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (id) void api.liveStop(id).catch(()=>{})
  },[])

  /**
   * 数据域切换时当前会话立即作废。
   * 用 ref 记录上一次的 origin，只在真正变化时触发，
   * 这样 effect 依赖可以保持为空而不需要禁用 lint 规则。
   */
  const originRef = useRef(origin)
  useEffect(() => {
    if (originRef.current === origin) return
    originRef.current = origin
    void stop(true)
  },[origin,stop])

  return {
    videoRef, overlayRef,
    sessionId: state.sessionId,
    starting: state.starting,
    error: state.error,
    count: state.count,
    boxes: state.boxes,
    active: state.sessionId !== null,
    start, stop,
  }
}

/** 把检测框与计数线画到叠层画布上。 */
function drawOverlay(
  canvas: HTMLCanvasElement | null,
  boxes: LiveFrame['boxes'],
  width: number,
  height: number,
  rules: CountingRules | null,
  line: {x1:number; y1:number; x2:number; y2:number} | null,
) {
  if (!canvas) return
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0,0,width,height)

  const accent = '#6ee7c8'
  const lineWidth = Math.max(1.5, width / 700)

  // 计数线用虚线，与导出视频里的实线区分：这里是"当前生效规则"。
  if (line) {
    ctx.save()
    ctx.lineWidth = lineWidth * 1.6
    ctx.strokeStyle = accent
    ctx.setLineDash([Math.round(width / 70), Math.round(width / 130)])
    ctx.beginPath()
    ctx.moveTo(line.x1 * width, line.y1 * height)
    ctx.lineTo(line.x2 * width, line.y2 * height)
    ctx.stroke()
    ctx.restore()
  } else if (rules) {
    // 没有独立计数线时，退化用 ROI 下边界提示有效区域。
    ctx.save()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = 'rgba(110, 231, 200, 0.5)'
    ctx.setLineDash([6,6])
    ctx.strokeRect(
      rules.roiX1 * width, rules.roiY1 * height,
      (rules.roiX2 - rules.roiX1) * width, (rules.roiY2 - rules.roiY1) * height,
    )
    ctx.restore()
  }

  for (const box of boxes) {
    const x = box.x * width
    const y = box.y * height
    const w = box.width * width
    const h = box.height * height

    ctx.lineWidth = lineWidth
    ctx.strokeStyle = accent
    ctx.strokeRect(x,y,w,h)

    const label = `#${box.trackId} · ${box.label} ${Math.round(box.confidence * 100)}%`
    const fontSize = Math.max(11, Math.round(width / 62))
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif`
    const textWidth = ctx.measureText(label).width
    const padX = fontSize * 0.5
    const chipH = fontSize * 1.7
    const chipY = y - chipH - 3 < 0 ? y + 3 : y - chipH - 3

    ctx.fillStyle = 'rgba(13, 26, 25, 0.82)'
    ctx.fillRect(x, chipY, textWidth + padX * 2, chipH)
    ctx.fillStyle = '#eafff8'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + padX, chipY + chipH / 2)
  }
}

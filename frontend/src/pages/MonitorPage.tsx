import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ArrowRight, Camera, CircleAlert, FileVideo, Info, LoaderCircle, Play,
  RadioTower, ScanLine, Settings2, ShieldCheck, Square, UploadCloud,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  api, authorizedBlob, beijingInputNow, timeText, toBeijingInstant,
  type CountEvent, type Detector, type VideoTask,
} from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import { useLiveCamera } from '../lib/useLiveCamera'
import {
  LoadingBlock, PageTitle, PrimaryButton, SecondaryButton, SectionTitle, StatusTag,
} from '../components/Layout'
import TaskHistoryPanel from '../components/TaskHistoryPanel'
import VideoReviewDialog from '../components/VideoReviewDialog'
import { useDialog } from '../components/Dialog'
import './MonitorPage.css'

type Tab = 'upload' | 'live'

const DETECTOR_COPY: Record<Detector, string> = {
  'demo-color': '通过自适应色块分割 + Kalman 跟踪验证自制青绿色餐盒视频；这是经典视觉基线，不是训练完成的真实食堂餐盒模型。',
  'yolo': '需提前安装 Ultralytics，并配置 YOLO_WEIGHTS 指向本地可用模型；普通 COCO 权重不能保证识别餐盒。',
}

/** 算法链路说明。放页尾，不占主流程的注意力。 */
const PIPELINE = [
  { n: '01', name: '目标检测', detail: '自适应分割输出目标框' },
  { n: '02', name: '跨帧跟踪', detail: 'Kalman 预测 + 全局最优关联' },
  { n: '03', name: '轨迹越线', detail: '插值求交，检查方向与边界' },
  { n: '04', name: '事件去重', detail: '一次交付只记一条' },
]

export default function MonitorPage() {
  const { origin, notify } = useWorkspace()
  const navigate = useNavigate()
  const { confirm } = useDialog()

  const [tab, setTab] = useState<Tab>('upload')
  const [detector, setDetector] = useState<Detector>(origin === 'REAL' ? 'yolo' : 'demo-color')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [recordedAt, setRecordedAt] = useState(beijingInputNow())
  const [uploading, setUploading] = useState(false)
  const [task, setTask] = useState<VideoTask | null>(null)
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskEvents, setTaskEvents] = useState<CountEvent[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [resultError, setResultError] = useState('')
  const [reviewVideo, setReviewVideo] = useState<VideoTask | null>(null)
  const [historyTick, setHistoryTick] = useState(0)

  const { data: tasks, error: tasksError, refresh: reloadTasks } = useAsyncData(() => api.tasks(origin), [origin])
  const { data: stalls } = useAsyncData(api.stalls, [])
  const { data: capabilities } = useAsyncData(api.capabilities, [])

  const stall = stalls?.[0]
  const selectedKey = `zaoyan-task:${origin}`
  // 异步回调里需要判断「用户是否已经切走」，用 ref 读取最新数据域。
  const scope = useRef(origin)
  scope.current = origin

  const bumpHistory = useCallback(() => setHistoryTick(v => v + 1), [])

  const live = useLiveCamera({
    origin, stallId: stall?.id, detector,
    onSessionEnded: () => { void reloadTasks(); bumpHistory() },
    notify,
  })

  /* --- 数据域切换时重置页面状态 --- */
  useEffect(() => {
    setReviewVideo(null)
    setTask(null)
    setTaskEvents([])
    setVideoUrl(null)
    setFile(null)
    setResultError('')
    setDetector(origin === 'REAL' ? 'yolo' : 'demo-color')
  }, [origin])

  /* --- 选中任务：优先恢复上次查看的，否则回退到最近一次上传任务 --- */
  useEffect(() => {
    if (task || !tasks?.length) return
    const saved = sessionStorage.getItem(selectedKey)
    const latest = tasks.find(t => t.id === saved) ?? tasks.find(t => t.mode === 'UPLOAD')
    if (latest) setTask(latest)
    // 保存的任务可能已被删除或属于别的数据域，此时按 id 单独校验一次。
    if (saved && !tasks.some(t => t.id === saved)) {
      void api.task(saved).then(t => {
        if (t.origin === scope.current) setTask(t)
      }).catch(() => {})
    }
  }, [tasks, origin, selectedKey, task])

  useEffect(() => {
    if (task && task.origin === origin) sessionStorage.setItem(selectedKey, task.id)
  }, [task, origin, selectedKey])

  /* --- 未完成任务轮询 --- */
  useEffect(() => {
    if (!task || !['QUEUED', 'RUNNING'].includes(task.status)) return
    let active = true
    let pending = false
    const timer = setInterval(async () => {
      if (pending) return
      pending = true
      try {
        const next = await api.task(task.id)
        if (active && next.origin === scope.current) setTask(next)
      } catch (e) {
        if (active) notify((e as Error).message, 'error')
      } finally {
        pending = false
      }
    }, 1500)
    return () => { active = false; clearInterval(timer) }
  }, [task, origin, notify])

  /* --- 任务结束后拉取事件与结果视频 --- */
  useEffect(() => {
    let active = true
    let url: string | null = null
    setTaskEvents([])
    setVideoUrl(null)
    setResultError('')
    if (!task || task.origin !== origin || !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) return

    void (async () => {
      try {
        const events = await api.taskEvents(task.id)
        if (active) setTaskEvents(events)
        if (task.hasResultVideo) {
          const blob = await authorizedBlob(`/tasks/${task.id}/video`)
          if (active) { url = URL.createObjectURL(blob); setVideoUrl(url) }
        }
        if (active) { void reloadTasks(); bumpHistory() }
      } catch (e) {
        if (active) setResultError((e as Error).message)
      }
    })()

    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [task, origin, reloadTasks, bumpHistory])

  /* --- 上传 --- */
  const chooseFile = (next: File | null) => {
    if (!next) return
    if (next.size > 200 * 1024 * 1024) { notify('请上传不超过 200MB 的视频', 'error'); return }
    if (!/\.(mp4|mov|avi|mkv|webm)$/i.test(next.name)) { notify('仅支持 MP4、MOV、AVI、MKV、WEBM', 'error'); return }
    setFile(next); setTask(null); setTaskEvents([]); setVideoUrl(null); setResultError('')
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    chooseFile(e.dataTransfer.files?.[0] ?? null)
  }

  const loadSample = async () => {
    if (origin !== 'SIMULATION') return
    try {
      const resp = await fetch('/samples/demo-trays.mp4')
      if (!resp.ok) throw new Error('无法读取内置样本')
      const blob = await resp.blob()
      if (scope.current !== 'SIMULATION') return
      chooseFile(new File([blob], 'zaoyan-synthetic-trays.mp4', { type: 'video/mp4' }))
      setDetector('demo-color')
      setRecordedAt(beijingInputNow())
      notify('已载入自建模拟视频，默认计数线下预计 3 次正向越线')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const upload = async () => {
    if (!file || !stall || uploading) return
    const submitted = origin
    setUploading(true)
    try {
      const result = await api.upload(file, origin, detector, stall.id, recordedAt ? toBeijingInstant(recordedAt) : undefined)
      if (scope.current !== submitted) return
      setTask(result)
      setTaskEvents([])
      notify(result.reusedUpload
        ? '检测到同一录像，已打开原任务，没有创建重复统计。重新分析请在任务历史中新建版本。'
        : '异步任务已创建，可以离开页面后再回来查看')
      bumpHistory()
      await reloadTasks()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const taskAction = async (action: 'cancel' | 'retry') => {
    if (!task || taskBusy) return
    if (action === 'cancel') {
      const ok = await confirm({
        title: '取消当前分析？',
        description: '尚未完成的结果不会导入事件台账。已处理的部分不会保留。',
        confirmText: '取消任务',
        cancelText: '继续分析',
        danger: true,
      })
      if (!ok) return
    }
    const id = task.id
    setTaskBusy(true)
    try {
      const next = action === 'cancel' ? await api.cancelTask(id) : await api.retryTask(id)
      if (next.origin === scope.current) setTask(next)
      await reloadTasks()
      notify(action === 'cancel'
        ? (next.status === 'CANCELLED' ? '任务已取消' : '任务已结束，未执行取消；请按当前状态查看结果')
        : '已重新提交分析，沿用原拍摄时间和计数线')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setTaskBusy(false)
    }
  }

  const switchTab = (next: Tab) => {
    if (next === 'upload') void live.stop(true)
    setTab(next)
  }

  const pendingReviews = taskEvents.filter(e => e.reviewStatus === 'PENDING').length
  const yoloBlocked = detector === 'yolo' && !capabilities?.yoloConfigured
  const showTask = task && task.origin === origin

  return (
    <>
      <PageTitle
        title="AI 出餐监测"
        description="检测 · 跟踪 · 越线 · 去重。让每一次出餐都有可追溯的记录。"
        actions={
          <SecondaryButton onClick={() => navigate('/settings')}>
            <Settings2 size={15} aria-hidden="true" /> 配置计数线
          </SecondaryButton>
        }
      />

      <div className="monitor-tabs">
        <div className="segmented segmented-lg" role="tablist" aria-label="监测方式">
          <button role="tab" aria-selected={tab === 'upload'} onClick={() => switchTab('upload')}>
            <FileVideo size={15} aria-hidden="true" /> 视频上传分析
          </button>
          <button role="tab" aria-selected={tab === 'live'} onClick={() => switchTab('live')}>
            <RadioTower size={15} aria-hidden="true" /> 实时摄像头
          </button>
        </div>
        <span className="monitor-rule">
          <ShieldCheck size={13} aria-hidden="true" /> 视频采集必须有合法授权
        </span>
      </div>

      {tab === 'upload' ? (
        <>
          <section className="card">
            <SectionTitle label="提交视觉分析任务" sub="Java 异步调用 Python，每帧真实计算，处理进度可查询" />

            <div
              className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="dropzone-icon" aria-hidden="true">
                {file ? <FileVideo size={22} strokeWidth={1.6} /> : <UploadCloud size={22} strokeWidth={1.6} />}
              </span>
              <strong>{file ? file.name : '拖拽出餐视频到这里'}</strong>
              <span className="dropzone-hint">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 已选择待上传文件`
                  : '支持 MP4、MOV、AVI、MKV、WEBM · 不超过 200MB'}
              </span>
              <div className="dropzone-actions">
                <label className="btn btn-primary">
                  <UploadCloud size={15} aria-hidden="true" /> {file ? '重新选择视频' : '选择本地视频'}
                  <input type="file" hidden
                    accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mkv"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => chooseFile(e.target.files?.[0] ?? null)} />
                </label>
                <button className="btn btn-secondary" onClick={() => void loadSample()} disabled={origin === 'REAL'}>
                  <Play size={14} aria-hidden="true" /> 使用模拟视频
                </button>
              </div>
            </div>

            <div className="monitor-config">
              <div className="field">
                <span className="field-label">识别算法模式</span>
                <div className="segmented">
                  <button aria-pressed={detector === 'demo-color'}
                    disabled={origin === 'REAL' || live.active || live.starting}
                    onClick={() => setDetector('demo-color')}>
                    模拟色块视觉检测
                  </button>
                  <button aria-pressed={detector === 'yolo'} onClick={() => setDetector('yolo')}>
                    YOLO + ByteTrack
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="recorded-at">视频开始拍摄时间（北京时间）</label>
                <input id="recorded-at" className="input" type="datetime-local" value={recordedAt}
                  onChange={e => setRecordedAt(e.target.value)} />
                <p className="field-hint">事件归档时间 = 拍摄开始时间 + 视频内偏移；历史视频不会全部计入今天。</p>
              </div>
            </div>

            <p className="monitor-mode-info">
              <Info size={14} aria-hidden="true" />
              {DETECTOR_COPY[detector]}
            </p>

            <div className="monitor-submit">
              <div>
                <strong>分析目标</strong>
                <span>{stall?.name ?? '正在读取档口'} · 固定计数线 · 单方向越线</span>
              </div>
              <PrimaryButton
                onClick={() => void upload()}
                disabled={!file || !stall || live.active || yoloBlocked}
                loading={uploading}
              >
                <ScanLine size={16} aria-hidden="true" /> 开始分析任务 <ArrowRight size={15} aria-hidden="true" />
              </PrimaryButton>
            </div>
          </section>

          {tasksError && (
            <div className="notice notice-danger" role="alert">{tasksError}</div>
          )}

          {yoloBlocked && (
            <div className="notice notice-warn" role="status">
              <CircleAlert size={15} aria-hidden="true" />
              <span>YOLO 依赖或权重尚未配置；真实识别未就绪，不能用模拟结果代替。可前往系统设置查看环境状态。</span>
            </div>
          )}

          {showTask && (
            <section className="card">
              <SectionTitle
                label="任务处理结果"
                sub={`任务编号 ${task.id.slice(0, 13)}… · ${task.detector === 'demo-color' ? '模拟视觉基线' : 'YOLO 模型'}`}
                action={<StatusTag status={task.status} />}
              />

              <div className="progress-row">
                <span>处理进度</span>
                <strong className="num">{task.progress}%</strong>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={task.progress}
                aria-valuemin={0} aria-valuemax={100} aria-label="任务处理进度">
                <span style={{ width: `${task.progress}%` }} />
              </div>

              {['FAILED', 'CANCELLED'].includes(task.status) ? (
                <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)' }}>
                  {task.errorMessage || '分析失败，请检查算法环境'}
                </div>
              ) : task.status === 'COMPLETED' ? (
                <>
                  <div className="result-stats">
                    <div><span>有效越线（机器初判）</span><strong className="num">{task.rawCount}</strong></div>
                    <div><span>处理视频帧数</span><strong className="num">{task.frameCount}</strong></div>
                    <div><span>事件待复核</span><strong className="num">{pendingReviews}</strong></div>
                  </div>

                  {videoUrl ? (
                    <div className="player">
                      <video controls playsInline src={videoUrl} />
                      <span className="player-mark">
                        AI ANNOTATED VIDEO · {origin === 'SIMULATION' ? 'SIMULATION' : 'REAL'}
                      </span>
                    </div>
                  ) : task.hasResultVideo && !resultError
                    ? <LoadingBlock height={180} />
                    : (
                      <p className="monitor-note">
                        {task.mode === 'LIVE'
                          ? '实时会话按隐私策略未保存视频，可进入台账复核结构化事件。'
                          : '没有可播放结果，详见任务状态。'}
                      </p>
                    )}

                  <button className="text-link" style={{ marginTop: 'var(--sp-5)' }}
                    onClick={() => navigate(`/events?taskId=${task.id}`)}>
                    前往人工复核 <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <p className="monitor-waiting">
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                  {task.mode === 'LIVE'
                    ? '实时监测仍在运行；摄像头会话在发起页面中停止。'
                    : 'Python 正在逐帧分析，可离开本页面后回来查看。'}
                </p>
              )}

              {resultError && (
                <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)' }}>
                  {resultError}
                </div>
              )}

              <div className="monitor-task-actions">
                {task.mode === 'UPLOAD' && ['QUEUED', 'RUNNING'].includes(task.status) && (
                  <SecondaryButton disabled={taskBusy} onClick={() => void taskAction('cancel')}>取消任务</SecondaryButton>
                )}
                {task.mode === 'UPLOAD' && ['FAILED', 'CANCELLED'].includes(task.status) && (
                  <SecondaryButton disabled={taskBusy} onClick={() => void taskAction('retry')}>重试分析</SecondaryButton>
                )}
                {videoUrl && (
                  <a className="btn btn-secondary" href={videoUrl} download={`zaoyan-${task.id}.mp4`}>保存标注视频</a>
                )}
              </div>

              <p className="monitor-note">
                开始拍摄：{timeText(task.recordedAt)} · 处理尝试：{task.attempt ?? 1} · 计数线使用提交时快照
              </p>
            </section>
          )}
        </>
      ) : (
        <section className="card">
          <SectionTitle
            label="实时摄像头视觉监测"
            sub="浏览器采集 JPEG 帧 → Spring Boot → 常驻 Python 算法进程"
            action={
              <span className={live.active ? 'live-badge is-on' : 'live-badge'}>
                <span aria-hidden="true" />{live.active ? '识别中' : '未连接'}
              </span>
            }
          />

          <div className="live-stage">
            <video ref={live.videoRef} muted playsInline autoPlay className="live-video" />
            <canvas ref={live.overlayRef} className="live-overlay" aria-hidden="true" />
            {!live.active && (
              <div className="live-placeholder">
                <Camera size={26} aria-hidden="true" />
                <h4>摄像头尚未连接</h4>
                <p>支持电脑或手机摄像头采集，适合受控的出餐模拟实验。</p>
              </div>
            )}
            {live.active && (
              <div className="live-count">
                <span>已检测有效越线</span>
                <strong className="num">{live.count}<small> 次</small></strong>
              </div>
            )}
          </div>

          {live.error && (
            <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)' }}>
              <CircleAlert size={15} aria-hidden="true" /><span>{live.error}</span>
            </div>
          )}

          <div className="live-controls">
            <div className="field">
              <span className="field-label">当前识别模式</span>
              <div className="segmented">
                <button aria-pressed={detector === 'demo-color'}
                  disabled={origin === 'REAL' || live.active || live.starting}
                  onClick={() => setDetector('demo-color')}>模拟色块</button>
                <button aria-pressed={detector === 'yolo'} disabled={live.active}
                  onClick={() => setDetector('yolo')}>YOLO 模型</button>
              </div>
            </div>
            {live.active ? (
              <button className="btn btn-danger" onClick={() => void live.stop()}>
                <Square size={15} aria-hidden="true" /> 结束监测
              </button>
            ) : (
              <PrimaryButton loading={live.starting} disabled={!stall || yoloBlocked}
                onClick={() => void live.start()}>
                <Play size={15} aria-hidden="true" /> 启动实时监测
              </PrimaryButton>
            )}
          </div>

          <p className="monitor-mode-info">
            <Info size={14} aria-hidden="true" />
            本地摄像头通常要求 HTTPS 或 localhost 环境。算法只传输抽样帧用于实时分析，默认不持久化原始视频，
            事件结果进入当前数据域。实际食堂采集必须取得授权。
          </p>

          {live.active && (
            <div className="live-stats">
              <div><span className="live-dot" aria-hidden="true" />实时监测中</div>
              <div>当前画面识别目标 <strong className="num">{live.boxes.length}</strong></div>
              <div>有效越线计数 <strong className="num">{live.count}</strong></div>
            </div>
          )}
        </section>
      )}

      {showTask && (
        <section className="card">
          <SectionTitle label="计数口径与规则快照" sub="修改设置不会追溯改变本任务；需要新建分析版本再选择是否启用" />
          <div className="monitor-snapshot">
            <StatusTag status={task.status} />
            <strong>{task.statsIncluded ? '当前参与统计' : '当前不参与统计'}</strong>
            <span>起始时间 {timeText(task.recordedAt)} · 时长 {task.durationSeconds?.toFixed(1) ?? '未知'} 秒</span>
            {task.mode === 'UPLOAD' && (task.hasSourceVideo || task.hasResultVideo) && (
              <SecondaryButton onClick={() => setReviewVideo(task)}>逐段复核 / 视频定位补录</SecondaryButton>
            )}
          </div>
          <details className="disclosure">
            <summary>查看不可变规则快照</summary>
            <pre className="rule-snapshot">
              {JSON.stringify({
                line: [task.lineX1, task.lineY1, task.lineX2, task.lineY2],
                direction: task.direction,
                ...task.rules,
              }, null, 2)}
            </pre>
          </details>
        </section>
      )}

      <TaskHistoryPanel
        origin={origin}
        refreshKey={historyTick}
        onSelect={t => {
          if (t.mode === 'LIVE') { navigate('/events?taskId=' + t.id); return }
          switchTab('upload')
          setTask(t)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      <section className="card pipeline">
        <div className="pipeline-head">
          <h3>从一帧画面到一条事件</h3>
          <p>四步都在本地完成，不上传原始视频到第三方服务。</p>
        </div>
        <ol className="pipeline-steps">
          {PIPELINE.map(({ n, name, detail }) => (
            <li key={n}>
              <span className="pipeline-num">{n}</span>
              <strong>{name}</strong>
              <small>{detail}</small>
            </li>
          ))}
        </ol>
        <p className="pipeline-privacy">
          <ShieldCheck size={14} aria-hidden="true" />
          尽量在受控场景拍摄，限制无关人员进入画面，不做人脸识别。上传分析前，识别区域外画面会被遮罩。
        </p>
      </section>

      {reviewVideo && (
        <VideoReviewDialog
          key={origin + reviewVideo.id}
          task={reviewVideo}
          onClose={() => setReviewVideo(null)}
          onSaved={() => {
            bumpHistory()
            void reloadTasks()
            if (task) {
              const id = task.id
              const domain = origin
              void api.taskEvents(id)
                .then(rows => { if (scope.current === domain) setTaskEvents(rows) })
                .catch(e => notify(e.message, 'error'))
            }
          }}
        />
      )}
    </>
  )
}

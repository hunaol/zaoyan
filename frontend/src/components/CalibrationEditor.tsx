import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Crosshair } from 'lucide-react'
import { type Stall } from '../lib/api'
import { SecondaryButton } from './Layout'
import './CalibrationEditor.css'

/** 画面标定：参考画面上的 ROI 框选与计数线绘制，支持精确输入坐标。 */
export default function CalibrationEditor({ stall, onChange, disabled }: {
  stall: Stall; onChange: (s: Stall) => void; disabled: boolean
}) {
  const [mode, setMode] = useState<'roi' | 'line'>('roi')
  const [background, setBackground] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [aspect, setAspect] = useState(16 / 9)
  const area = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const start = useRef<[number, number] | null>(null)
  const r = stall.rules

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  /** 把视频当前帧抓成静态背景，之后标定不再依赖视频播放状态。 */
  const frame = () => {
    const v = video.current
    if (!v?.videoWidth) return
    v.pause()
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    setBackground(c.toDataURL('image/jpeg', .8))
    setAspect(v.videoWidth / v.videoHeight)
  }

  const point = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const b = area.current!.getBoundingClientRect()
    return [
      Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    ]
  }

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !start.current) return
    const [x1, y1] = start.current
    const [x2, y2] = point(e)
    if (mode === 'line') onChange({ ...stall, lineX1: x1, lineY1: y1, lineX2: x2, lineY2: y2 })
    else onChange({ ...stall, rules: { ...r, roiX1: Math.min(x1, x2), roiY1: Math.min(y1, y2), roiX2: Math.max(x1, x2), roiY2: Math.max(y1, y2) } })
  }

  const pick = (file?: File) => {
    if (!file) return
    if (file.type.startsWith('video/')) { setVideoUrl(URL.createObjectURL(file)); return }
    setVideoUrl('')
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const image = new Image()
      image.onload = () => setAspect(image.width / image.height)
      image.src = src
      setBackground(src)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="calib">
      <div className="calib-actions">
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept="image/*,video/*"
          tabIndex={-1}
          aria-label="选择标定用的参考画面或视频文件"
          onChange={e => pick(e.target.files?.[0])}
        />
        <SecondaryButton onClick={() => fileInput.current?.click()}>选一张画面或视频做标定</SecondaryButton>
        <span className="calib-hint">只在浏览器本地预览，不上传该参考画面。</span>
      </div>

      {videoUrl && (
        <div className="calib-video">
          <video ref={video} className="calib-source" src={videoUrl} controls playsInline onLoadedData={frame} />
          <SecondaryButton onClick={frame}>使用当前帧作为标定背景</SecondaryButton>
        </div>
      )}

      <div className="segmented calib-modes" role="group" aria-label="标定方式">
        <button type="button" aria-pressed={mode === 'roi'} onClick={() => setMode('roi')}>
          拖动框选识别区域
        </button>
        <button type="button" aria-pressed={mode === 'line'} onClick={() => setMode('line')}>
          拖动绘制计数线
        </button>
      </div>

      <div
        ref={area}
        className="calib-canvas"
        aria-disabled={disabled}
        style={{ aspectRatio: aspect, backgroundImage: background ? `url(${background})` : undefined }}
        onPointerDown={e => {
          if (disabled) return
          e.preventDefault()
          start.current = point(e)
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={e => { move(e); start.current = null }}
        onPointerCancel={() => { start.current = null }}
      >
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="识别区域与计数线预览">
          <defs>
            <mask id="roi-mask">
              <rect width="1000" height="1000" fill="white" />
              <rect x={r.roiX1 * 1000} y={r.roiY1 * 1000} width={(r.roiX2 - r.roiX1) * 1000} height={(r.roiY2 - r.roiY1) * 1000} fill="black" />
            </mask>
          </defs>
          {/* 推理区域外整体压暗 */}
          <rect width="1000" height="1000" fill="#0a0a0a" opacity="0.6" mask="url(#roi-mask)" />
          {/* 推理区域边界 */}
          <rect x={r.roiX1 * 1000} y={r.roiY1 * 1000} width={(r.roiX2 - r.roiX1) * 1000} height={(r.roiY2 - r.roiY1) * 1000}
            stroke="#ffffff" strokeWidth="4" fill="none" />
          {/* 计数线：深色描边 + 白色主线，保证在任意画面上都可辨认 */}
          <line x1={stall.lineX1 * 1000} y1={stall.lineY1 * 1000} x2={stall.lineX2 * 1000} y2={stall.lineY2 * 1000}
            stroke="#0a0a0a" strokeWidth="9" opacity="0.45" />
          <line x1={stall.lineX1 * 1000} y1={stall.lineY1 * 1000} x2={stall.lineX2 * 1000} y2={stall.lineY2 * 1000}
            stroke="#ffffff" strokeWidth="4" />
          {/* 两个端点 */}
          <circle cx={stall.lineX1 * 1000} cy={stall.lineY1 * 1000} r="10" fill="#ffffff" stroke="#0a0a0a" strokeWidth="3" />
          <circle cx={stall.lineX2 * 1000} cy={stall.lineY2 * 1000} r="10" fill="#0a0a0a" stroke="#ffffff" strokeWidth="3" />
        </svg>
        <span className="calib-badge">
          <Crosshair size={13} aria-hidden="true" /> {mode === 'roi' ? '区域标定' : '计数线标定'}
        </span>
      </div>

      <p className="calib-hint">
        白色矩形是实际推理区域；计数线须落在区域内。区域外画面不会送入检测模型。画面改变或相机移动后需要重新标定。
      </p>

      <div className="grid calib-coords">
        {(['roiX1', 'roiY1', 'roiX2', 'roiY2'] as const).map(k => (
          <div className="field" key={k}>
            <label htmlFor={`roi-${k}`}>区域 {k.slice(3)}</label>
            <input id={`roi-${k}`} className="input num" type="number" min="0" max="1" step=".01" disabled={disabled}
              value={Number(r[k].toFixed(3))}
              onChange={e => onChange({ ...stall, rules: { ...r, [k]: Number(e.target.value) } })} />
          </div>
        ))}
        {(['lineX1', 'lineY1', 'lineX2', 'lineY2'] as const).map(k => (
          <div className="field" key={k}>
            <label htmlFor={`line-${k}`}>线段 {k.slice(4)}</label>
            <input id={`line-${k}`} className="input num" type="number" min="0" max="1" step=".01" disabled={disabled}
              value={Number(stall[k].toFixed(3))}
              onChange={e => onChange({ ...stall, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { EyeOff, Save, ShieldCheck, Video } from 'lucide-react'
import { api, defaultRules, slotName, type CountingRules, type Stall } from '../lib/api'
import { useAsyncData, useWorkspace } from '../lib/context'
import { LoadingBlock, PageTitle, PrimaryButton, SecondaryButton, SectionTitle } from '../components/Layout'
import CalibrationEditor from '../components/CalibrationEditor'
import './SettingsPage.css'

/** 检测与异常复核规则：字段声明与后端规则快照一一对应。 */
const RULE_FIELDS = [
  ['confidence', '检测置信度下限', .05, .95, .01],
  ['reviewConfidence', '低置信复核阈值', .05, 1, .01],
  ['stableFrames', '每侧最少连续稳定帧', 1, 15, 1],
  ['deadzone', '越线死区（画面比例）', .001, .1, .001],
  ['maxGapSeconds', '轨迹断开阈值（秒）', .1, 30, .1],
  ['duplicateWindowSeconds', '相近越线预警窗口（秒）', 0, 10, .1],
  ['duplicateDistance', '相近越线预警距离（比例）', 0, .3, .01],
] as const

export default function SettingsPage() {
  const { user, notify } = useWorkspace()
  const { data, loading, error, refresh } = useAsyncData(api.stalls, [])
  const { data: capabilities, loading: checking, error: runtimeError, refresh: checkRuntime } = useAsyncData(api.capabilities, [])
  const [stall, setStall] = useState<Stall | null>(null)
  const [saving, setSaving] = useState(false)
  const [targets, setTargets] = useState('')
  const [empty, setEmpty] = useState('')

  useEffect(() => {
    if (data?.length) {
      const s = { ...data[0], rules: data[0].rules || defaultRules }
      setStall(s)
      setTargets(s.rules.targetLabels.join(', '))
      setEmpty(s.rules.emptyLabels.join(', '))
    }
  }, [data])

  const disabled = user?.role !== 'ADMIN'
  const updateRule = (k: keyof CountingRules, v: number | string) =>
    setStall(s => (s ? { ...s, rules: { ...s.rules, [k]: v } } : s))
  const labels = (s: string) =>
    s.split(/[,，\n]/).map(x => x.trim().toLowerCase()).filter(Boolean)

  const save = async () => {
    if (!stall) return
    setSaving(true)
    try {
      const { id, createdAt, ...dto } = stall
      dto.rules = { ...dto.rules, targetLabels: labels(targets), emptyLabels: labels(empty) }
      await api.saveStall(id, dto)
      notify('识别区域、计数规则与餐次设置已保存，新任务使用新快照')
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageTitle
        title="档口与算法设置"
        description="从画面标定到事件口径，这里保存的设置会直接传给算法，而不只是页面参数。"
      />

      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {disabled && (
        <div className="notice notice-warn" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>操作员只可查看；配置修改需要管理员权限。</span>
        </div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : stall && (
        <>
          {/* ---- 场景口径 + 画面标定 ---- */}
          <section className="settings-split">
            <div className="card">
              <SectionTitle label="场景与计数口径" sub="首版：单档口、固定机位；默认统计容器交付事件" />

              <div className="settings-fields">
                <div className="field">
                  <label htmlFor="stall-name">档口名称</label>
                  <input id="stall-name" className="input" value={stall.name} maxLength={90} disabled={disabled}
                    onChange={e => setStall({ ...stall, name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="stall-location">位置 / 场景</label>
                  <input id="stall-location" className="input" value={stall.location} maxLength={90} disabled={disabled}
                    onChange={e => setStall({ ...stall, location: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="stall-direction">有效方向（相对于从端点 1 到端点 2 的有向线段）</label>
                  <select id="stall-direction" className="select" value={stall.direction} disabled={disabled}
                    onChange={e => setStall({ ...stall, direction: e.target.value as Stall['direction'] })}>
                    <option value="positive">负侧 → 正侧（水平左到右线：上 → 下）</option>
                    <option value="negative">正侧 → 负侧（水平左到右线：下 → 上）</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="stall-nesting">托盘包含餐盒时</label>
                  <select id="stall-nesting" className="select" value={stall.rules.nestingPolicy} disabled={disabled}
                    onChange={e => updateRule('nestingPolicy', e.target.value)}>
                    <option value="OUTER">只数外层容器：一次托盘交付记一次</option>
                    <option value="INNER">只数内层容器：按各独立餐盒计次</option>
                  </select>
                </div>
              </div>

              <p className="settings-note">
                先记“容器出餐次数”，不自动等同于餐食份数或营业销量。空容器仅在模型具备相应类别时自动排除，其余由人工复核。
              </p>
            </div>

            <div className="card">
              <SectionTitle label="画面标定" sub="支持从实际参考画面框选区域、绘制线段，也可精确输入坐标" />
              <CalibrationEditor stall={stall} onChange={setStall} disabled={disabled} />
            </div>
          </section>

          {/* ---- 检测与复核规则 ---- */}
          <section className="card">
            <SectionTitle label="检测与异常复核规则" sub="稳定帧和轨迹去重减少抖动；相近越线仅预警，不武断删除连续正常出餐" />

            <div className="grid settings-rules">
              {RULE_FIELDS.map(([key, label, min, max, step]) => (
                <div className="field" key={key}>
                  <label htmlFor={`rule-${key}`}>{label}</label>
                  <input id={`rule-${key}`} className="input" type="number" min={min} max={max} step={step} disabled={disabled}
                    value={stall.rules[key]}
                    onChange={e => updateRule(key, Number(e.target.value))} />
                </div>
              ))}
            </div>

            <div className="settings-labels">
              <div className="field">
                <label htmlFor="target-labels">计数目标类别（与模型 names 对齐，逗号或换行分隔）</label>
                <textarea id="target-labels" className="textarea" disabled={disabled} value={targets}
                  onChange={e => setTargets(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="empty-labels">明确的空容器类别（模型没有这些类别时，不会凭空判断空餐盘）</label>
                <textarea id="empty-labels" className="textarea" disabled={disabled} value={empty}
                  onChange={e => setEmpty(e.target.value)} />
              </div>
            </div>

            <p className="settings-note">
              自建模拟算法独立使用 demo-tray 标签。真实模式必须提供本地受信任的 YOLO 权重；启动时会检查模型类别是否与计数类别相交。
            </p>
          </section>

          {/* ---- 餐次时间 ---- */}
          <section className="card">
            <SectionTitle label="餐次时间与台账结算" sub="以下初始时间是演示预设，可按实际营业时段修改；时间统一为北京时间，左闭右开、不重叠" />

            <div className="grid grid-3 settings-meals">
              {stall.rules.meals.map((m, i) => (
                <div className="field" key={m.slot}>
                  <label htmlFor={`meal-${m.slot}-start`}>{slotName[m.slot]}</label>
                  <div className="settings-meal-row">
                    <input id={`meal-${m.slot}-start`} className="input" type="time" disabled={disabled} value={m.start}
                      aria-label={`${slotName[m.slot]}开始时间`}
                      onChange={e => setStall({ ...stall, rules: { ...stall.rules, meals: stall.rules.meals.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) } })} />
                    <span aria-hidden="true">至</span>
                    <input id={`meal-${m.slot}-end`} className="input" type="time" disabled={disabled} value={m.end}
                      aria-label={`${slotName[m.slot]}结束时间`}
                      onChange={e => setStall({ ...stall, rules: { ...stall.rules, meals: stall.rules.meals.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) } })} />
                  </div>
                </div>
              ))}
            </div>

            <p className="settings-note">
              改餐次时间后，历史事件结算台账会标记为需重新核实，旧数量仍保留；不会无提示改写已有预测依据。
            </p>
          </section>

          {/* ---- 运行状态与隐私边界 ---- */}
          <section className="card">
            <SectionTitle
              label="运行状态与隐私边界"
              sub="真实检查，不自动联网安装依赖或下载权重"
              action={<SecondaryButton onClick={() => void checkRuntime()}>重新检测</SecondaryButton>}
            />

            {runtimeError && <div className="notice notice-danger" role="alert">{runtimeError}</div>}

            {checking ? (
              <LoadingBlock height={90} />
            ) : (
              <>
                <div className="settings-runtime">
                  {[
                    ['Python', capabilities?.python || '不可用'],
                    ['模拟视觉', capabilities?.demoReady ? '可用' : '未就绪'],
                    ['FFmpeg', capabilities?.ffmpeg ? '可用' : '未就绪'],
                    ['YOLO 配置', capabilities?.yoloConfigured ? '依赖及文件已配置' : '未完整配置'],
                  ].map(([name, value]) => (
                    <div className="settings-runtime-cell" key={name}>
                      <span>{name}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <p className="settings-note">{capabilities?.notice || '尚无运行状态'}</p>
              </>
            )}

            <div className="settings-policy">
              <div className="settings-policy-item">
                <span className="settings-policy-icon" aria-hidden="true"><ShieldCheck size={17} /></span>
                <strong>实时监测</strong>
                <p>默认不保存原始帧。</p>
              </div>
              <div className="settings-policy-item">
                <span className="settings-policy-icon" aria-hidden="true"><Video size={17} /></span>
                <strong>上传录像</strong>
                <p>用于认证后的回看。</p>
              </div>
              <div className="settings-policy-item">
                <span className="settings-policy-icon" aria-hidden="true"><EyeOff size={17} /></span>
                <strong>标注导出</strong>
                <p>遮盖识别区域外画面。</p>
              </div>
            </div>
            <p className="settings-note">这里不提供人脸识别或个人身份跟踪。</p>
          </section>

          {/* ---- 保存 ---- */}
          <div className="card settings-savebar">
            <div>
              <strong>保存后用于新任务</strong>
              <p>正在运行及历史任务继续使用各自的完整规则快照。</p>
            </div>
            <PrimaryButton loading={saving} disabled={disabled} onClick={() => void save()}>
              <Save size={17} aria-hidden="true" /> 保存全部设置
            </PrimaryButton>
          </div>
        </>
      )}
    </>
  )
}

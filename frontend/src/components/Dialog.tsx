import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'

/**
 * 界面内确认框 / 输入框。
 *
 * v1 直接用 `window.confirm` 和 `window.prompt`，它们有三个问题：
 * 一是样式由浏览器决定，和这套界面放在一起非常突兀；
 * 二是阻塞主线程，动画和加载状态都会卡住；
 * 三是 prompt 无法做长度限制和必填校验，只能事后在业务代码里再判断一次。
 *
 * 这里把两者换成同一套 Promise API，调用点从
 *   if (!window.confirm('…')) return
 *   const note = window.prompt('…')
 * 变成
 *   if (!(await confirm({ title: '…' }))) return
 *   const note = await prompt({ title: '…' })
 * 语义保持一致，只是从同步阻塞变成等待。
 */

type ConfirmOptions = {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 破坏性操作用红色确认按钮，避免「取消任务」和「保存」长得一样。 */
  danger?: boolean
}

type PromptOptions = ConfirmOptions & {
  label?: string
  placeholder?: string
  defaultValue?: string
  maxLength?: number
  /** 必填时确认按钮在输入为空的情况下禁用。 */
  required?: boolean
  hint?: string
}

type Item =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
}

const DialogContext = createContext<DialogApi | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  // 队列而非单个槽位：理论上可能存在「确认后立刻再确认」的连续操作，
  // 用队列可以保证前一个的 Promise 已经结算，不会出现丢失 resolve。
  const [items, setItems] = useState<Item[]>([])

  const confirm = useCallback((options: ConfirmOptions) =>
    new Promise<boolean>(resolve => {
      setItems(prev => [...prev, { kind: 'confirm', options, resolve }])
    }), [])

  const prompt = useCallback((options: PromptOptions) =>
    new Promise<string | null>(resolve => {
      setItems(prev => [...prev, { kind: 'prompt', options, resolve }])
    }), [])

  const settle = useCallback((item: Item, value: boolean | string | null) => {
    if (item.kind === 'confirm') item.resolve(value as boolean)
    else item.resolve(value as string | null)
    setItems(prev => prev.filter(i => i !== item))
  }, [])

  const api = { confirm, prompt }

  return (
    <DialogContext.Provider value={api}>
      {children}
      <DialogHost item={items[0] ?? null} onSettle={settle} />
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('DialogProvider is missing')
  return ctx
}

function DialogHost({ item, onSettle }: {
  item: Item | null
  onSettle: (item: Item, value: boolean | string | null) => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次换一条请求时重置输入值并聚焦。
  useEffect(() => {
    if (!item) return
    setValue(item.kind === 'prompt' ? (item.options.defaultValue ?? '') : '')
    if (item.kind === 'prompt') {
      // 等一帧，确保 input 已经挂载。
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [item])

  // 打开时锁滚动，Esc 关闭。关掉后恢复原来的 overflow。
  useEffect(() => {
    if (!item) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
    // cancel 依赖 item，item 变化时需要重新绑定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  if (!item) return null

  const { options } = item
  const isPrompt = item.kind === 'prompt'
  const promptOptions = isPrompt ? (options as PromptOptions) : null
  const blocked = isPrompt && promptOptions?.required === true && value.trim() === ''

  const cancel = () => onSettle(item, item.kind === 'confirm' ? false : null)
  const accept = () => onSettle(item, item.kind === 'confirm' ? true : value.trim())

  const confirmLabel = options.confirmText ?? (item.kind === 'confirm' && options.danger ? '确认执行' : '确认')

  return (
    <>
      <div className="backdrop" onClick={cancel} />
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label={options.title}>
        <div className="modal-body dialog-body">
          <h3>{options.title}</h3>
          {options.description && <p className="dialog-desc">{options.description}</p>}

          {isPrompt && (
            <div className="field dialog-field">
              {promptOptions?.label && <label htmlFor="dialog-input">{promptOptions.label}</label>}
              <input
                id="dialog-input"
                ref={inputRef}
                className="input"
                value={value}
                maxLength={promptOptions?.maxLength}
                placeholder={promptOptions?.placeholder}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !blocked) accept() }}
              />
              {promptOptions?.hint && <p className="field-hint">{promptOptions.hint}</p>}
              {promptOptions?.maxLength && (
                <p className="field-hint dialog-count">{value.length} / {promptOptions.maxLength}</p>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={cancel}>
            {options.cancelText ?? '取消'}
          </button>
          <button
            className={`btn ${options.danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={accept}
            disabled={blocked}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

/* 全局样式必须在最前求值。
   ES 模块按声明顺序执行，页面组件内部 import 的 CSS 会在这之后加载，
   于是页面自己的规则能覆盖全局层的同名类——这正是我们想要的优先级方向。 */
import './styles/index.css'

import App from './App'
import { WorkspaceProvider } from './lib/context'
import { DialogProvider } from './components/Dialog'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WorkspaceProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </WorkspaceProvider>
    </BrowserRouter>
  </React.StrictMode>
)

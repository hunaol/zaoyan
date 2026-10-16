import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import App from './App'
import {WorkspaceProvider} from './lib/context'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><WorkspaceProvider><App/></WorkspaceProvider></BrowserRouter></React.StrictMode>
)

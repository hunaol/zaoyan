import {Navigate,Route,Routes} from 'react-router-dom'
import {useWorkspace} from './lib/context'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import MonitorPage from './pages/MonitorPage'
import EventsPage from './pages/EventsPage'
import PlanningPage from './pages/PlanningPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'

export default function App(){
  const {user}=useWorkspace()
  if(!user)return <Routes><Route path="/login" element={<LoginPage/>}/><Route path="*" element={<Navigate replace to="/login"/>}/></Routes>
  return <Layout><Routes>
    <Route path="/dashboard" element={<DashboardPage/>}/><Route path="/monitor" element={<MonitorPage/>}/>
    <Route path="/events" element={<EventsPage/>}/><Route path="/planning" element={<PlanningPage/>}/>
    <Route path="/reports" element={<ReportsPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
    <Route path="*" element={<Navigate replace to="/dashboard"/>}/>
  </Routes></Layout>
}

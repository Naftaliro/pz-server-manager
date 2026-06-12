import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ServerEditor from './pages/ServerEditor'
import SandboxEditor from './pages/SandboxEditor'
import ModManager from './pages/ModManager'
import Console from './pages/Console'
import InstallServer from './pages/InstallServer'
import RawFileEditor from './pages/RawFileEditor'
import LoadingOverlay from './components/LoadingOverlay'
import UpdateBanner from './components/UpdateBanner'

export default function App() {
  const { activeView, setProfiles, setServerStatus } = useAppStore()

  useEffect(() => {
    // Load profiles on startup
    window.electronAPI.profiles.list().then(profiles => {
      setProfiles(profiles)
    })

    // Subscribe to server status changes
    const unsubStatus = window.electronAPI.server.onStatusChange((profileId, status) => {
      setServerStatus(profileId, status as 'stopped' | 'starting' | 'running' | 'stopping')
    })

    // Get initial statuses
    window.electronAPI.server.getAllStatuses().then(statuses => {
      Object.entries(statuses).forEach(([id, status]) => {
        setServerStatus(id, status as 'stopped' | 'starting' | 'running' | 'stopping')
      })
    })

    return () => {
      unsubStatus()
    }
  }, [])

  const renderView = () => {
    switch (activeView) {
      case 'dashboard': return <Dashboard />
      case 'editor': return <ServerEditor />
      case 'sandbox': return <SandboxEditor />
      case 'mods': return <ModManager />
      case 'console': return <Console />
      case 'install': return <InstallServer />
      case 'raweditor': return <RawFileEditor />
      default: return <Dashboard />
    }
  }

  return (
    <div className="flex flex-col h-full bg-pz-dark text-pz-text">
      <TitleBar />
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {renderView()}
        </main>
      </div>
      <LoadingOverlay />
    </div>
  )
}

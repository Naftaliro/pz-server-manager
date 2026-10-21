import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import type { ServerStatus } from './store/useAppStore'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Setup from './pages/Setup'
import Home from './pages/Home'
import CreateServer from './pages/CreateServer'
import ServerPage from './pages/ServerPage'
import AppSettings from './pages/AppSettings'
import ServerEditor from './pages/ServerEditor'
import SandboxEditor from './pages/SandboxEditor'
import RawFileEditor from './pages/RawFileEditor'
import LoadingOverlay from './components/LoadingOverlay'
import UpdateBanner from './components/UpdateBanner'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const {
    activeView, setActiveView, settings, setSettings, profiles, setProfiles,
    setServerStatus, appendConsoleLog, setPlayers, addProblem,
  } = useAppStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    (async () => {
      let [s, list] = await Promise.all([window.electronAPI.settings.get(), window.electronAPI.profiles.list()])
      setProfiles(list)

      // people upgrading from the old version already have a server installed, skip the setup screen for them
      if (!s.setupComplete) {
        const candidates = [s.serverInstallPath, ...list.map(p => p.serverInstallPath)].filter(Boolean)
        for (const dir of candidates) {
          if (await window.electronAPI.steamcmd.checkInstalled(dir)) {
            s = await window.electronAPI.settings.set({ setupComplete: true, serverInstallPath: dir })
            break
          }
        }
      }
      setSettings(s)
      setActiveView(s.setupComplete ? 'home' : 'setup')
      setReady(true)
    })()

    const unsubs = [
      window.electronAPI.server.onStatusChange((id, status) => setServerStatus(id, status as ServerStatus)),
      window.electronAPI.server.onPlayers((id, names) => setPlayers(id, names)),
      window.electronAPI.server.onProblem((id, problem) => addProblem(id, problem)),
    ]
    window.electronAPI.server.getAllStatuses().then(statuses => {
      Object.entries(statuses).forEach(([id, status]) => setServerStatus(id, status as ServerStatus))
    })
    return () => unsubs.forEach(fn => fn())
  }, [])

  // console output for every server, collected here so nothing is lost while you're on another page
  const profileIds = profiles.map(p => p.id).join(',')
  useEffect(() => {
    const unsubs = profiles.map(p => window.electronAPI.server.onConsoleOutput(p.id, line => appendConsoleLog(p.id, line)))
    return () => unsubs.forEach(fn => fn())
  }, [profileIds])

  const renderView = () => {
    switch (activeView) {
      case 'setup': return <Setup />
      case 'home': return <Home />
      case 'create': return <CreateServer />
      case 'server': return <ServerPage />
      case 'appsettings': return <AppSettings />
      case 'editor': return <ServerEditor />
      case 'sandbox': return <SandboxEditor />
      case 'raweditor': return <RawFileEditor />
      default: return <Home />
    }
  }

  const showSidebar = ready && settings?.setupComplete && activeView !== 'setup'

  return (
    <div className="flex flex-col h-full bg-pz-dark text-pz-text">
      <TitleBar />
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && <Sidebar />}
        <main className="flex-1 overflow-hidden">
          <ErrorBoundary key={activeView}>{ready ? renderView() : null}</ErrorBoundary>
        </main>
      </div>
      <LoadingOverlay />
    </div>
  )
}

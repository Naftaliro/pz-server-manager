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
import Play from './pages/Play'
import LoadingOverlay from './components/LoadingOverlay'
import UpdateBanner from './components/UpdateBanner'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const {
    activeView, setActiveView, settings, setSettings, profiles, setProfiles,
    setServerStatus, appendConsoleLog, setPlayers, addProblem, setModUpdates,
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
            s = await window.electronAPI.settings.set({ setupComplete: true, serverInstallPath: dir, role: 'host' })
            break
          }
        }
      }
      setSettings(s)
      // players who only join friends' servers land on Play, hosts on their servers
      setActiveView(!s.setupComplete ? 'setup' : s.role === 'player' ? 'play' : 'home')
      // picking the first page isn't somewhere to go back to. The move is recorded in a
      // microtask, so the reset is queued behind it
      queueMicrotask(() => useAppStore.getState().resetNav())
      setReady(true)
    })()

    const unsubs = [
      window.electronAPI.server.onStatusChange((id, status) => setServerStatus(id, status as ServerStatus)),
      window.electronAPI.server.onPlayers((id, names) => setPlayers(id, names)),
      window.electronAPI.server.onProblem((id, problem) => addProblem(id, problem)),
      window.electronAPI.server.onModUpdates((id, names) => setModUpdates(id, names)),
    ]
    window.electronAPI.server.getAllStatuses().then(statuses => {
      Object.entries(statuses).forEach(([id, status]) => setServerStatus(id, status as ServerStatus))
    })
    return () => unsubs.forEach(fn => fn())
  }, [])

  // the back/forward buttons on the side of a mouse, and alt+left/right, move through the
  // pages you've been on. Inside the Workshop browser they go back a Workshop page instead,
  // because those clicks land in the webview and never reach this window
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      // stop Chromium doing its own back/forward on top of ours
      e.preventDefault()
      if (e.type !== 'mouseup') return
      const { goBack, goForward } = useAppStore.getState()
      if (e.button === 3) goBack()
      else goForward()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.defaultPrevented) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const { goBack, goForward } = useAppStore.getState()
      if (e.key === 'ArrowLeft') goBack()
      else goForward()
    }
    window.addEventListener('mousedown', onMouse)
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouse)
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
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
      case 'play': return <Play />
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

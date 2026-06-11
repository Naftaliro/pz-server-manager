import { useState, useRef, useEffect } from 'react'
import { Download, FolderOpen, CheckCircle, AlertCircle, Terminal, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

type Step = 'idle' | 'downloading-steamcmd' | 'installing-server' | 'done' | 'error' | 'checking'

export default function InstallServer() {
  const { setActiveView } = useAppStore()
  const [steamcmdDir, setSteamcmdDir] = useState('C:\\PZServerManager\\steamcmd')
  const [serverDir, setServerDir] = useState('C:\\PZServer')
  const [step, setStep] = useState<Step>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [steamcmdPath, setSteamcmdPath] = useState('')
  const [serverInstalled, setServerInstalled] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const addLog = (line: string) => {
    setLogs(prev => [...prev, line])
  }

  const browseFolder = async (setter: (v: string) => void) => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (folder) setter(folder)
  }

  const checkInstalled = async () => {
    const installed = await window.electronAPI.steamcmd.checkInstalled(serverDir)
    setServerInstalled(installed)
    return installed
  }

  const handleInstall = async () => {
    setLogs([])
    setErrorMsg('')

    try {
      // Step 1: Download SteamCMD
      setStep('downloading-steamcmd')
      addLog('=== Downloading SteamCMD ===')
      addLog(`Target directory: ${steamcmdDir}`)

      const dlResult = await window.electronAPI.steamcmd.download(steamcmdDir)
      if (!dlResult.success) {
        throw new Error(dlResult.message)
      }
      addLog(`✓ ${dlResult.message}`)
      setSteamcmdPath(dlResult.path || `${steamcmdDir}\\steamcmd.exe`)

      // Step 2: Install server
      setStep('installing-server')
      addLog('')
      addLog('=== Installing Project Zomboid Dedicated Server ===')
      addLog('This may take several minutes depending on your connection...')
      addLog('')

      const installResult = await window.electronAPI.steamcmd.installServer(
        dlResult.path || `${steamcmdDir}\\steamcmd.exe`,
        serverDir,
        (line) => addLog(line)
      )

      if (!installResult.success) {
        throw new Error(installResult.message)
      }

      addLog('')
      addLog('=== Installation Complete! ===')
      addLog(`Server files installed to: ${serverDir}`)
      setStep('done')
      setServerInstalled(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      addLog(`ERROR: ${msg}`)
      setStep('error')
    }
  }

  const handleUpdate = async () => {
    setLogs([])
    setErrorMsg('')
    setStep('installing-server')
    addLog('=== Updating Project Zomboid Dedicated Server ===')

    try {
      const result = await window.electronAPI.steamcmd.updateServer(
        `${steamcmdDir}\\steamcmd.exe`,
        serverDir,
        (line) => addLog(line)
      )

      if (!result.success) throw new Error(result.message)

      addLog('')
      addLog('=== Update Complete! ===')
      setStep('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      addLog(`ERROR: ${msg}`)
      setStep('error')
    }
  }

  const isRunning = step === 'downloading-steamcmd' || step === 'installing-server'

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-pz-text">Install Server Files</h1>
          <p className="text-sm text-pz-muted mt-1">
            Download SteamCMD and install the Project Zomboid dedicated server files.
          </p>
        </div>

        {/* Config form */}
        <div className="card p-5 mb-4 space-y-4">
          <h2 className="section-title">Configuration</h2>

          <div>
            <label className="label">SteamCMD Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={steamcmdDir}
                onChange={e => setSteamcmdDir(e.target.value)}
                className="input"
                placeholder="C:\PZServerManager\steamcmd"
                disabled={isRunning}
              />
              <button
                onClick={() => browseFolder(setSteamcmdDir)}
                className="btn-outline flex-shrink-0"
                disabled={isRunning}
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <p className="text-xs text-pz-muted mt-1">Where to download and store SteamCMD</p>
          </div>

          <div>
            <label className="label">Server Install Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={serverDir}
                onChange={e => setServerDir(e.target.value)}
                className="input"
                placeholder="C:\PZServer"
                disabled={isRunning}
              />
              <button
                onClick={() => browseFolder(setServerDir)}
                className="btn-outline flex-shrink-0"
                disabled={isRunning}
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <p className="text-xs text-pz-muted mt-1">Where to install the PZ dedicated server files (~4 GB)</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={handleInstall}
            disabled={isRunning}
            className="btn-primary flex-1 justify-center"
          >
            <Download size={16} />
            {isRunning ? (
              step === 'downloading-steamcmd' ? 'Downloading SteamCMD...' : 'Installing Server...'
            ) : 'Install Server'}
          </button>

          <button
            onClick={handleUpdate}
            disabled={isRunning}
            className="btn-outline"
            title="Update existing server installation"
          >
            <RefreshCw size={16} />
            Update
          </button>

          <button
            onClick={checkInstalled}
            disabled={isRunning}
            className="btn-ghost"
            title="Check if server is installed"
          >
            Check
          </button>
        </div>

        {/* Status indicators */}
        {step === 'done' && (
          <div className="flex items-center gap-2 text-pz-green bg-pz-green/10 border border-pz-green/20 rounded-lg px-4 py-3 mb-4">
            <CheckCircle size={16} />
            <span className="text-sm font-medium">Server installed successfully! You can now create server profiles.</span>
          </div>
        )}

        {step === 'error' && (
          <div className="flex items-start gap-2 text-pz-red bg-pz-red/10 border border-pz-red/20 rounded-lg px-4 py-3 mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Installation failed</p>
              <p className="text-xs mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {serverInstalled && step === 'idle' && (
          <div className="flex items-center gap-2 text-pz-blue bg-pz-blue/10 border border-pz-blue/20 rounded-lg px-4 py-3 mb-4">
            <CheckCircle size={16} />
            <span className="text-sm">Server files detected at the specified directory.</span>
          </div>
        )}

        {/* Progress steps */}
        {step !== 'idle' && (
          <div className="flex items-center gap-4 mb-4">
            <StepIndicator
              label="Download SteamCMD"
              status={
                step === 'downloading-steamcmd' ? 'active' : 'done'
              }
            />
            <div className="flex-1 h-px bg-pz-border" />
            <StepIndicator
              label="Install Server"
              status={
                step === 'installing-server' ? 'active' :
                step === 'done' ? 'done' :
                'pending'
              }
            />
          </div>
        )}

        {/* Console log */}
        {logs.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-pz-border bg-pz-darker">
              <Terminal size={14} className="text-pz-muted" />
              <span className="text-xs font-medium text-pz-muted">Installation Log</span>
            </div>
            <div className="p-4 max-h-64 overflow-y-auto bg-pz-darker console-output">
              {logs.map((line, i) => (
                <div key={i} className={`${
                  line.startsWith('ERROR') ? 'text-pz-red' :
                  line.startsWith('✓') || line.includes('Complete') ? 'text-pz-green' :
                  line.startsWith('===') ? 'text-pz-yellow font-medium' :
                  'text-pz-muted'
                }`}>
                  {line || '\u00A0'}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Next steps */}
        {step === 'done' && (
          <div className="mt-4 p-4 bg-pz-card border border-pz-border rounded-lg">
            <h3 className="text-sm font-semibold text-pz-text mb-2">Next Steps</h3>
            <ol className="text-sm text-pz-muted space-y-1 list-decimal list-inside">
              <li>Create a new server profile from the Dashboard</li>
              <li>Set the server install path to: <code className="text-pz-green">{serverDir}</code></li>
              <li>Configure mods, sandbox settings, and server options</li>
              <li>Start your server!</li>
            </ol>
            <button
              onClick={() => setActiveView('editor')}
              className="btn-primary mt-3"
            >
              Create Server Profile
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StepIndicator({ label, status }: { label: string; status: 'pending' | 'active' | 'done' }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
        status === 'done' ? 'bg-pz-green text-pz-darker' :
        status === 'active' ? 'bg-pz-yellow text-pz-darker' :
        'bg-pz-border text-pz-muted'
      }`}>
        {status === 'done' ? '✓' : status === 'active' ? '●' : '○'}
      </div>
      <span className={`text-xs ${
        status === 'active' ? 'text-pz-yellow' :
        status === 'done' ? 'text-pz-green' :
        'text-pz-muted'
      }`}>{label}</span>
    </div>
  )
}

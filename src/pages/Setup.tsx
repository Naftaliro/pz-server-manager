import { useState } from 'react'
import { Server, FolderOpen, ArrowRight, CheckCircle, HardDrive } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import InstallRunner from '../components/InstallRunner'

// First launch: one screen to explain, one to pick a folder and install. That's it.
export default function Setup() {
  const { settings, setSettings, setActiveView } = useAppStore()
  const [step, setStep] = useState<'welcome' | 'install'>('welcome')
  const [serverDir, setServerDir] = useState(settings?.serverInstallPath || 'C:\\PZServer')
  const [alreadyThere, setAlreadyThere] = useState(false)
  const [checking, setChecking] = useState(false)

  const pickFolder = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (!folder) return
    // pointed at an existing install (or a folder containing one)? use that
    const found = await window.electronAPI.fs.findServerBat(folder)
    setServerDir(found.success && found.path ? found.path : folder)
    setAlreadyThere(!!found.success)
  }

  const finish = async () => {
    const next = await window.electronAPI.settings.set({ setupComplete: true, serverInstallPath: serverDir })
    setSettings(next)
    setActiveView('home')
  }

  const checkExisting = async () => {
    setChecking(true)
    setAlreadyThere(await window.electronAPI.steamcmd.checkInstalled(serverDir))
    setChecking(false)
  }

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        {step === 'welcome' ? (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-pz-green/15 border border-pz-green/30 flex items-center justify-center">
              <Server size={38} className="text-pz-green" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-pz-text">Welcome to PZ Server Manager</h1>
              <p className="text-pz-subtext mt-2">
                Host your own Project Zomboid server for you and your friends, with mods, without touching a single config file.
              </p>
            </div>
            <div className="card p-4 text-left space-y-2 text-sm text-pz-subtext">
              <p className="text-pz-text font-medium">Here's how it goes:</p>
              <p>1. Download the game server once (free, about 5 GB)</p>
              <p>2. Create a server and pick a difficulty</p>
              <p>3. Add mods from the Workshop if you want</p>
              <p>4. Hit Start and send your friends the address</p>
            </div>
            <button onClick={() => { setStep('install'); checkExisting() }} className="btn-primary px-8 py-3 mx-auto">
              Get started <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">Download the game server</h1>
              <p className="text-sm text-pz-subtext mt-1">
                This is the program that actually runs your world. It's separate from the game you play, and you only download it once.
              </p>
            </div>

            <div className="card p-4 space-y-2">
              <label className="label">Where to put it</label>
              <div className="flex gap-2">
                <input value={serverDir} onChange={e => { setServerDir(e.target.value); setAlreadyThere(false) }} onBlur={checkExisting} className="input" />
                <button onClick={pickFolder} className="btn-outline flex-shrink-0" title="Pick a folder"><FolderOpen size={14} /></button>
              </div>
              <p className="text-xs text-pz-muted flex items-center gap-1.5">
                <HardDrive size={12} /> Needs about 5 GB, plus room for mods. The default is fine for most people.
              </p>
            </div>

            {checking ? null : alreadyThere ? (
              <div className="card p-4 space-y-3">
                <p className="text-sm text-pz-green flex items-center gap-2"><CheckCircle size={16} /> Found a server that's already installed here.</p>
                <div className="flex gap-2">
                  <button onClick={finish} className="btn-primary flex-1 justify-center">Use it <ArrowRight size={14} /></button>
                </div>
                <InstallRunner
                  steamcmdDir={settings?.steamcmdDir || 'C:\\PZServerManager\\steamcmd'}
                  serverDir={serverDir}
                  buildVersion="b42"
                  mode="update"
                />
              </div>
            ) : (
              <div className="card p-4">
                <InstallRunner
                  steamcmdDir={settings?.steamcmdDir || 'C:\\PZServerManager\\steamcmd'}
                  serverDir={serverDir}
                  buildVersion="b42"
                  mode="install"
                  onDone={() => setAlreadyThere(true)}
                />
              </div>
            )}

            <button onClick={() => setStep('welcome')} className="text-xs text-pz-muted hover:text-pz-text">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

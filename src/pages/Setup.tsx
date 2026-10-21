import { useEffect, useState } from 'react'
import { Server, FolderOpen, ArrowRight, CheckCircle, HardDrive, Shield, Globe, Loader, Gamepad2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import InstallRunner from '../components/InstallRunner'
import PlayitSetup from '../components/PlayitSetup'

type Step = 'welcome' | 'install' | 'finish'

// First launch: explain, get the server files (or find them in Steam), then two
// optional "make it reachable" bits. Everything here can be redone in App settings.
export default function Setup() {
  const { settings, setSettings, setActiveView } = useAppStore()
  const [step, setStep] = useState<Step>('welcome')
  const [serverDir, setServerDir] = useState(settings?.serverInstallPath || 'C:\\PZServer')
  const [alreadyThere, setAlreadyThere] = useState(false)
  const [steamDir, setSteamDir] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [firewallDone, setFirewallDone] = useState(false)
  const [fwBusy, setFwBusy] = useState(false)
  const [fwMsg, setFwMsg] = useState('')
  const [showPlayit, setShowPlayit] = useState(false)

  useEffect(() => { window.electronAPI.steamcmd.findSteamInstall().then(setSteamDir).catch(() => undefined) }, [])

  const pickFolder = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (!folder) return
    // pointed at an existing install (or a folder containing one)? use that
    const found = await window.electronAPI.fs.findServerBat(folder)
    setServerDir(found.success && found.path ? found.path : folder)
    setAlreadyThere(!!found.success)
  }

  const checkExisting = async () => {
    setChecking(true)
    setAlreadyThere(await window.electronAPI.steamcmd.checkInstalled(serverDir))
    setChecking(false)
  }

  const useServer = async (dir: string, steamManaged: boolean) => {
    setSettings(await window.electronAPI.settings.set({ serverInstallPath: dir, steamManaged }))
    setServerDir(dir)
    window.electronAPI.network.firewallStatus().then(r => setFirewallDone(r.exists)).catch(() => undefined)
    setStep('finish')
  }

  const allowFirewall = async () => {
    setFwBusy(true)
    setFwMsg('')
    const r = await window.electronAPI.network.addFirewallRule(serverDir)
    setFwBusy(false)
    setFirewallDone(r.success)
    if (!r.success) setFwMsg(r.message || "That didn't work, you can try again later in App settings.")
  }

  const finish = async () => {
    setSettings(await window.electronAPI.settings.set({ setupComplete: true }))
    setActiveView('home')
  }

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        {step === 'welcome' && (
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
              <p>1. Get the game server (free, about 7 GB, only once)</p>
              <p>2. Create a server and pick a difficulty</p>
              <p>3. Add mods from the Workshop if you want</p>
              <p>4. Hit Start and send your friends the invite</p>
            </div>
            <button onClick={() => { setStep('install'); checkExisting() }} className="btn-primary px-8 py-3 mx-auto">
              Get started <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === 'install' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">Get the game server</h1>
              <p className="text-sm text-pz-subtext mt-1">
                This is the program that actually runs your world. It's separate from the game you play.
              </p>
            </div>

            {steamDir && (
              <div className="card p-4 border-pz-green/40 space-y-3">
                <p className="text-sm text-pz-green flex items-center gap-2"><Gamepad2 size={16} /> You already have it in your Steam library!</p>
                <p className="text-xs text-pz-muted font-mono break-all">{steamDir}</p>
                <button onClick={() => useServer(steamDir, true)} className="btn-primary w-full justify-center">Use that one (no download) <ArrowRight size={14} /></button>
                <p className="text-xs text-pz-muted">Steam keeps it updated for you.</p>
              </div>
            )}

            <div className="card p-4 space-y-2">
              {steamDir && <p className="text-xs text-pz-subtext mb-1">Or download a separate copy:</p>}
              <label className="label">Where to put it</label>
              <div className="flex gap-2">
                <input value={serverDir} onChange={e => { setServerDir(e.target.value); setAlreadyThere(false) }} onBlur={checkExisting} className="input" />
                <button onClick={pickFolder} className="btn-outline flex-shrink-0" title="Pick a folder"><FolderOpen size={14} /></button>
              </div>
              <p className="text-xs text-pz-muted flex items-center gap-1.5">
                <HardDrive size={12} /> Needs about 7 GB, plus room for mods. The default is fine for most people.
              </p>
            </div>

            {checking ? null : alreadyThere ? (
              <div className="card p-4 space-y-3">
                <p className="text-sm text-pz-green flex items-center gap-2"><CheckCircle size={16} /> Found a server that's already installed here.</p>
                <button onClick={() => useServer(serverDir, false)} className="btn-primary w-full justify-center">Use it <ArrowRight size={14} /></button>
              </div>
            ) : (
              <div className="card p-4">
                <InstallRunner
                  steamcmdDir={settings?.steamcmdDir || 'C:\\PZServerManager\\steamcmd'}
                  serverDir={serverDir}
                  buildVersion="b42"
                  mode="install"
                  onDone={() => useServer(serverDir, false)}
                />
              </div>
            )}

            <button onClick={() => setStep('welcome')} className="text-xs text-pz-muted hover:text-pz-text">Back</button>
          </div>
        )}

        {step === 'finish' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">Almost done!</h1>
              <p className="text-sm text-pz-subtext mt-1">Two quick things so your friends can actually get in. You can skip both and do them later in App settings.</p>
            </div>

            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-pz-text flex items-center gap-2"><Shield size={14} /> Allow it through Windows Firewall</h3>
              {firewallDone ? (
                <p className="text-sm text-pz-green flex items-center gap-2"><CheckCircle size={14} /> Done</p>
              ) : (
                <>
                  <p className="text-xs text-pz-subtext">Windows blocks new programs from the internet until you say it's OK. Click this and choose <b>Yes</b> when Windows asks.</p>
                  <button onClick={allowFirewall} disabled={fwBusy} className="btn-primary">
                    {fwBusy ? <Loader size={14} className="animate-spin" /> : <Shield size={14} />} Allow the server
                  </button>
                  {fwMsg && <p className="text-xs text-pz-yellow">{fwMsg}</p>}
                </>
              )}
            </div>

            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-pz-text flex items-center gap-2"><Globe size={14} /> Friends outside your house?</h3>
              {showPlayit ? (
                <PlayitSetup />
              ) : (
                <>
                  <p className="text-xs text-pz-subtext">
                    Normally that means changing settings on your router. playit.gg (free) skips all of that and gives you an address that just works.
                  </p>
                  <button onClick={() => setShowPlayit(true)} className="btn-outline">Set up playit.gg</button>
                </>
              )}
            </div>

            <button onClick={finish} className="btn-primary w-full justify-center py-3">Let's make a server <ArrowRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  )
}

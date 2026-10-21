import { useEffect, useState } from 'react'
import { Download, Link2, ExternalLink, CheckCircle, Loader, AlertTriangle, RefreshCw, Globe } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { PLAYIT_INTEGRATION } from '../lib/features'

export default function PlayitSetup({ compact = false }: { compact?: boolean }) {
  return PLAYIT_INTEGRATION ? <PlayitIntegrated compact={compact} /> : <PlayitGuide compact={compact} />
}

// While we wait on playit's third-party app approval: a guide and links the user clicks
// themselves. The app doesn't install, start or talk to playit, it just shows the address
// they paste in on the server's Overview page.
function PlayitGuide({ compact }: { compact: boolean }) {
  const { settings, setSettings } = useAppStore()
  const enabled = !!settings?.playitEnabled
  const setEnabled = async (v: boolean) => setSettings(await window.electronAPI.settings.set({ playitEnabled: v }))
  const open = (url: string) => window.electronAPI.shell.openExternal(url)

  return (
    <div className="space-y-4">
      {!compact && (
        <p className="text-sm text-pz-subtext">
          playit.gg is a free service that gives your server an address friends can join from anywhere, without touching
          your router. It's a separate app with your own free account. Here's how to set it up:
        </p>
      )}
      <ol className="space-y-2 text-sm text-pz-subtext list-decimal pl-5">
        <li>
          Download and install playit from their site.{' '}
          <button onClick={() => open('https://playit.gg/download')} className="text-pz-green underline inline-flex items-center gap-1">
            Open playit.gg/download <ExternalLink size={11} />
          </button>
        </li>
        <li>Open playit. It shows a link, open it and sign up or log in (free).</li>
        <li>
          On playit's site, <b className="text-pz-text">Add Tunnel</b>, pick <b className="text-pz-text">UDP</b>, and set the local port to
          {' '}<b className="text-pz-text">16261</b> (your server's port). Make a second one for <b className="text-pz-text">16262</b>.{' '}
          <button onClick={() => window.electronAPI.playit.openDashboard()} className="text-pz-green underline inline-flex items-center gap-1">
            Open my tunnels <ExternalLink size={11} />
          </button>
        </li>
        <li>Copy the address playit gives the 16261 tunnel (looks like <code>name.gl.joinmc.link:12345</code>) and paste it on your server's Overview page.</li>
        <li>Keep playit running while you play.</li>
      </ol>

      <label className="flex items-center gap-3 cursor-pointer pt-1">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-pz-green w-4 h-4" />
        <span className="text-sm text-pz-text">I use playit (show my playit address in the invite instead of my home IP)</span>
      </label>

      <p className="text-[11px] text-pz-muted">
        playit.gg is a separate service by Developed Methods LLC and isn't affiliated with this app. It has its own{' '}
        <button onClick={() => open('https://playit.gg/terms')} className="underline">terms</button>.
      </p>
    </div>
  )
}

// Step-by-step "Works with playit.gg" setup. Everything account-related happens in
// playit's own app and website; this just walks people through it and checks progress.
function PlayitIntegrated({ compact = false }: { compact?: boolean }) {
  const { settings, setSettings } = useAppStore()
  const [state, setState] = useState<PlayitState | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = async () => setState(await window.electronAPI.playit.state())

  // keep checking while they're doing things in playit's window / website
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [])

  const enabled = !!settings?.playitEnabled
  const setEnabled = async (v: boolean) => setSettings(await window.electronAPI.settings.set({ playitEnabled: v }))

  const install = async () => {
    setBusy('install')
    setMsg('')
    const r = await window.electronAPI.playit.install()
    setBusy('')
    if (!r.success && r.message) setMsg(r.message)
    refresh()
  }

  const start = async () => {
    setBusy('start')
    const r = await window.electronAPI.playit.start()
    setBusy('')
    if (!r.success) setMsg("playit didn't start. Try opening the playit app from the Start menu once.")
    refresh()
  }

  const phase = state?.phase
  const step = !state ? 0 : phase === 'not_installed' ? 1 : phase === 'not_running' ? 2 : phase === 'needs_setup' ? 3 : 4

  return (
    <div className="space-y-4">
      {!compact && (
        <p className="text-sm text-pz-subtext">
          playit.gg is a free service that gives your server an address friends can join from anywhere, without touching
          your router or firewall. You use your own free playit account, the app just helps you set it up and shows your address.
        </p>
      )}

      {!state ? (
        <p className="text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Checking for playit...</p>
      ) : (
        <ol className="space-y-3">
          <Step n={1} done={step > 1} active={step === 1} title="Install playit">
            <button onClick={install} disabled={!!busy} className="btn-primary text-sm">
              {busy === 'install' ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
              {busy === 'install' ? 'Installing (Windows may ask for permission)...' : 'Install playit'}
            </button>
            <p className="text-xs text-pz-muted mt-1">Installs the official app from playit.gg using Windows' own installer.</p>
          </Step>

          <Step n={2} done={step > 2} active={step === 2} title="Start playit">
            <button onClick={start} disabled={!!busy} className="btn-primary text-sm">
              {busy === 'start' ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />} Start playit
            </button>
          </Step>

          <Step n={3} done={step > 3} active={step === 3} title="Link your playit account">
            <button onClick={() => window.electronAPI.playit.setup()} className="btn-primary text-sm"><Link2 size={14} /> Link my account</button>
            <p className="text-xs text-pz-muted mt-1">
              A playit window opens with a link. Open it, sign up or log in (it's free), and accept. This page notices when you're done.
            </p>
          </Step>

          <Step n={4} done={step >= 4 && (state.tunnels.length > 0)} active={step === 4} title="Make a tunnel for your server">
            {state.tunnels.length === 0 ? (
              <>
                <p className="text-xs text-pz-subtext mb-2">
                  On playit's site, click <b>Add Tunnel</b>, pick <b>UDP</b>, and set the <b>local port</b> to your server's port
                  (<b>16261</b> unless you changed it). Make a second one for the next port up (<b>16262</b>) too.
                </p>
                <button onClick={() => window.electronAPI.playit.openDashboard()} className="btn-outline text-sm"><ExternalLink size={14} /> Open my playit tunnels</button>
              </>
            ) : (
              <div className="space-y-1">
                {state.tunnels.map(t => (
                  <div key={t.address + t.destination} className="text-xs flex items-center gap-2">
                    <Globe size={12} className={t.disabled ? 'text-pz-red' : 'text-pz-green'} />
                    <span className="font-mono text-pz-text select-text">{t.address}</span>
                    <span className="text-pz-muted">→ {t.destination}</span>
                    {t.disabled && <span className="text-pz-red">{t.disabledReason || 'disabled'}</span>}
                  </div>
                ))}
                <button onClick={() => window.electronAPI.playit.openDashboard()} className="text-xs text-pz-green hover:underline">Manage tunnels on playit.gg</button>
              </div>
            )}
          </Step>
        </ol>
      )}

      {state?.phase === 'error' && (
        <p className="text-xs text-pz-red flex items-center gap-1.5"><AlertTriangle size={12} /> playit says: {state.error}</p>
      )}
      {state?.phase === 'unknown' && (
        <p className="text-xs text-pz-yellow flex items-center gap-1.5">
          <AlertTriangle size={12} /> This version of playit talks differently than the app expects. It still works, you'll just need to paste your address on the server's Overview page.
        </p>
      )}
      {state?.notices.map((n, i) => <p key={i} className="text-xs text-pz-yellow">{n}</p>)}
      {msg && <p className="text-xs text-pz-yellow">{msg}</p>}

      <label className="flex items-center gap-3 cursor-pointer pt-1">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-pz-green w-4 h-4" />
        <span className="text-sm text-pz-text">Use playit for my servers (shows the playit address to friends and starts playit with the server)</span>
      </label>

      <p className="text-[11px] text-pz-muted">
        Works with playit.gg. playit is a separate service by Developed Methods LLC, with its own{' '}
        <button onClick={() => window.electronAPI.shell.openExternal('https://playit.gg/terms')} className="underline">terms</button>.
      </p>
    </div>
  )
}

function Step({ n, done, active, title, children }: { n: number; done: boolean; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`flex gap-3 ${!done && !active ? 'opacity-50' : ''}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
        done ? 'bg-pz-green text-pz-darker' : active ? 'border-2 border-pz-green text-pz-green' : 'border border-pz-border text-pz-muted'
      }`}>
        {done ? <CheckCircle size={14} /> : n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-pz-text mb-1">{title}</div>
        {active && children}
        {done && n === 4 && children}
      </div>
    </li>
  )
}

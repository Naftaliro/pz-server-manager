import { useEffect, useState } from 'react'
import { FolderOpen, HardDrive, Wrench, RefreshCw, Info, ExternalLink, CheckCircle, AlertCircle, Globe, Shield, Loader, KeyRound } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { BuildVersion } from '../store/useAppStore'
import InstallRunner from '../components/InstallRunner'
import PlayitSetup from '../components/PlayitSetup'
import { triggerManualUpdateCheck } from '../components/UpdateBanner'
import CopyDiagnosticsButton from '../components/CopyDiagnosticsButton'

export default function AppSettings() {
  const { settings, setSettings, profiles } = useAppStore()
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [version, setVersion] = useState('')
  const [mode, setMode] = useState<'install' | 'update'>('update')
  const [firewall, setFirewall] = useState<Awaited<ReturnType<typeof window.electronAPI.network.firewallStatus>> | null>(null)
  const [fwBusy, setFwBusy] = useState(false)
  const [fwMsg, setFwMsg] = useState('')
  const [serverUpdate, setServerUpdate] = useState<{ checked: boolean; updateAvailable: boolean } | null>(null)
  const [apiKey, setApiKey] = useState(settings?.steamApiKey || '')
  useEffect(() => { setApiKey(settings?.steamApiKey || '') }, [settings?.steamApiKey])

  const serverDir = settings?.serverInstallPath || 'C:\\PZServer'
  const advanced = !!settings?.advancedMode

  const refreshInstalled = () => window.electronAPI.steamcmd.checkInstalled(serverDir).then(ok => {
    setInstalled(ok)
    setMode(ok ? 'update' : 'install')
  })

  useEffect(() => { refreshInstalled() }, [serverDir])
  const refreshFirewall = () => window.electronAPI.network.firewallStatus().then(setFirewall).catch(() => setFirewall(null))
  useEffect(() => { void refreshFirewall() }, [])
  useEffect(() => { window.electronAPI.steamcmd.checkUpdate(serverDir).then(setServerUpdate).catch(() => undefined) }, [serverDir, installed])

  const allowFirewall = async () => {
    setFwBusy(true)
    setFwMsg('')
    const r = await window.electronAPI.network.addFirewallRule(serverDir)
    setFwBusy(false)
    await refreshFirewall()
    if (!r.success && r.message) setFwMsg(r.message)
  }

  const removeFirewall = async () => {
    setFwBusy(true)
    setFwMsg('')
    const r = await window.electronAPI.network.removeFirewallRule()
    setFwBusy(false)
    await refreshFirewall()
    if (!r.success && r.message) setFwMsg(r.message)
  }
  useEffect(() => { window.electronAPI.updater.getVersion().then(v => setVersion(v.version)).catch(() => undefined) }, [])

  const update = async (patch: Partial<NonNullable<typeof settings>>) => setSettings(await window.electronAPI.settings.set(patch))

  const pickServerDir = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (!folder) return
    const found = await window.electronAPI.fs.findServerBat(folder)
    const dir = found.success && found.path ? found.path : folder
    await update({ serverInstallPath: dir })
    // keep existing servers pointed at the same install
    for (const p of profiles) {
      if (p.serverInstallPath === dir) continue
      // latest copy from disk, so this doesn't undo changes made since the list was loaded
      const latest = (await window.electronAPI.profiles.get(p.id)) || p
      await window.electronAPI.profiles.save({ ...latest, serverInstallPath: dir })
    }
    useAppStore.getState().setProfiles(await window.electronAPI.profiles.list())
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-pz-text">App settings</h1>

        <div className="card p-5 space-y-4">
          <h3 className="section-title flex items-center gap-2"><HardDrive size={14} /> Game server files</h3>
          <div>
            <label className="label">Installed at</label>
            <div className="flex gap-2">
              <input value={serverDir} readOnly className="input" />
              <button onClick={pickServerDir} className="btn-outline flex-shrink-0" title="Change"><FolderOpen size={14} /></button>
            </div>
            <p className={`text-xs mt-1 flex items-center gap-1 ${installed ? 'text-pz-green' : 'text-pz-yellow'}`}>
              {installed === null ? '' : installed
                ? <><CheckCircle size={12} /> Server is installed</>
                : <><AlertCircle size={12} /> No server here yet</>}
            </p>
          </div>
          {serverUpdate?.checked && (
            <p className={`text-xs flex items-center gap-1 ${serverUpdate.updateAvailable ? 'text-pz-yellow' : 'text-pz-green'}`}>
              {serverUpdate.updateAvailable ? <><AlertCircle size={12} /> A newer version is out, update it so friends on the new game version can join.</> : <><CheckCircle size={12} /> Up to date with the latest game version</>}
            </p>
          )}
          {settings?.steamManaged ? (
            <p className="text-xs text-pz-subtext">This server came from your Steam library, so Steam keeps it updated. Open Steam to update "Project Zomboid Dedicated Server".</p>
          ) : (<>
          <p className="text-xs text-pz-subtext">
            When the game gets an update on Steam, update the server too, otherwise nobody can join. Stop your servers first.
          </p>
          <InstallRunner
            key={`${serverDir}-${settings?.buildVersion}-${mode}`}
            steamcmdDir={settings?.steamcmdDir || 'C:\\PZServerManager\\steamcmd'}
            serverDir={serverDir}
            buildVersion={settings?.buildVersion || 'b42'}
            mode={mode}
            onDone={refreshInstalled}
          />
          </>)}
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="section-title flex items-center gap-2"><Globe size={14} /> Let friends join from anywhere</h3>
          <PlayitSetup />
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="section-title flex items-center gap-2"><Shield size={14} /> Windows Firewall</h3>
          {firewall?.upToDate ? (
            <>
              <p className="text-sm text-pz-green flex items-center gap-2">
                <CheckCircle size={14} /> The server is allowed through Windows Firewall
                {firewall.ports.length > 0 && !firewall.unknown && <span className="text-pz-subtext">(UDP {firewall.ports.join(', ')})</span>}
              </p>
              {firewall.anyRule && (
                <button onClick={removeFirewall} disabled={fwBusy} className="btn-ghost text-xs">
                  {fwBusy ? <Loader size={12} className="animate-spin" /> : null} Remove the rule (Windows will ask)
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-pz-subtext">
                {firewall?.oldRule
                  ? 'The rule from an older version opens every port of the server, including the admin console (RCON), to your network. Replace it with one that only opens the game ports.'
                  : firewall?.anyRule
                    ? "The rule doesn't cover all your servers' ports yet (they changed, or there's a new server). Update it so friends don't get blocked."
                    : "Windows blocks new programs from the network until you allow them. Do it once here and friends won't get blocked."}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={allowFirewall} disabled={fwBusy || !installed} className="btn-primary">
                  {fwBusy ? <Loader size={14} className="animate-spin" /> : <Shield size={14} />}
                  {firewall?.oldRule ? ' Replace the rule (Windows will ask)' : firewall?.anyRule ? ' Update the rule (Windows will ask)' : ' Allow the server (Windows will ask)'}
                </button>
                {firewall?.anyRule && (
                  <button onClick={removeFirewall} disabled={fwBusy} className="btn-ghost text-xs">Remove the rule</button>
                )}
              </div>
            </>
          )}
          {fwMsg && <p className="text-xs text-pz-yellow">{fwMsg}</p>}
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="section-title flex items-center gap-2"><KeyRound size={14} /> Steam Web API key (optional)</h3>
          <p className="text-sm text-pz-subtext">
            With your own key, installing a modpack also finds the mods each mod needs, even ones the pack forgot.
            Without one, the Mods tab still points out anything missing once the files are downloaded.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onBlur={() => { if (apiKey.trim() !== (settings?.steamApiKey || '')) update({ steamApiKey: apiKey.trim() }) }}
              className="input font-mono"
              placeholder="Paste your key here"
            />
            <button
              onClick={() => window.electronAPI.shell.openExternal('https://steamcommunity.com/dev/apikey')}
              className="btn-outline flex-shrink-0 text-xs"
            >
              <ExternalLink size={12} /> Get a free key
            </button>
          </div>
          <p className="text-xs text-pz-muted">
            On Steam's page, any domain name works (for example "localhost"). The key stays on this PC and is only sent to Steam.
          </p>
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="section-title flex items-center gap-2"><Wrench size={14} /> Advanced mode</h3>
          <button onClick={() => update({ advancedMode: !advanced })} className="w-full flex items-center gap-3 text-left">
            <div className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${advanced ? 'bg-pz-green' : 'bg-pz-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-pz-text transition-transform ${advanced ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <div>
              <div className="text-sm text-pz-text">Show advanced options</div>
              <div className="text-xs text-pz-muted">Mod IDs, ports, raw config files, launch modes and Build 41. Most people never need these.</div>
            </div>
          </button>

          {advanced && (
            <div className="pt-2 space-y-3 border-t border-pz-border">
              <div>
                <label className="label">Server build</label>
                <div className="flex gap-2">
                  {(['b42', 'b41'] as BuildVersion[]).map(v => (
                    <button key={v} onClick={() => update({ buildVersion: v })} className={`flex-1 py-2 rounded-md border text-sm font-semibold transition-colors ${
                      settings?.buildVersion === v ? 'bg-pz-green/20 border-pz-green text-pz-green' : 'border-pz-border text-pz-muted hover:border-pz-text'
                    }`}>
                      {v === 'b42' ? 'Build 42 (stable)' : 'Build 41 (legacy41 branch)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-pz-muted mt-1">
                  Changes which branch Install/Update downloads and the default for new servers. Switching an existing install needs an update run.
                </p>
              </div>
              <div>
                <label className="label">SteamCMD folder</label>
                <div className="flex gap-2">
                  <input value={settings?.steamcmdDir || ''} onChange={e => update({ steamcmdDir: e.target.value })} className="input" />
                  <button
                    onClick={async () => { const f = await window.electronAPI.dialog.openFolder(); if (f) update({ steamcmdDir: f }) }}
                    className="btn-outline flex-shrink-0"
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>
              <button onClick={() => window.electronAPI.shell.openPath('%APPDATA%\\pz-server-manager')} className="btn-outline text-xs">
                <FolderOpen size={12} /> Open app data folder
              </button>
            </div>
          )}
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="section-title flex items-center gap-2"><Info size={14} /> About</h3>
          <p className="text-sm text-pz-subtext">Knox Launcher {version && `v${version}`}</p>
          <p className="text-xs text-pz-muted">Something not working? Copy the diagnostics and paste them into your report. Passwords, IPs and Steam IDs are left out.</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => triggerManualUpdateCheck?.()} className="btn-outline text-xs"><RefreshCw size={12} /> Check for app updates</button>
            <button onClick={() => window.electronAPI.shell.openExternal('https://pzwiki.net/wiki/Dedicated_server')} className="btn-outline text-xs"><ExternalLink size={12} /> PZ server wiki</button>
            <CopyDiagnosticsButton />
            <button onClick={() => window.electronAPI.shell.openExternal('https://github.com/Naftaliro/pz-server-manager/issues/new')} className="btn-outline text-xs"><ExternalLink size={12} /> Report a problem</button>
          </div>
        </div>
      </div>
    </div>
  )
}

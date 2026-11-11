import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Lock, Users, Skull, Package, Play, Loader, FileUp } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { PRESETS, loadPresets } from '../lib/presets'
import type { PresetKey } from '../lib/presets'
import { deepMerge, type SettingsTree } from '../../shared/gameConfig'
import { MODDED_PRESETS, presetProfileMods } from '../lib/modPresets'
import { saveProfile, RECOMMENDED_MEMORY_MB } from '../lib/profile'
import { downloadAndScan } from '../lib/mods'
import { suggestPassword, publicIni, type ServerPack } from '../../shared/serverPack'
import ConfirmDialog from '../components/ConfirmDialog'
import { steamImageUrl } from '../../shared/workshopItem'
import { ModdedPresetList, ReadyToBuild } from '../components/ModdedPresets'

type Step = 0 | 1 | 2

// Three questions and you have a server. Everything else gets sensible defaults
// and can be changed later in Settings.
export default function CreateServer() {
  const { settings, profiles, openServer, setActiveView } = useAppStore()
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [preset, setPreset] = useState<PresetKey>('Apocalypse')
  // the game's own preset files, from the server install
  const [presets, setPresets] = useState<Partial<Record<PresetKey, SettingsTree>>>({})
  useEffect(() => { loadPresets(settings?.serverInstallPath).then(setPresets) }, [settings?.serverInstallPath])
  // a ready-made modded server brings its mods and settings; its sandbox goes on top of the difficulty
  const [moddedKey, setModdedKey] = useState<string | null>(null)
  const modded = MODDED_PRESETS.find(p => p.key === moddedKey)
  // the server install's build, to compare with the build the presets were checked on
  const [serverBuild, setServerBuild] = useState<string | null>(null)
  useEffect(() => {
    if (!settings?.serverInstallPath) return
    window.electronAPI.mods.serverBuild(settings.serverInstallPath).then(r => setServerBuild(r.buildId || null)).catch(() => undefined)
  }, [settings?.serverInstallPath])
  const [pvp, setPvp] = useState(false)
  const [creating, setCreating] = useState(false)
  const [memory, setMemory] = useState(RECOMMENDED_MEMORY_MB)

  // don't ask for more memory than the PC can spare
  useEffect(() => {
    window.electronAPI.system.info().then(({ totalMemMb }) => {
      const spare = totalMemMb - 4096
      setMemory(Math.max(4096, Math.min(RECOMMENDED_MEMORY_MB, Math.floor(spare / 1024) * 1024)))
    }).catch(() => undefined)
  }, [])

  const nameTaken = profiles.some(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())
  const nameOk = name.trim().length > 0 && name.length <= 50 && !nameTaken

  // each server needs its own ports, so step past ones in use by other profiles
  const nextPort = () => {
    let port = 16261
    while (profiles.some(p => p.port === port || p.udpPort === port || p.port === port + 1)) port += 2
    return port
  }

  const nextRconPort = () => {
    const used = new Set(profiles.map(p => Number(p.iniSettings?.RCONPort || 27015)))
    let port = 27015
    while (used.has(port)) port++
    return port
  }

  // Host a copy of someone's server from their server pack: same mods, fix mods and settings
  const [packError, setPackError] = useState('')
  // settings the app left out of a pack (not safe to write into the server files), asked about first
  const [leftOut, setLeftOut] = useState<{ pack: ServerPack; path: string; dropped: string[] } | null>(null)
  const copyPack = async () => {
    setPackError('')
    const r = await window.electronAPI.client.openPackForHost()
    if (!r.success) { setPackError(r.message || "Couldn't open that pack."); return }
    if (r.cancelled || !r.pack?.host || !r.path) return
    if (r.droppedSettings?.length) { setLeftOut({ pack: r.pack, path: r.path, dropped: r.droppedSettings }); return }
    await hostCopy(r.pack, r.path)
  }

  const hostCopy = async (pack: ServerPack, path: string) => {
    const host = pack.host!
    setCreating(true)
    try {
      let copyName = pack.server.name.slice(0, 44)
      for (let n = 2; profiles.some(p => p.name.toLowerCase() === copyName.toLowerCase()); n++) copyName = `${pack.server.name.slice(0, 44)} ${n}`
      const port = nextPort()
      const saved = await saveProfile({
        id: '',
        name: copyName,
        description: `Copied from a server pack made ${new Date(pack.createdAt).toLocaleDateString()}`,
        buildVersion: pack.server.build,
        serverInstallPath: settings?.serverInstallPath || 'C:\\PZServer',
        worldSavePath: '',
        port,
        udpPort: port + 1,
        // their PC might have more memory to spare than this one
        memory: Math.min(host.memory || memory, memory),
        adminPassword: suggestPassword(),
        // the pack's password is for joining their server, the copy gets one of its own
        serverPassword: pack.server.password ? suggestPassword() : '',
        maxPlayers: host.maxPlayers,
        mods: host.mods.map(m => ({ workshopId: m.workshopId, modId: m.modId, name: m.name, thumbnailUrl: steamImageUrl(m.thumbnailUrl) })),
        mapOrder: host.mapOrder,
        launchMode: 'managed',
        iniSettings: {
          // nothing private from their server (passwords, ports, ids): the copy makes its own
          ...publicIni(host.ini),
          ...(host.baseMap ? { Map: host.baseMap } : {}),
          PublicName: copyName,
          RCONPort: nextRconPort(),
        },
        sandboxSettings: host.sandbox,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      if (pack.localMods.length > 0) {
        const fixes = await window.electronAPI.client.installPackFixes(path)
        if (!fixes.success) setPackError(`The server was made, but its fix mods couldn't be installed: ${fixes.message}`)
      }
      const workshopIds = host.mods.map(m => m.workshopId).filter(Boolean)
      if (workshopIds.length > 0) void downloadAndScan(saved.id, workshopIds)
      openServer(saved.id, 'mods')
    } catch (e) {
      setPackError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const [createError, setCreateError] = useState('')
  const create = async (thenMods: boolean) => {
    setCreating(true)
    setCreateError('')
    try {
      const port = nextPort()
      // the difficulty picked on the step before, from the game's own files (none found: the
      // game uses its defaults, which is Apocalypse), with the preset's few changes on top
      const difficulty = (presets[preset] || {}) as SettingsTree
      const sandbox = modded ? deepMerge(difficulty, modded.sandboxSettings as SettingsTree) : difficulty
      const saved = await saveProfile({
        id: '',
        name: name.trim(),
        description: modded ? `${modded.label}: ${modded.tagline}` : '',
        buildVersion: modded?.buildVersion || settings?.buildVersion || 'b42',
        serverInstallPath: settings?.serverInstallPath || 'C:\\PZServer',
        worldSavePath: '',
        port,
        udpPort: port + 1,
        memory,
        adminPassword: suggestPassword(),
        serverPassword: password,
        maxPlayers,
        mods: modded ? presetProfileMods(modded) : [],
        launchMode: 'managed',
        iniSettings: {
          ...(modded?.iniSettings || {}),
          // what was asked on the first page wins over the preset
          PVP: pvp,
          PublicName: name.trim(),
          Open: true,
          // each server gets its own RCON port so two can run side by side
          RCONPort: nextRconPort(),
        },
        sandboxSettings: sandbox,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      if (modded) {
        // keep a copy of every mod as it downloads (App settings → Mod backups), so a known-good
        // version is there if a mod gets pulled or an update breaks it. Turned on before the
        // downloads start, the copies are made right after each one
        const backups = await window.electronAPI.modBackups.status().catch(() => null)
        if (backups?.success && !backups.enabled) {
          await window.electronAPI.modBackups.configure({ enabled: true })
          if (settings) useAppStore.getState().setSettings({ ...settings, modBackups: true })
        }
        // if this fails, the pre-start check names the missing fix mod when Start is pressed
        if (modded.localMods.length > 0) await window.electronAPI.mods.installLocal(modded.localMods, saved.worldSavePath)
        void downloadAndScan(saved.id, modded.mods.map(m => m.workshopId).filter(Boolean))
      }
      openServer(saved.id, thenMods || modded ? 'mods' : 'overview')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const steps = ['Name', 'Difficulty', 'Mods']

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-xl mx-auto">
        {/* progress */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                i < step ? 'bg-pz-green text-pz-darker' : i === step ? 'border-2 border-pz-green text-pz-green' : 'border border-pz-border text-pz-muted'
              }`}>
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              <span className={`text-sm ${i === step ? 'text-pz-text' : 'text-pz-muted'}`}>{label}</span>
              {i < steps.length - 1 && <div className="flex-1 h-px bg-pz-border" />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">What should your server be called?</h1>
              <p className="text-sm text-pz-subtext mt-1">Only you and your friends see this.</p>
            </div>
            <div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && nameOk) setStep(1) }}
                className="input text-base py-3"
                placeholder="e.g. Friday Night Apocalypse"
                autoFocus
                maxLength={50}
              />
              {nameTaken && <p className="text-xs text-pz-red mt-1">You already have a server with that name.</p>}
            </div>

            <div className="card p-4 space-y-4">
              <div>
                <label className="label flex items-center gap-1.5"><Lock size={12} /> Password (optional)</label>
                <input value={password} onChange={e => setPassword(e.target.value)} className="input" placeholder="Leave empty and anyone with the address can join" />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Users size={12} /> Max players: <span className="text-pz-text normal-case">{maxPlayers}</span></label>
                <input type="range" min={2} max={32} value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))} className="w-full" />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={pvp} onChange={e => setPvp(e.target.checked)} className="accent-pz-green w-4 h-4" />
                <span className="text-sm text-pz-text">Allow players to hurt each other (PvP)</span>
              </label>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setActiveView('home')} className="btn-ghost"><ArrowLeft size={14} /> Cancel</button>
              <button onClick={() => setStep(1)} disabled={!nameOk} className="btn-primary disabled:opacity-40">Next <ArrowRight size={14} /></button>
            </div>

            <div className="border-t border-pz-border pt-5">
              <button onClick={copyPack} disabled={creating} className="card p-4 text-left w-full hover:border-pz-green transition-all flex items-center gap-4">
                <FileUp size={22} className="text-pz-green flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-pz-text">Copy a server pack instead</div>
                  <div className="text-xs text-pz-subtext">Got a .pzpack from someone? Host the same server: their mods, fix mods and settings, with a fresh world.</div>
                </div>
                {creating ? <Loader size={16} className="animate-spin text-pz-muted" /> : <ArrowRight size={16} className="text-pz-muted" />}
              </button>
              {packError && <p className="text-xs text-pz-red mt-2">{packError}</p>}
              <ConfirmDialog
                isOpen={!!leftOut}
                title="Some settings were left out"
                message={leftOut ? `${leftOut.dropped.length} setting${leftOut.dropped.length === 1 ? '' : 's'} in this pack ${leftOut.dropped.length === 1 ? "isn't" : "aren't"} a normal server setting, so ${leftOut.dropped.length === 1 ? "it won't" : "they won't"} be copied: ${leftOut.dropped.slice(0, 5).join(', ')}${leftOut.dropped.length > 5 ? ', ...' : ''}. Only use packs from people you trust.` : ''}
                confirmLabel="Host it without those"
                onConfirm={() => { const l = leftOut; setLeftOut(null); if (l) void hostCopy(l.pack, l.path) }}
                onCancel={() => setLeftOut(null)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">How hard should it be?</h1>
              <p className="text-sm text-pz-subtext mt-1">You can fine-tune everything later.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.keys(presets).length === 0 && (
                <p className="text-sm text-pz-subtext sm:col-span-2">The game's presets aren't in the server files, so the server starts with the normal game settings. You can change them later.</p>
              )}
              {(Object.keys(PRESETS) as PresetKey[]).filter(k => presets[k]).map(key => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  className={`card p-4 text-left transition-all ${preset === key ? 'border-pz-green bg-pz-green/10' : 'hover:border-pz-text/40'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Skull size={14} className={preset === key ? 'text-pz-green' : 'text-pz-muted'} />
                    <span className="font-semibold text-pz-text">{PRESETS[key].label}</span>
                    {key === 'Apocalypse' && <span className="text-[10px] uppercase tracking-wide text-pz-green ml-auto">Default</span>}
                  </div>
                  <p className="text-xs text-pz-subtext">{PRESETS[key].blurb}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(0)} className="btn-ghost"><ArrowLeft size={14} /> Back</button>
              <button onClick={() => setStep(2)} className="btn-primary">Next <ArrowRight size={14} /></button>
            </div>
          </div>
        )}

        {step === 2 && modded && (
          <ReadyToBuild
            preset={modded}
            difficulty={presets[preset] ? PRESETS[preset].label : undefined}
            serverBuild={serverBuild}
            backupsOn={!!settings?.modBackups}
            creating={creating}
            error={createError}
            onCreate={() => create(true)}
            onBack={() => setModdedKey(null)}
          />
        )}

        {step === 2 && !modded && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">Want any mods?</h1>
              <p className="text-sm text-pz-subtext mt-1">
                Mods get downloaded automatically, and your friends' games grab them when they join. You can always add or remove them later.
              </p>
            </div>
            <ModdedPresetList presets={MODDED_PRESETS} serverBuild={serverBuild} onPick={setModdedKey} />
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => create(true)} disabled={creating} className="card p-5 text-left hover:border-pz-green transition-all flex items-center gap-4">
                <Package size={24} className="text-pz-green flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-pz-text">I'll pick my own mods</div>
                  <div className="text-xs text-pz-subtext">Opens the Steam Workshop right here in the app</div>
                </div>
                <ArrowRight size={16} className="text-pz-muted" />
              </button>
              <button onClick={() => create(false)} disabled={creating} className="card p-5 text-left hover:border-pz-green transition-all flex items-center gap-4">
                <Play size={24} className="text-pz-green flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-pz-text">No mods, just the normal game</div>
                  <div className="text-xs text-pz-subtext">Your server is ready to start right away</div>
                </div>
                <ArrowRight size={16} className="text-pz-muted" />
              </button>
            </div>
            {creating && <p className="text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Creating your server...</p>}
            {createError && <p className="text-sm text-pz-red">{createError}</p>}
            <button onClick={() => setStep(1)} className="btn-ghost"><ArrowLeft size={14} /> Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

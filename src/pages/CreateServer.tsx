import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Lock, Users, Skull, Package, Play, Loader } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { PRESETS, PRESET_BLURBS } from '../lib/presets'
import type { PresetKey } from '../lib/presets'
import { saveProfile, RECOMMENDED_MEMORY_MB } from '../lib/profile'

type Step = 0 | 1 | 2

const randomPassword = () => Math.random().toString(36).slice(2, 10)

// Three questions and you have a server. Everything else gets sensible defaults
// and can be changed later in Settings.
export default function CreateServer() {
  const { settings, profiles, openServer, setActiveView } = useAppStore()
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [preset, setPreset] = useState<PresetKey>('apocalypse')
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

  const create = async (thenMods: boolean) => {
    setCreating(true)
    try {
      const port = nextPort()
      const { ZombieConfig, ...sandbox } = PRESETS[preset].settings as Record<string, unknown> & { ZombieConfig?: Record<string, unknown> }
      const saved = await saveProfile({
        id: '',
        name: name.trim(),
        description: '',
        buildVersion: settings?.buildVersion || 'b42',
        serverInstallPath: settings?.serverInstallPath || 'C:\\PZServer',
        worldSavePath: '',
        port,
        udpPort: port + 1,
        memory,
        adminPassword: randomPassword(),
        serverPassword: password,
        maxPlayers,
        mods: [],
        launchMode: 'managed',
        iniSettings: {
          PVP: pvp,
          PublicName: name.trim(),
          Open: true,
          // each server gets its own RCON port so two can run side by side
          RCONPort: 27015 + profiles.length,
        },
        sandboxSettings: { ...sandbox, ZombieConfig: ZombieConfig || {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      openServer(saved.id, thenMods ? 'mods' : 'overview')
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
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">How hard should it be?</h1>
              <p className="text-sm text-pz-subtext mt-1">You can fine-tune everything later.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(PRESETS) as PresetKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  className={`card p-4 text-left transition-all ${preset === key ? 'border-pz-green bg-pz-green/10' : 'hover:border-pz-text/40'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Skull size={14} className={preset === key ? 'text-pz-green' : 'text-pz-muted'} />
                    <span className="font-semibold text-pz-text">{PRESETS[key].label}</span>
                    {key === 'apocalypse' && <span className="text-[10px] uppercase tracking-wide text-pz-green ml-auto">Default</span>}
                  </div>
                  <p className="text-xs text-pz-subtext">{PRESET_BLURBS[key]}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(0)} className="btn-ghost"><ArrowLeft size={14} /> Back</button>
              <button onClick={() => setStep(2)} className="btn-primary">Next <ArrowRight size={14} /></button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-pz-text">Want any mods?</h1>
              <p className="text-sm text-pz-subtext mt-1">
                Mods get downloaded automatically, and your friends' games grab them when they join. You can always add or remove them later.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => create(true)} disabled={creating} className="card p-5 text-left hover:border-pz-green transition-all flex items-center gap-4">
                <Package size={24} className="text-pz-green flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-pz-text">Yes, let me pick some</div>
                  <div className="text-xs text-pz-subtext">Opens the Steam Workshop right here in the app</div>
                </div>
                <ArrowRight size={16} className="text-pz-muted" />
              </button>
              <button onClick={() => create(false)} disabled={creating} className="card p-5 text-left hover:border-pz-green transition-all flex items-center gap-4">
                <Play size={24} className="text-pz-green flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-pz-text">No, just the normal game</div>
                  <div className="text-xs text-pz-subtext">Your server is ready to start right away</div>
                </div>
                <ArrowRight size={16} className="text-pz-muted" />
              </button>
            </div>
            {creating && <p className="text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Creating your server...</p>}
            <button onClick={() => setStep(1)} className="btn-ghost"><ArrowLeft size={14} /> Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

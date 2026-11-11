import { ArrowLeft, ArrowRight, CheckCircle, AlertTriangle, Download, Wrench, History, Play, Loader, Package } from 'lucide-react'
import type { ModdedPreset } from '../lib/modPresets'
import { downloadMinutes } from '../lib/modPresets'
import { formatBytes } from '../lib/profile'

// "Checked on 42.22.2", and a gentle note when this PC's server is a different build
function VersionNote({ preset, serverBuild, long }: { preset: ModdedPreset; serverBuild: string | null; long?: boolean }) {
  const v = preset.verified
  if (!v) return null
  const differs = !!serverBuild && serverBuild !== v.buildId
  if (!v.ok) {
    return <span className="text-xs text-pz-yellow flex items-center gap-1"><AlertTriangle size={11} /> Had problems on {v.gameVersion}</span>
  }
  if (!differs) {
    return <span className="text-xs text-pz-green flex items-center gap-1"><CheckCircle size={11} /> Checked on {v.gameVersion}</span>
  }
  return long ? (
    <p className="text-xs text-pz-yellow flex items-start gap-1.5">
      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
      This setup was checked on game version {v.gameVersion}, and your server is on a different version. It will most likely
      work fine. If a mod acts up, the Mods tab points it out, and your saved copies of the mods can stand in for one that broke.
    </p>
  ) : (
    <span className="text-xs text-pz-yellow flex items-center gap-1"><AlertTriangle size={11} /> Checked on {v.gameVersion}, your server is a different version</span>
  )
}

function sizeLine(p: ModdedPreset) {
  return `${p.mods.length} mods · ${formatBytes(p.downloadBytes)}`
}

export function ModdedPresetList({ presets, serverBuild, onPick }: { presets: ModdedPreset[]; serverBuild: string | null; onPick: (key: string) => void }) {
  if (presets.length === 0) return null
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-pz-text flex items-center gap-1.5"><Package size={13} /> Ready-made modded servers</h2>
        <p className="text-xs text-pz-subtext">Tested setups for a quick modded game. The mods, their load order and the settings they need are all done for you.</p>
      </div>
      {presets.map(p => (
        <button key={p.key} onClick={() => onPick(p.key)} className="card p-4 text-left w-full transition-all hover:border-pz-green group">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-pz-text">{p.label}</span>
            <span className="text-xs text-pz-muted">{sizeLine(p)}</span>
            <ArrowRight size={14} className="text-pz-muted ml-auto group-hover:text-pz-green" />
          </div>
          <p className="text-xs text-pz-subtext">{p.tagline}</p>
          <div className="mt-1.5"><VersionNote preset={p} serverBuild={serverBuild} /></div>
        </button>
      ))}
    </div>
  )
}

export function ReadyToBuild({ preset, difficulty, serverBuild, backupsOn, creating, error, onCreate, onBack }: {
  preset: ModdedPreset
  // the difficulty from the step before, when the game's preset files were found
  difficulty?: string
  serverBuild: string | null
  backupsOn: boolean
  creating: boolean
  error?: string
  onCreate: () => void
  onBack: () => void
}) {
  const minutes = downloadMinutes(preset)
  const workshop = preset.mods.filter(m => m.workshopId).length
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-pz-text">Ready to build "{preset.label}"</h1>
        <p className="text-sm text-pz-subtext mt-1">{preset.tagline}</p>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <div className="text-xs font-semibold text-pz-subtext uppercase tracking-wide mb-1">What it adds</div>
          <ul className="text-sm text-pz-text space-y-0.5 list-disc pl-5">
            {preset.adds.map(a => <li key={a}>{a}</li>)}
          </ul>
        </div>
        <VersionNote preset={preset} serverBuild={serverBuild} long />
        {difficulty && <p className="text-xs text-pz-muted">Difficulty: {difficulty}, from the step before.</p>}
      </div>

      <div className="space-y-2 text-sm text-pz-subtext">
        <p className="flex items-start gap-2">
          <Download size={14} className="text-pz-green mt-0.5 flex-shrink-0" />
          <span>
            <b className="text-pz-text">{workshop} mods, {formatBytes(preset.downloadBytes)} to download.</b>{' '}
            They download in the background once you press Create, usually in about {minutes} minute{minutes === 1 ? '' : 's'} (longer on a slow connection).
            The Mods tab shows how far along each one is. The first start after that takes a minute or two more while the server loads them.
          </span>
        </p>
        {preset.localMods.length > 0 && (
          <p className="flex items-start gap-2">
            <Wrench size={14} className="text-pz-green mt-0.5 flex-shrink-0" />
            <span>
              It uses {preset.localMods.length === 1 ? 'a small fix mod' : `${preset.localMods.length} small fix mods`} that comes with the app, installed for you.
              Friends get {preset.localMods.length === 1 ? 'it' : 'them'} in one click from your server pack (Mods → Import / Export → Share with players).
            </span>
          </p>
        )}
        <p className="flex items-start gap-2">
          <History size={14} className="text-pz-green mt-0.5 flex-shrink-0" />
          <span>
            {backupsOn ? 'Mod backups are on' : 'Mod backups get turned on'}: the app keeps a copy of each mod as it downloads, so if one is taken
            off the Workshop or an update breaks it, the working copy is still there.
          </span>
        </p>
      </div>

      <button onClick={onCreate} disabled={creating} className="card p-5 text-left w-full hover:border-pz-green transition-all flex items-center gap-4">
        <Play size={24} className="text-pz-green flex-shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-pz-text">Create the server</div>
          <div className="text-xs text-pz-subtext">Opens the Mods tab so you can watch the downloads</div>
        </div>
        {creating ? <Loader size={16} className="animate-spin text-pz-muted" /> : <ArrowRight size={16} className="text-pz-muted" />}
      </button>
      {creating && <p className="text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Creating your server...</p>}
      {error && <p className="text-sm text-pz-red">{error}</p>}
      <button onClick={onBack} disabled={creating} className="btn-ghost"><ArrowLeft size={14} /> Pick something else</button>
    </div>
  )
}

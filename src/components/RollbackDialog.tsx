import { useEffect, useState } from 'react'
import {
  X, History, Loader, CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronRight, ArrowLeft, Copy, Gamepad2,
  Package, Settings2, FolderOpen, Play, Trash2,
} from 'lucide-react'
import type { ServerProfile } from '../store/useAppStore'
import { useAppStore } from '../store/useAppStore'
import { quickPicks, whenLabel, dayLabel, REASON_LABELS, type QuickPickKey } from '../../shared/backups'
import { formatBytes } from '../lib/profile'

type Check = Awaited<ReturnType<typeof window.electronAPI.backups.check>>

type Step =
  | { kind: 'pick' }
  | { kind: 'check'; id: string }
  | { kind: 'working'; undo?: boolean }
  | { kind: 'done'; result: RollbackResult; undo?: boolean }

// "Roll back": pick a time (or a backup from the full list), see what changes, go.
// undo: skip straight to putting back the backup the last rollback made
export default function RollbackDialog({ profile, startWith, undo, onClose }: {
  profile: ServerProfile
  // open on the full list instead of the quick picks
  startWith?: 'list'
  undo?: boolean
  onClose: () => void
}) {
  const { serverStatuses } = useAppStore()
  const running = (serverStatuses[profile.id] || 'stopped') !== 'stopped'
  const [backups, setBackups] = useState<WorldBackup[] | null>(null)
  const [current, setCurrent] = useState<GameVersionNow | undefined>()
  const [step, setStep] = useState<Step>(undo ? { kind: 'working', undo: true } : { kind: 'pick' })
  const [showList, setShowList] = useState(startWith === 'list')
  const [progress, setProgress] = useState('')
  const [now] = useState(Date.now())

  const load = () => {
    window.electronAPI.server.listBackups(profile.id).then(setBackups).catch(() => setBackups([]))
    window.electronAPI.backups.summary(profile.id).then(s => setCurrent(s.current)).catch(() => undefined)
  }
  useEffect(load, [profile.id])
  useEffect(() => window.electronAPI.backups.onProgress((id, text) => { if (id === profile.id) setProgress(text) }), [profile.id])

  const run = async (go: () => Promise<RollbackResult>, isUndo = false) => {
    setProgress('')
    setStep({ kind: 'working', undo: isUndo })
    let result: RollbackResult
    try { result = await go() } catch (e) { result = { success: false, message: e instanceof Error ? e.message : String(e) } }
    setStep({ kind: 'done', result, undo: isUndo })
    // the game version may have changed with it
    load()
  }

  useEffect(() => {
    if (undo) void run(() => window.electronAPI.backups.undoRollback(profile.id, { stopFirst: true, warnMinutes: 1 }), true)
  }, [])

  const busy = step.kind === 'working'
  const byId = (id?: string) => backups?.find(b => b.name === id)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-pz-card border border-pz-border rounded-xl max-w-2xl w-full mx-4 shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-pz-green/20 text-pz-green"><History size={20} /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-pz-text">{step.kind === 'working' || step.kind === 'done' ? (step.undo ? 'Undo going back' : 'Roll back the world') : 'Roll back the world'}</h3>
            <p className="text-xs text-pz-muted">{profile.name}{current?.version ? ` · game ${current.version}` : ''}{current && current.branch !== 'public' ? ` · ${current.label}` : ''}</p>
          </div>
          {!busy && <button onClick={onClose} className="text-pz-muted hover:text-pz-text transition-colors"><X size={16} /></button>}
        </div>

        <div className="px-6 pb-6 overflow-y-auto">
          {step.kind === 'pick' && (
            <Pick
              backups={backups} now={now} current={current} showList={showList} setShowList={setShowList}
              onPick={(id) => setStep({ kind: 'check', id })} profile={profile} reload={load}
            />
          )}
          {step.kind === 'check' && (
            <CheckStep
              profile={profile} backup={byId(step.id)} id={step.id} now={now} running={running}
              onBack={() => setStep({ kind: 'pick' })}
              onGo={(opts) => run(() => window.electronAPI.backups.rollback(profile.id, step.id, opts))}
            />
          )}
          {step.kind === 'working' && (
            <div className="py-8 flex flex-col items-center text-center gap-3">
              <Loader size={28} className="text-pz-green animate-spin" />
              <p className="text-sm text-pz-text">{progress || (step.undo ? 'Undoing...' : 'Getting started...')}</p>
              <p className="text-xs text-pz-muted">Keep the app open until this is done.</p>
            </div>
          )}
          {step.kind === 'done' && <Done profile={profile} result={step.result} undo={step.undo} onClose={onClose} onBack={() => { load(); setStep({ kind: 'pick' }) }} />}
        </div>
      </div>
    </div>
  )
}

// ── Picking a time ───────────────────────────────────────────────────────────

function Pick({ backups, now, current, showList, setShowList, onPick, profile, reload }: {
  backups: WorldBackup[] | null
  now: number
  current?: GameVersionNow
  showList: boolean
  setShowList: (v: boolean) => void
  onPick: (id: string) => void
  profile: ServerProfile
  reload: () => void
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  if (!backups) return <p className="text-sm text-pz-muted flex items-center gap-2 py-4"><Loader size={14} className="animate-spin" /> Looking at your backups...</p>
  if (backups.length === 0) {
    return <p className="text-sm text-pz-subtext py-4">No backups yet. One gets made every time the server starts, and every 30 minutes while people play.</p>
  }
  const picks = quickPicks(
    backups.map(b => ({ id: b.name, createdAt: Date.parse(b.createdAt), reason: b.reason, game: b.game })),
    now, { buildId: current?.buildId, worldVersion: current?.worldVersion },
  )
  const icon: Record<QuickPickKey, string> = { 'before-update': 'update', hour: '1h', yesterday: '1d', week: '7d' }

  // the full list, one heading per day
  const days: Array<{ label: string; items: WorldBackup[] }> = []
  for (const b of backups) {
    const label = dayLabel(Date.parse(b.createdAt), now)
    if (days[days.length - 1]?.label !== label) days.push({ label, items: [] })
    days[days.length - 1].items.push(b)
  }

  const remove = async (id: string) => {
    setDeleting(id)
    await window.electronAPI.backups.delete(profile.id, id)
    setDeleting(null)
    reload()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-pz-subtext">Pick when to go back to. The world as it is now gets backed up first, so you can undo this.</p>
      <div className="grid grid-cols-2 gap-2">
        {picks.map(p => {
          const b = backups.find(x => x.name === p.id)
          return (
            <button
              key={p.key}
              onClick={() => p.id && onPick(p.id)}
              disabled={!p.id}
              className="bg-pz-darker border border-pz-border rounded-lg p-3 text-left hover:border-pz-green transition-colors disabled:opacity-40 disabled:hover:border-pz-border disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-pz-text">
                <span className="text-[10px] font-mono uppercase text-pz-green bg-pz-green/10 rounded px-1.5 py-0.5">{icon[p.key]}</span>
                {p.label}
              </div>
              <div className="text-xs text-pz-subtext mt-1">
                {b ? whenLabel(Date.parse(b.createdAt), now) : p.key === 'before-update' ? 'No backup from an older game version' : 'No backup that old yet'}
              </div>
              {b && p.key === 'before-update' && b.game.version && <div className="text-[11px] text-pz-muted mt-0.5">Game {b.game.version}{b.game.label && b.game.branch !== 'public' ? ` · ${b.game.label}` : ''}</div>}
            </button>
          )
        })}
      </div>

      <div>
        <button onClick={() => setShowList(!showList)} className="text-xs text-pz-subtext hover:text-pz-text flex items-center gap-1">
          {showList ? <ChevronDown size={12} /> : <ChevronRight size={12} />} All backups ({backups.length})
        </button>
        {showList && (
          <div className="mt-2 space-y-3">
            {days.map(day => (
              <div key={day.label}>
                <div className="text-[11px] uppercase tracking-wide text-pz-muted mb-1">{day.label}</div>
                <div className="space-y-1">
                  {day.items.map(b => (
                    <div key={b.name} className="group flex items-center gap-2 bg-pz-darker border border-pz-border rounded-md px-3 py-1.5 hover:border-pz-green transition-colors">
                      <button onClick={() => onPick(b.name)} className="flex-1 flex items-center gap-2 text-left min-w-0">
                        <span className="text-sm text-pz-text w-20 flex-shrink-0">{new Date(b.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                        <ReasonChip reason={b.reason} />
                        <span className="text-xs text-pz-muted truncate">
                          {[b.game.version && `game ${b.game.version}`, !b.legacy && `${b.modCount} mod${b.modCount === 1 ? '' : 's'}`, `${b.sizeMb} MB`].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(b.name)} disabled={deleting === b.name}
                        className="text-pz-muted hover:text-pz-red opacity-0 group-hover:opacity-100 transition-opacity" title="Delete this backup"
                      >
                        {deleting === b.name ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={async () => window.electronAPI.shell.openPath(await window.electronAPI.server.openBackups(profile.id))}
              className="text-xs text-pz-green hover:underline flex items-center gap-1"
            >
              <FolderOpen size={12} /> Open backups folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function ReasonChip({ reason }: { reason: WorldBackup['reason'] }) {
  const tone = reason === 'manual' ? 'text-pz-green bg-pz-green/10'
    : reason === 'before-game-update' || reason === 'before-mod-update' ? 'text-pz-yellow bg-pz-yellow/10'
    : reason === 'before-rollback' || reason === 'before-restore' ? 'text-pz-blue bg-pz-blue/10'
    : 'text-pz-subtext bg-pz-border/60'
  return <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0 ${tone}`}>{REASON_LABELS[reason]}</span>
}

// ── What changes, and go ─────────────────────────────────────────────────────

function CheckStep({ profile, backup, id, now, running, onBack, onGo }: {
  profile: ServerProfile
  backup?: WorldBackup
  id: string
  now: number
  running: boolean
  onBack: () => void
  onGo: (opts: RollbackOptions) => void
}) {
  const { setActiveView } = useAppStore()
  const [check, setCheck] = useState<Check | null>(null)
  const [switchIt, setSwitchIt] = useState(true)
  const [restoreMods, setRestoreMods] = useState(false)
  const [restoreSettings, setRestoreSettings] = useState(true)
  const [force, setForce] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => { window.electronAPI.backups.check(profile.id, id).then(setCheck).catch(e => setCheck({ success: false, message: String(e) })) }, [id])

  const when = backup ? whenLabel(Date.parse(backup.createdAt), now) : ''
  if (!check) return <p className="text-sm text-pz-muted flex items-center gap-2 py-6"><Loader size={14} className="animate-spin" /> Checking the game version, mods and settings...</p>
  if (!check.success || !check.compat) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-pz-red">{check.message || "Couldn't check that backup."}</p>
        <button onClick={onBack} className="btn-outline"><ArrowLeft size={14} /> Back</button>
      </div>
    )
  }

  const { compat, current } = check
  const g = compat.game
  const nowVersion = current?.version ? `${current.version}${current.branch !== 'public' ? ` (${current.label})` : ''}` : 'the current version'
  const blocked = (g.kind === 'blocked' && !(force && g.canForce)) || (g.kind === 'unknown' && g.newerWorld)
  const switching = g.kind === 'switch' && (switchIt || g.required)
  const othersRunning = switching ? (check.sharedWith || []).filter(s => s.running) : []
  const modChanges = compat.mods.added.length + compat.mods.removed.length + compat.mods.updated.length
  const list = (names: string[]) => names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')

  const go = () => onGo({
    switchBranch: switching && g.kind === 'switch' ? g.branch : null,
    restoreMods,
    restoreSettings: restoreSettings && !check.legacy,
    force: g.kind === 'blocked' && force,
    stopFirst: running,
    warnMinutes: 1,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="text-pz-muted hover:text-pz-text" title="Pick another"><ArrowLeft size={14} /></button>
        <span className="text-sm text-pz-text font-medium">Go back to {when}?</span>
        {backup && <ReasonChip reason={backup.reason} />}
      </div>

      <div className="space-y-2">
        {/* game version */}
        <Row icon={g.kind === 'same' ? 'ok' : blocked ? 'bad' : 'warn'} title={<><Gamepad2 size={12} className="inline mr-1" />Game version</>}>
          {g.kind === 'same' && <p>Same game version as now{current?.version ? ` (${current.version})` : ''}.</p>}
          {g.kind === 'switch' && (
            <>
              <p>This backup is from game {g.version || g.label}, the server runs {nowVersion} now.</p>
              <label className={`flex items-start gap-2 mt-2 ${g.required ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={switchIt || g.required} disabled={g.required} onChange={e => setSwitchIt(e.target.checked)} className="mt-0.5 accent-pz-green" />
                <span className="text-pz-text">
                  Also switch the server to {g.label}{g.version && g.label !== g.version && !g.label.startsWith(g.version) ? ` (${g.version})` : ''}
                  {g.downloadBytes ? <span className="text-pz-muted"> · up to {formatBytes(g.downloadBytes)} to download</span> : null}
                </span>
              </label>
              {g.required
                ? <p className="text-xs text-pz-muted mt-1">Needed: this world was saved by a newer game version than the server has, and the game can't load newer worlds.</p>
                : !switchIt && <p className="text-xs text-pz-yellow mt-1">Without switching, the server converts this world to {nowVersion} when it loads it. After that it can't go back to {g.version || g.label}.</p>}
            </>
          )}
          {g.kind === 'blocked' && g.why === 'newer-world' && (
            <p>This backup is from a newer game version{g.version ? ` (${g.version})` : ''} than the server has, and Steam doesn't offer that version anymore. The game can't load worlds from newer versions, so it can't go back.</p>
          )}
          {g.kind === 'blocked' && g.why !== 'newer-world' && (
            <>
              <p>
                {g.why === 'no-steam'
                  ? "Couldn't ask Steam which game versions it has, so the server can't be switched to match this backup. Check your internet connection and try again."
                  : `This backup is from game ${g.version || 'version'} and Steam doesn't offer that version anymore, so the server can't go back to it.`}
              </p>
              {g.canForce && (
                <div className="mt-2">
                  <button onClick={() => setAdvanced(!advanced)} className="text-xs text-pz-subtext hover:text-pz-text flex items-center gap-1">
                    {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Advanced
                  </button>
                  {advanced && (
                    <label className="flex items-start gap-2 mt-2 bg-pz-red/10 border border-pz-red/30 rounded-md p-2 cursor-pointer">
                      <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="mt-0.5 accent-pz-red" />
                      <span className="text-xs text-pz-text">
                        <b className="text-pz-red">Restore the world anyway.</b> The server stays on {nowVersion} and converts this world when it loads it.
                        Things from the old version can break or disappear, mods may act up, and the world can't go back to the old version after that.
                      </span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
          {g.kind === 'unknown' && (g.newerWorld
            ? <p>This older backup is from a newer game version than the server has. The game can't load worlds from newer versions.</p>
            : <p>An older world-only backup: it didn't record its game version, mods or settings. The world goes back, everything else stays as it is.</p>)}
        </Row>

        {/* mods */}
        {!check.legacy && (
          <Row icon={modChanges ? 'warn' : 'ok'} title={<><Package size={12} className="inline mr-1" />Mods</>}>
            {modChanges === 0 ? <p>Same mods as now.</p> : (
              <>
                <p>
                  Since then: {[
                    compat.mods.added.length && `added ${list(compat.mods.added)}`,
                    compat.mods.removed.length && `removed ${list(compat.mods.removed)}`,
                    compat.mods.updated.length && `${list(compat.mods.updated)} got updated`,
                  ].filter(Boolean).join('; ')}.
                </p>
                {(compat.mods.added.length + compat.mods.removed.length > 0) && (
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={restoreMods} onChange={e => setRestoreMods(e.target.checked)} className="accent-pz-green" />
                    <span className="text-pz-text">Put the mod list back the way it was</span>
                  </label>
                )}
                {compat.mods.updated.length > 0 && (
                  <p className="text-xs text-pz-muted mt-1">
                    Mod updates come from the Workshop and can't be undone by going back. If an update broke something,{' '}
                    <button onClick={() => setActiveView('appsettings')} className="text-pz-green underline">mod backups</button> keep the older copies.
                  </p>
                )}
              </>
            )}
          </Row>
        )}

        {/* settings */}
        {!check.legacy && (
          <Row icon={compat.settings.length ? 'warn' : 'ok'} title={<><Settings2 size={12} className="inline mr-1" />Settings</>}>
            {compat.settings.length === 0 ? <p>Same settings as now.</p> : <p>{compat.settings.length} setting{compat.settings.length === 1 ? '' : 's'} changed since then ({list(compat.settings)}).</p>}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={restoreSettings} onChange={e => setRestoreSettings(e.target.checked)} className="accent-pz-green" />
              <span className="text-pz-text">Put the settings back too</span>
            </label>
          </Row>
        )}
      </div>

      {switching && (check.sharedWith || []).length > 0 && (
        <p className={`text-xs rounded-md px-3 py-2 border ${othersRunning.length ? 'text-pz-red bg-pz-red/10 border-pz-red/30' : 'text-pz-subtext bg-pz-darker border-pz-border'}`}>
          {othersRunning.length
            ? `Stop ${othersRunning.map(s => `"${s.name}"`).join(', ')} first: ${othersRunning.length === 1 ? 'it uses' : 'they use'} the same game server files, which switch version too.`
            : `${(check.sharedWith || []).map(s => `"${s.name}"`).join(', ')} ${(check.sharedWith || []).length === 1 ? 'uses' : 'use'} the same game server files and switch${(check.sharedWith || []).length === 1 ? 'es' : ''} version too (their worlds get backed up first).`}
        </p>
      )}

      {running && !blocked && (
        <p className="text-xs text-pz-yellow bg-pz-yellow/10 border border-pz-yellow/30 rounded-md px-3 py-2">
          The server is running{check.players ? ` with ${check.players} player${check.players === 1 ? '' : 's'} on. They get a 1 minute warning in chat, then it` : ', it'} stops first.
        </p>
      )}

      <div className="flex gap-3 justify-end pt-1">
        <button onClick={onBack} className="btn-outline">Back</button>
        <button onClick={go} disabled={blocked || othersRunning.length > 0} className={g.kind === 'blocked' && force ? 'btn-danger' : 'btn-primary'}>
          <History size={14} /> {g.kind === 'blocked' && force ? 'Restore anyway' : running ? 'Stop and roll back' : 'Roll back'}
        </button>
      </div>
    </div>
  )
}

function Row({ icon, title, children }: { icon: 'ok' | 'warn' | 'bad'; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 bg-pz-darker border border-pz-border rounded-lg p-3">
      {icon === 'ok' ? <CheckCircle size={16} className="text-pz-green flex-shrink-0 mt-0.5" />
        : icon === 'warn' ? <AlertTriangle size={16} className="text-pz-yellow flex-shrink-0 mt-0.5" />
        : <XCircle size={16} className="text-pz-red flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0 text-sm text-pz-subtext">
        <div className="text-xs font-semibold text-pz-text uppercase tracking-wide mb-0.5">{title}</div>
        {children}
      </div>
    </div>
  )
}

// ── Done ─────────────────────────────────────────────────────────────────────

function Done({ profile, result, undo, onClose, onBack }: { profile: ServerProfile; result: RollbackResult; undo?: boolean; onClose: () => void; onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const [starting, setStarting] = useState(false)
  if (!result.success) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-pz-red/10 border border-pz-red/30 rounded-lg p-3">
          <XCircle size={16} className="text-pz-red flex-shrink-0 mt-0.5" />
          <p className="text-sm text-pz-text">{result.message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          {!undo && <button onClick={onBack} className="btn-outline"><ArrowLeft size={14} /> Back</button>}
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    )
  }
  const start = async () => {
    setStarting(true)
    await window.electronAPI.server.start(profile.id)
    onClose()
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle size={20} className="text-pz-green flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-pz-text font-medium">{undo ? 'Undone. The world is back to how it was before.' : 'Done. The world is back to how it was.'}</p>
          <p className="text-xs text-pz-subtext mt-0.5">
            {[
              result.gameChanged && `The server is on game ${result.gameChanged.version || result.gameChanged.label} now.`,
              result.settingsRestored && 'Settings went back too.',
              result.modsRestored && 'The mod list went back too.',
              !undo && 'Changed your mind? "Undo" on the Overview puts everything back.',
            ].filter(Boolean).join(' ')}
          </p>
        </div>
      </div>

      {result.gameChanged && result.playerSteps && (
        <div className="bg-pz-yellow/10 border border-pz-yellow/30 rounded-lg p-3 space-y-2">
          <p className="text-sm text-pz-text font-medium">Players need the same game version to join</p>
          <div className="flex items-start gap-2 bg-pz-darker border border-pz-border rounded-md px-3 py-2">
            <span className="text-sm text-pz-text flex-1 select-text">{result.playerSteps}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(result.playerSteps!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="text-pz-muted hover:text-pz-text flex-shrink-0 mt-0.5" title="Copy"
            >
              {copied ? <CheckCircle size={13} className="text-pz-green" /> : <Copy size={13} />}
            </button>
          </div>
          <p className="text-xs text-pz-muted">It's in the invite message on the Overview too.</p>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="btn-outline">Close</button>
        <button onClick={start} disabled={starting} className="btn-primary">
          {starting ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Start the server
        </button>
      </div>
    </div>
  )
}

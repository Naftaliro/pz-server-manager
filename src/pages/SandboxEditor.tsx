import { useEffect, useMemo, useState } from 'react'
import { Save, ArrowLeft, RotateCcw, Download, Upload, Loader, CheckCircle, AlertTriangle, Skull } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import GameSettingsEditor from '../components/GameSettingsEditor'
import ConfirmDialog from '../components/ConfirmDialog'
import { dataPath as profileDataPath, getServerName, patchProfile } from '../lib/profile'
import { loadSandboxSchema } from '../lib/gameSettings'
import type { SandboxSchema } from '../lib/gameSettings'
import { PRESETS, presetValues } from '../lib/presets'
import type { PresetKey } from '../lib/presets'
import { SANDBOX_GUIDE, SANDBOX_POPULAR, SANDBOX_TABS } from '../../shared/settingsGuide'
import {
  deepMerge, setPath, flatten, getPath, pathKey, mergeSandbox, parseSandbox, isGameWritten,
} from '../../shared/gameConfig'
import type { SettingValue, SettingsTree } from '../../shared/gameConfig'

// World & zombies: every sandbox setting, read from the game's own SandboxVars.lua
export default function SandboxEditor() {
  const { activeProfileId, profiles, serverStatuses, openServer } = useAppStore()
  const profile = profiles.find(p => p.id === activeProfileId)
  const running = !!profile && (serverStatuses[profile.id] || 'stopped') !== 'stopped'

  const [schema, setSchema] = useState<SandboxSchema | null>(null)
  const [loadError, setLoadError] = useState('')
  const [edits, setEdits] = useState<SettingsTree>({})
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'preset'; key: PresetKey } | { kind: 'reset' } | { kind: 'leave' } | null>(null)

  useEffect(() => {
    if (!profile) return
    loadSandboxSchema(profile).then(setSchema).catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [activeProfileId])

  const say = (tone: 'ok' | 'error', text: string) => { setNote({ tone, text }); setTimeout(() => setNote(null), 5000) }

  // what the server starts with: the file, with the app's saved settings on top
  const base = useMemo(() => deepMerge(schema?.fileValues || {}, (profile?.sandboxSettings || {}) as SettingsTree), [schema, profile?.sandboxSettings])
  const current = useMemo(() => deepMerge(base, edits), [base, edits])
  const changed = useMemo(() => new Set(flatten(edits).filter(([p, v]) => getPath(base, p) !== v).map(([p]) => pathKey(p))), [edits, base])

  if (!profile) return null

  const setValue = (path: string[], value: SettingValue) => setEdits(prev => setPath(prev, path, value))

  const save = async () => {
    setSaving(true)
    try {
      const saved = await patchProfile(profile.id, p => ({ sandboxSettings: deepMerge((p.sandboxSettings || {}) as SettingsTree, edits) }))
      const r = await window.electronAPI.config.writeSandbox(getServerName(profile), profileDataPath(profile), (saved?.sandboxSettings || {}) as SettingsTree)
      if (!r.success) throw new Error(r.message)
      setEdits({})
      say('ok', running ? 'Saved. Restart the server to use the new settings.' : 'Saved.')
    } catch (e) {
      say('error', `Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const applyPresetEdits = (key: PresetKey) => {
    const preset = schema?.presets[key]
    if (preset) setEdits(prev => deepMerge(prev, preset))
    setConfirm(null)
    say('ok', `${PRESETS[key].label} settings filled in. Look them over, then hit Save.`)
  }

  const resetAll = () => {
    let tree: SettingsTree = {}
    for (const d of schema?.defs || []) if (d.default !== undefined) tree = setPath(tree, d.path, d.default)
    setEdits(tree)
    setConfirm(null)
    say('ok', "Everything is back to the game's defaults. Hit Save to keep it.")
  }

  const importFile = async () => {
    const file = await window.electronAPI.dialog.openFile({ filters: [{ name: 'Sandbox settings', extensions: ['lua'] }, { name: 'All files', extensions: ['*'] }] })
    if (!file) return
    const r = await window.electronAPI.fs.readFile(file)
    if (!r.success || !r.content) { say('error', r.message || "Couldn't read that file."); return }
    // works for a SandboxVars.lua and for the game's preset files
    const values = presetValues(r.content)
    const count = flatten(values).length
    if (count === 0) { say('error', "That file doesn't have any sandbox settings in it."); return }
    setEdits(prev => deepMerge(prev, values))
    say('ok', `Loaded ${count} settings from the file. Hit Save to keep them.`)
  }

  const exportFile = async () => {
    const values = deepMerge((profile.sandboxSettings || {}) as SettingsTree, edits)
    const text = mergeSandbox(schema?.fileText || '', values, !isGameWritten(schema?.fileText || ''))
    const path = await window.electronAPI.dialog.saveFile({ defaultPath: `${getServerName(profile)}_SandboxVars.lua`, filters: [{ name: 'Sandbox settings', extensions: ['lua'] }] })
    if (!path) return
    await window.electronAPI.fs.writeFile(path, text)
    say('ok', `Saved ${parseSandbox(text).defs.length} settings to the file.`)
  }

  const back = () => (changed.size > 0 ? setConfirm({ kind: 'leave' }) : openServer(profile.id, 'settings'))

  const presetKeys = (Object.keys(PRESETS) as PresetKey[]).filter(k => schema?.presets[k])

  const notice = (
    <>
      {running && (
        <p className="text-xs text-pz-yellow bg-pz-yellow/10 border border-pz-yellow/30 rounded-lg px-3 py-2">
          The server is running. Changes apply the next time it starts.
        </p>
      )}
      {schema && schema.source !== 'server' && (
        <p className="text-xs text-pz-subtext bg-pz-blue/10 border border-pz-blue/30 rounded-lg px-3 py-2">
          This server hasn't been started yet, so the list comes from {schema.source === 'template' ? 'another of your servers' : "the game's presets"}.
          {' '}Anything you don't change here gets the game's default, and mod settings show up after the first start.
        </p>
      )}
    </>
  )

  const intro = (
    <>
      {presetKeys.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-pz-text mb-2 flex items-center gap-1.5"><Skull size={13} className="text-pz-muted" /> Start from one of the game's presets</div>
          <div className="grid grid-cols-2 gap-2">
            {presetKeys.map(k => (
              <button key={k} onClick={() => setConfirm({ kind: 'preset', key: k })} className="bg-pz-darker border border-pz-border rounded-lg p-2.5 text-left hover:border-pz-green transition-colors">
                <div className="text-sm font-medium text-pz-text">{PRESETS[k].label}</div>
                <div className="text-xs text-pz-subtext">{PRESETS[k].blurb}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={back} className="btn-ghost p-1.5" title="Back"><ArrowLeft size={16} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-pz-text">World & zombies</h1>
          <p className="text-xs text-pz-muted truncate">{profile.name} · {profile.buildVersion === 'b41' ? 'Build 41' : 'Build 42'} · how the world plays</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={importFile} className="btn-outline text-xs" title="Load settings from a SandboxVars.lua file"><Upload size={12} /> Load from file</button>
          <button onClick={exportFile} className="btn-outline text-xs" title="Save these settings as a SandboxVars.lua file"><Download size={12} /> Save to file</button>
          <button onClick={() => setConfirm({ kind: 'reset' })} disabled={!schema} className="btn-outline text-xs"><RotateCcw size={12} /> Game defaults</button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {loadError ? (
          <p className="p-6 text-sm text-pz-red">{loadError}</p>
        ) : !schema ? (
          <p className="p-6 text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Reading the game's settings...</p>
        ) : (
          <GameSettingsEditor
            defs={schema.defs}
            values={current}
            changed={changed}
            onChange={setValue}
            guide={SANDBOX_GUIDE}
            popular={SANDBOX_POPULAR}
            tabs={SANDBOX_TABS}
            modBlocks
            notice={notice}
            intro={intro}
          />
        )}
      </div>

      {(changed.size > 0 || note) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 card px-4 py-3 shadow-2xl flex items-center gap-4 border-pz-green/40 max-w-xl">
          {note && (
            <span className={`text-sm flex items-center gap-2 ${note.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>
              {note.tone === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />} {note.text}
            </span>
          )}
          {changed.size > 0 && (
            <>
              {!note && <span className="text-sm text-pz-text">{changed.size} unsaved change{changed.size === 1 ? '' : 's'}</span>}
              <button onClick={() => setEdits({})} className="btn-ghost text-xs">Undo</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.kind === 'preset' ? `Use ${PRESETS[confirm.key].label}?` : confirm?.kind === 'reset' ? "Go back to the game's defaults?" : 'Leave without saving?'}
        message={confirm?.kind === 'preset'
          ? "Every game setting is set to this preset (mod settings stay). Nothing is saved until you hit Save."
          : confirm?.kind === 'reset'
            ? "Every setting, mod settings too, goes back to what the game uses by default. Nothing is saved until you hit Save."
            : `You have ${changed.size} unsaved change${changed.size === 1 ? '' : 's'}.`}
        confirmLabel={confirm?.kind === 'preset' ? 'Fill it in' : confirm?.kind === 'reset' ? 'Reset' : 'Leave'}
        danger={confirm?.kind === 'leave'}
        onConfirm={() => {
          if (confirm?.kind === 'preset') applyPresetEdits(confirm.key)
          else if (confirm?.kind === 'reset') resetAll()
          else { setConfirm(null); openServer(profile.id, 'settings') }
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

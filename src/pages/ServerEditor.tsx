import { useState, useEffect, useMemo } from 'react'
import { Save, FolderOpen, ArrowLeft, Trash2, AlertTriangle, CheckCircle, XCircle, Loader, Download, Upload, FileCode2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile, BuildVersion, LaunchMode } from '../store/useAppStore'
import ConfirmDialog from '../components/ConfirmDialog'
import GameSettingsEditor from '../components/GameSettingsEditor'
import { getServerName, formatModIds, dataPath as profileDataPath, patchProfile } from '../lib/profile'
import { loadIniSchema } from '../lib/gameSettings'
import type { Schema } from '../lib/gameSettings'
import { orderModIds } from '../../shared/modCore'
import { deepMerge, flatten, getPath, pathKey, parseIni, mergeIni } from '../../shared/gameConfig'
import type { SettingValue, SettingsTree } from '../../shared/gameConfig'
import { INI_GUIDE, INI_POPULAR, INI_TABS, INI_HIDDEN } from '../../shared/settingsGuide'

type AppFields = Pick<ServerProfile, 'name' | 'description' | 'buildVersion' | 'serverInstallPath' | 'worldSavePath' | 'memory' | 'adminPassword' | 'serverPassword' | 'launchMode'>

const appFields = (p: ServerProfile): AppFields => ({
  name: p.name,
  description: p.description || '',
  buildVersion: p.buildVersion || 'b42',
  serverInstallPath: p.serverInstallPath,
  worldSavePath: p.worldSavePath || '',
  memory: p.memory,
  adminPassword: p.adminPassword,
  serverPassword: p.serverPassword,
  launchMode: p.launchMode || 'managed',
})

const hiddenIni = (key: string) => INI_HIDDEN.has(key)

// Server options: the app's own server settings (Basics) and every option in the game's
// <name>.ini, read from the file the game writes so each one has its description
export default function ServerEditor() {
  const { activeProfileId, profiles, serverStatuses, openServer } = useAppStore()
  const profile = profiles.find(p => p.id === activeProfileId)
  const running = !!profile && (serverStatuses[profile.id] || 'stopped') !== 'stopped'

  const [form, setForm] = useState<AppFields | null>(profile ? appFields(profile) : null)
  const [schema, setSchema] = useState<Schema | null>(null)
  const [loadError, setLoadError] = useState('')
  const [edits, setEdits] = useState<SettingsTree>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<'wipe' | 'leave' | null>(null)

  useEffect(() => {
    if (!profile) return
    setForm(appFields(profile))
    loadIniSchema(profile).then(setSchema).catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [activeProfileId])

  const base = useMemo(() => deepMerge(schema?.fileValues || {}, (profile?.iniSettings || {}) as SettingsTree), [schema, profile?.iniSettings])
  const current = useMemo(() => deepMerge(base, edits), [base, edits])
  const changed = useMemo(() => new Set(flatten(edits).filter(([p, v]) => getPath(base, p) !== v).map(([p]) => pathKey(p))), [edits, base])

  if (!profile || !form) return null

  const formDirty = JSON.stringify(form) !== JSON.stringify(appFields(profile))
  const dirtyCount = changed.size + (formDirty ? 1 : 0)
  const set = <K extends keyof AppFields>(key: K, value: AppFields[K]) => setForm(prev => prev && ({ ...prev, [key]: value }))
  const say = (tone: 'ok' | 'error', text: string) => { setNote({ tone, text }); setTimeout(() => setNote(null), 5000) }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'The server needs a name.'
    if (form.name.length > 50) errs.name = 'Keep the name to 50 characters or less.'
    if (!form.serverInstallPath.trim()) errs.serverInstallPath = 'Pick the folder the server is installed in.'
    if (form.memory < 1024 || form.memory > 65536) errs.memory = 'Memory has to be between 1024 and 65536 MB.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const save = async () => {
    if (!validate()) { say('error', 'Fix the highlighted settings on the Basics tab first.'); return }
    setSaving(true)
    try {
      const saved = await patchProfile(profile.id, p => ({
        ...form,
        name: form.name.trim(),
        iniSettings: { ...p.iniSettings, ...edits, PublicName: form.name.trim() },
      }))
      if (!saved) throw new Error('That server is no longer in your list.')
      // the profile's own values win for these, same as when the server starts
      const r = await window.electronAPI.config.writeIni(getServerName(saved), profileDataPath(saved), {
        ...saved.iniSettings,
        DefaultPort: saved.port,
        UDPPort: saved.udpPort,
        MaxPlayers: saved.maxPlayers,
        Password: saved.serverPassword || '',
        Mods: formatModIds(orderModIds(saved.mods).order, saved.buildVersion),
        WorkshopItems: saved.mods.map(m => m.workshopId).filter(Boolean).join(';'),
      })
      if (!r.success) throw new Error(r.message)
      setEdits({})
      say('ok', running ? 'Saved. Restart the server to use the new settings.' : 'Saved.')
    } catch (e) {
      say('error', `Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const importIni = async () => {
    const file = await window.electronAPI.dialog.openFile({ filters: [{ name: 'Server settings', extensions: ['ini'] }, { name: 'All files', extensions: ['*'] }] })
    if (!file) return
    const r = await window.electronAPI.fs.readFile(file)
    if (!r.success || !r.content) { say('error', r.message || "Couldn't read that file."); return }
    // ports, passwords and mods belong to this server, not the one the file came from
    const values = Object.fromEntries(Object.entries(parseIni(r.content).values).filter(([k]) => !INI_HIDDEN.has(k)))
    if (Object.keys(values).length === 0) { say('error', "That file doesn't have any server settings in it."); return }
    setEdits(prev => ({ ...prev, ...values }))
    say('ok', `Loaded ${Object.keys(values).length} settings (not ports, passwords or mods). Hit Save to keep them.`)
  }

  const exportIni = async () => {
    const text = mergeIni(schema?.fileText || '', { ...profile.iniSettings, ...edits })
    const path = await window.electronAPI.dialog.saveFile({ defaultPath: `${getServerName(profile)}.ini`, filters: [{ name: 'Server settings', extensions: ['ini'] }] })
    if (!path) return
    await window.electronAPI.fs.writeFile(path, text)
    say('ok', 'Saved to the file.')
  }

  const wipe = async () => {
    setConfirm(null)
    const r = await window.electronAPI.world.wipe(getServerName(profile), profileDataPath(profile))
    say(r.success ? 'ok' : 'error', r.message)
  }

  const back = () => (dirtyCount > 0 ? setConfirm('leave') : openServer(profile.id, 'settings'))

  const basics = () => (
    <BasicsTab profile={profile} form={form} set={set} errors={errors} />
  )

  const danger = () => (
    <Section title="Wipe the world">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-pz-red flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-pz-subtext">
            Deletes the saved world: characters, bases and everything explored. Settings and mods stay.
            The Overview page's "Wipe world" makes a backup first, this one doesn't.
          </p>
          <p className="text-xs text-pz-muted mt-1">
            <code className="text-pz-text">{(form.worldSavePath || '%USERPROFILE%\\Zomboid') + '\\Saves\\Multiplayer\\' + getServerName(profile)}</code>
          </p>
        </div>
        <button onClick={() => setConfirm('wipe')} disabled={running} className="btn-danger flex-shrink-0 disabled:opacity-40" title={running ? 'Stop the server first' : ''}>
          <Trash2 size={14} /> Wipe
        </button>
      </div>
    </Section>
  )

  const notice = (
    <>
      {running && (
        <p className="text-xs text-pz-yellow bg-pz-yellow/10 border border-pz-yellow/30 rounded-lg px-3 py-2">
          The server is running. Changes apply the next time it starts.
        </p>
      )}
      {schema && schema.source !== 'server' && (
        <p className="text-xs text-pz-subtext bg-pz-blue/10 border border-pz-blue/30 rounded-lg px-3 py-2">
          This server hasn't been started yet, so {schema.source === 'template' ? 'the descriptions come from another of your servers' : 'only the settings the app knows about are listed'}.
          {' '}The game adds the rest the first time it starts.
        </p>
      )}
    </>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={back} className="btn-ghost p-1.5" title="Back"><ArrowLeft size={16} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-pz-text">Server options</h1>
          <p className="text-xs text-pz-muted truncate">{profile.name} · everything in the server's settings file</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={importIni} className="btn-outline text-xs" title="Load settings from another server's .ini file"><Upload size={12} /> Load from file</button>
          <button onClick={exportIni} className="btn-outline text-xs" title="Save these settings as a .ini file"><Download size={12} /> Save to file</button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {loadError ? (
          <p className="p-6 text-sm text-pz-red">{loadError}</p>
        ) : !schema ? (
          <p className="p-6 text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Reading the server's settings...</p>
        ) : (
          <GameSettingsEditor
            defs={schema.defs}
            values={current}
            changed={changed}
            onChange={(path, value: SettingValue) => setEdits(prev => ({ ...prev, [path[0]]: value }))}
            guide={INI_GUIDE}
            popular={INI_POPULAR}
            tabs={INI_TABS}
            hidden={hiddenIni}
            leadingTabs={[{ id: 'basics', label: 'Basics', render: basics }]}
            trailingTabs={[{ id: 'danger', label: 'Danger zone', render: danger }]}
            notice={notice}
          />
        )}
      </div>

      {(dirtyCount > 0 || note) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 card px-4 py-3 shadow-2xl flex items-center gap-4 border-pz-green/40 max-w-xl">
          {note && (
            <span className={`text-sm flex items-center gap-2 ${note.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>
              {note.tone === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />} {note.text}
            </span>
          )}
          {dirtyCount > 0 && (
            <>
              {!note && <span className="text-sm text-pz-text">Unsaved changes</span>}
              <button onClick={() => { setEdits({}); setForm(appFields(profile)); setErrors({}) }} className="btn-ghost text-xs">Undo</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm === 'wipe' ? 'Wipe this world?' : 'Leave without saving?'}
        message={confirm === 'wipe'
          ? `Everything in "${profile.name}" is deleted for good: characters, bases and explored map. No backup is made.`
          : 'Your changes here will be lost.'}
        confirmLabel={confirm === 'wipe' ? 'Wipe it' : 'Leave'}
        danger
        onConfirm={() => (confirm === 'wipe' ? wipe() : (setConfirm(null), openServer(profile.id, 'settings')))}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function BasicsTab({ profile, form, set, errors }: {
  profile: ServerProfile
  form: AppFields
  set: <K extends keyof AppFields>(key: K, value: AppFields[K]) => void
  errors: Record<string, string>
}) {
  const { setActiveProfileId, setActiveView } = useAppStore()
  const [pathStatus, setPathStatus] = useState<'idle' | 'checking' | 'ok' | 'found' | 'notfound'>('idle')
  const [pathFoundAt, setPathFoundAt] = useState('')

  const checkPath = async (dir: string) => {
    if (!dir.trim()) { setPathStatus('idle'); return }
    setPathStatus('checking')
    const result = await window.electronAPI.fs.findServerBat(dir)
    if (result.success && result.path && result.path !== dir) { setPathFoundAt(result.path); setPathStatus('found') }
    else setPathStatus(result.success ? 'ok' : 'notfound')
  }

  const browse = async (key: 'serverInstallPath' | 'worldSavePath') => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (!folder) return
    set(key, folder)
    if (key === 'serverInstallPath') void checkPath(folder)
  }

  return (
    <>
      <Section title="Server">
        <Field label="Name" error={errors.name}>
          <input value={form.name} onChange={e => set('name', e.target.value)} className="input" maxLength={50} />
        </Field>
        <Field label="Notes" hint="Only shown here, for your own reference.">
          <textarea value={form.description} onChange={e => set('description', e.target.value)} className="input resize-none" rows={2} />
        </Field>
        <Field label="Game version" hint={form.buildVersion === 'b41'
          ? 'Build 41 is the old version on the legacy41 Steam branch. Players have to switch to that branch to join.'
          : 'Build 42, the current version.'}>
          <div className="flex gap-2">
            {(['b42', 'b41'] as BuildVersion[]).map(v => (
              <button key={v} onClick={() => set('buildVersion', v)} className={`flex-1 py-2 rounded-md border text-sm font-semibold transition-colors ${
                form.buildVersion === v ? 'bg-pz-green/20 border-pz-green text-pz-green' : 'border-pz-border text-pz-muted hover:border-pz-text'
              }`}>
                {v === 'b42' ? 'Build 42' : 'Build 41 (legacy)'}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Passwords">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Admin password" hint={'Log in as "admin" with this to be the admin in-game.'}>
            <input type="password" value={form.adminPassword} onChange={e => set('adminPassword', e.target.value)} className="input" />
          </Field>
          <Field label="Join password" hint="Empty = anyone with the address can join.">
            <input type="password" value={form.serverPassword} onChange={e => set('serverPassword', e.target.value)} className="input" />
          </Field>
        </div>
      </Section>

      <Section title="Who writes the settings files">
        <div className="flex gap-3">
          {(['managed', 'passthrough'] as LaunchMode[]).map(mode => (
            <button key={mode} onClick={() => set('launchMode', mode)} className={`flex-1 py-3 px-4 rounded-md border text-sm transition-colors text-left ${
              form.launchMode === mode ? 'bg-pz-green/20 border-pz-green text-pz-green' : 'border-pz-border text-pz-muted hover:border-pz-text'
            }`}>
              <div className="font-semibold">{mode === 'managed' ? 'The app (recommended)' : 'Me, by hand'}</div>
              <div className="text-xs mt-0.5 opacity-80">
                {mode === 'managed'
                  ? 'Your settings from the app go into the files every time the server starts. Anything else in them is left alone.'
                  : "The app starts the server without touching the files. Edit them yourself in Raw files."}
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => { setActiveProfileId(profile.id); setActiveView('raweditor') }} className="btn-outline text-xs w-full">
          <FileCode2 size={13} /> Raw files (edit the .ini and SandboxVars.lua directly)
        </button>
      </Section>

      <Section title="Files">
        <Field label="Server installed at" error={errors.serverInstallPath}>
          <div className="flex gap-2">
            <input value={form.serverInstallPath} onChange={e => { set('serverInstallPath', e.target.value); setPathStatus('idle') }} onBlur={e => checkPath(e.target.value)} className="input" />
            <button onClick={() => browse('serverInstallPath')} className="btn-outline flex-shrink-0" title="Pick the folder"><FolderOpen size={14} /></button>
          </div>
          {pathStatus === 'checking' && <p className="text-xs text-pz-muted mt-1 flex items-center gap-1"><Loader size={12} className="animate-spin" /> Checking...</p>}
          {pathStatus === 'ok' && <p className="text-xs text-pz-green mt-1 flex items-center gap-1"><CheckCircle size={12} /> The server is there.</p>}
          {pathStatus === 'found' && (
            <p className="text-xs text-pz-yellow mt-1 flex items-center gap-2">
              Found it one folder down: <code className="text-pz-text">{pathFoundAt}</code>
              <button onClick={() => { set('serverInstallPath', pathFoundAt); setPathStatus('ok') }} className="btn-primary text-xs py-0.5 px-2">Use that</button>
            </p>
          )}
          {pathStatus === 'notfound' && <p className="text-xs text-pz-red mt-1 flex items-center gap-1"><XCircle size={12} /> No StartServer64.bat in that folder.</p>}
        </Field>
        <Field label="Zomboid folder (optional)" hint="Where the world and settings files live. Leave empty for the usual %USERPROFILE%\Zomboid.">
          <div className="flex gap-2">
            <input value={form.worldSavePath || ''} onChange={e => set('worldSavePath', e.target.value)} className="input" placeholder="%USERPROFILE%\Zomboid" />
            <button onClick={() => browse('worldSavePath')} className="btn-outline flex-shrink-0" title="Pick the folder"><FolderOpen size={14} /></button>
          </div>
        </Field>
        <Field label={`Memory: ${form.memory} MB`} error={errors.memory} hint="8192 MB is good for most servers, more with lots of mods.">
          <input type="range" min={2048} max={32768} step={512} value={form.memory} onChange={e => set('memory', Number(e.target.value))} className="w-full" />
        </Field>
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h2 className="section-title border-b border-pz-border pb-2">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-xs text-pz-muted mt-1">{hint}</p>}
      {error && <p className="text-xs text-pz-red mt-1">{error}</p>}
    </div>
  )
}

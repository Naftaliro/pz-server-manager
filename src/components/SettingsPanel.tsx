import { useEffect, useState } from 'react'
import { Save, Sliders, FileCode2, Settings2, Copy, Trash2, Skull, CheckCircle, Eye, EyeOff, Send, Loader, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile, BuildVersion } from '../store/useAppStore'
import ConfirmDialog from './ConfirmDialog'
import { PRESETS, PRESET_BLURBS } from '../lib/presets'
import type { PresetKey } from '../lib/presets'
import { patchProfile, RECOMMENDED_MEMORY_MB } from '../lib/profile'

// The settings normal people actually change. Everything else is one click away under "More settings".
export default function SettingsPanel({ profile }: { profile: ServerProfile }) {
  const { settings, serverStatuses, setActiveView, setActiveProfileId, setProfiles, removeProfile, openServer } = useAppStore()
  const advanced = !!settings?.advancedMode
  const running = (serverStatuses[profile.id] || 'stopped') !== 'stopped'

  const fromProfile = () => ({
    name: profile.name,
    serverPassword: profile.serverPassword || '',
    adminPassword: profile.adminPassword || '',
    maxPlayers: profile.maxPlayers,
    memory: profile.memory,
    pvp: profile.iniSettings?.PVP !== false,
    isPublic: profile.iniSettings?.Public === true,
    publicDescription: String(profile.iniSettings?.PublicDescription || ''),
    welcome: String(profile.iniSettings?.ServerWelcomeMessage || ''),
    port: profile.port,
    buildVersion: profile.buildVersion,
    autoRestart: profile.autoRestart !== false,
    restartOnModUpdate: profile.restartOnModUpdate !== false,
    backupsEnabled: profile.backupsEnabled !== false,
    backupsToKeep: profile.backupsToKeep || 5,
    dailyRestartHour: profile.dailyRestartHour ?? null,
    discordWebhook: profile.discordWebhook || '',
    discordPlayerEvents: !!profile.discordPlayerEvents,
  })
  const [form, setForm] = useState(fromProfile)
  const [totalMem, setTotalMem] = useState(16384)
  const [saved, setSaved] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [presetConfirm, setPresetConfirm] = useState<PresetKey | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => { setForm(fromProfile()) }, [profile.id, profile.updatedAt])
  useEffect(() => { window.electronAPI.system.info().then(i => setTotalMem(i.totalMemMb)).catch(() => undefined) }, [])

  const dirty = JSON.stringify(form) !== JSON.stringify(fromProfile())
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(prev => ({ ...prev, [key]: value }))

  const save = async () => {
    await patchProfile(profile.id, p => ({
      name: form.name.trim() || p.name,
      serverPassword: form.serverPassword,
      adminPassword: form.adminPassword || p.adminPassword,
      maxPlayers: form.maxPlayers,
      memory: form.memory,
      port: form.port,
      udpPort: form.port + 1,
      buildVersion: form.buildVersion,
      autoRestart: form.autoRestart,
      restartOnModUpdate: form.restartOnModUpdate,
      backupsEnabled: form.backupsEnabled,
      backupsToKeep: form.backupsToKeep,
      dailyRestartHour: form.dailyRestartHour,
      discordWebhook: form.discordWebhook.trim(),
      discordPlayerEvents: form.discordPlayerEvents,
      iniSettings: {
        ...p.iniSettings,
        PVP: form.pvp,
        Public: form.isPublic,
        PublicName: form.name.trim() || p.name,
        PublicDescription: form.publicDescription,
        ServerWelcomeMessage: form.welcome,
      },
    }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const applyPreset = async (key: PresetKey) => {
    const { ZombieConfig, ...rest } = PRESETS[key].settings as Record<string, unknown> & { ZombieConfig?: Record<string, unknown> }
    await patchProfile(profile.id, p => {
      const current = p.sandboxSettings || {}
      return {
        sandboxSettings: {
          ...current,
          ...rest,
          ZombieConfig: { ...((current.ZombieConfig as Record<string, unknown>) || {}), ...(ZombieConfig || {}) },
        },
      }
    })
    setPresetConfirm(null)
  }

  const duplicate = async () => {
    const dup = await window.electronAPI.profiles.duplicate(profile.id)
    setProfiles(await window.electronAPI.profiles.list())
    if (dup) openServer(dup.id, 'settings')
  }

  const remove = async () => {
    await window.electronAPI.profiles.delete(profile.id)
    removeProfile(profile.id)
    setActiveProfileId(null)
    setActiveView('home')
  }

  const openAdvanced = (view: 'editor' | 'sandbox' | 'raweditor') => {
    setActiveProfileId(profile.id)
    setActiveView(view)
  }

  const memMax = Math.max(4096, Math.floor((totalMem - 2048) / 1024) * 1024)

  return (
    <div className="h-full overflow-y-auto p-6 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        {running && (
          <p className="text-xs text-pz-yellow bg-pz-yellow/10 border border-pz-yellow/30 rounded-lg px-3 py-2">
            The server is running. Changes apply the next time it starts.
          </p>
        )}

        <Card title="Basics">
          <Field label="Server name">
            <input value={form.name} onChange={e => set('name', e.target.value)} className="input" maxLength={50} />
          </Field>
          <Field label="Join password" hint="Leave empty to let anyone with the address in.">
            <input value={form.serverPassword} onChange={e => set('serverPassword', e.target.value)} className="input" placeholder="(no password)" />
          </Field>
          <Field label="Admin password" hint={'Log in as "admin" with this password to be the admin in-game.'}>
            <div className="flex gap-2">
              <input type={showPw ? 'text' : 'password'} value={form.adminPassword} onChange={e => set('adminPassword', e.target.value)} className="input" />
              <button onClick={() => setShowPw(s => !s)} className="btn-outline flex-shrink-0" title={showPw ? 'Hide' : 'Show'}>
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
          <Field label={`Max players: ${form.maxPlayers}`}>
            <input type="range" min={1} max={64} value={form.maxPlayers} onChange={e => set('maxPlayers', Number(e.target.value))} className="w-full" />
          </Field>
          <Field label="Welcome message" hint="Shown in chat when someone joins.">
            <input value={form.welcome} onChange={e => set('welcome', e.target.value)} className="input" />
          </Field>
        </Card>

        <Card title="Gameplay">
          <Toggle label="PvP" hint="Players can hurt each other." value={form.pvp} onChange={v => set('pvp', v)} />
          <Toggle label="Show in the public server list" hint="Strangers can find and join it. Use a password if you turn this on." value={form.isPublic} onChange={v => set('isPublic', v)} />
          {form.isPublic && (
            <Field label="Public description">
              <input value={form.publicDescription} onChange={e => set('publicDescription', e.target.value)} className="input" />
            </Field>
          )}
        </Card>

        <Card title="Difficulty">
          <p className="text-xs text-pz-subtext -mt-1 mb-2">Switching resets zombie and loot settings to that preset. Your world stays.</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(PRESETS) as PresetKey[]).map(key => (
              <button key={key} onClick={() => setPresetConfirm(key)} className="bg-pz-darker border border-pz-border rounded-lg p-3 text-left hover:border-pz-green transition-colors">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-pz-text"><Skull size={12} className="text-pz-muted" /> {PRESETS[key].label}</div>
                <div className="text-xs text-pz-subtext mt-0.5">{PRESET_BLURBS[key]}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Keep it running">
          <Toggle label="Restart if it crashes" hint="Brings the server back by itself if it stops unexpectedly (gives up after 3 crashes in 30 minutes)." value={form.autoRestart} onChange={v => set('autoRestart', v)} />
          <Toggle label="Restart when a mod updates" hint="When a mod updates on the Workshop, players get a 5 minute warning in chat and the server restarts with the new version. Otherwise nobody with the update can join." value={form.restartOnModUpdate} onChange={v => set('restartOnModUpdate', v)} />
          <Toggle label="Restart every day" hint="Long-running servers slowly get laggy. Players get a 5 minute warning in chat and it's back up on the hour. Only happens while the app is open." value={form.dailyRestartHour !== null} onChange={v => set('dailyRestartHour', v ? 4 : null)} />
          {form.dailyRestartHour !== null && (
            <Field label="Restart at">
              <select value={form.dailyRestartHour} onChange={e => set('dailyRestartHour', Number(e.target.value))} className="input w-40">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</option>
                ))}
              </select>
            </Field>
          )}
          <Toggle label="Back up the world every time it starts" hint="Restore from the World section on the Overview page." value={form.backupsEnabled} onChange={v => set('backupsEnabled', v)} />
          {form.backupsEnabled && (
            <Field label={`Keep the last ${form.backupsToKeep} backups`}>
              <input type="range" min={1} max={20} value={form.backupsToKeep} onChange={e => set('backupsToKeep', Number(e.target.value))} className="w-full" />
            </Field>
          )}
        </Card>

        <Card title="Discord">
          <DiscordSettings
            webhook={form.discordWebhook}
            playerEvents={form.discordPlayerEvents}
            serverName={form.name || profile.name}
            onWebhook={v => set('discordWebhook', v)}
            onPlayerEvents={v => set('discordPlayerEvents', v)}
          />
        </Card>

        <Card title="Performance">
          <Field
            label={`Memory: ${(form.memory / 1024).toFixed(form.memory % 1024 ? 1 : 0)} GB`}
            hint={`This PC has ${Math.round(totalMem / 1024)} GB. ${RECOMMENDED_MEMORY_MB / 1024} GB is good for most servers, more if you have lots of mods. Leave some for Windows (and your own game, if you play on this PC).`}
          >
            <input type="range" min={2048} max={memMax} step={1024} value={Math.min(form.memory, memMax)} onChange={e => set('memory', Number(e.target.value))} className="w-full" />
          </Field>
        </Card>

        {advanced && (
          <Card title="Advanced">
            <Field label="Game port" hint={`Also uses ${form.port + 1}. Change it if you run two servers at once.`}>
              <input type="number" value={form.port} min={1024} max={65000} onChange={e => set('port', Number(e.target.value))} className="input w-40" />
            </Field>
            <Field label="Game version" hint="B41 runs from the legacy41 Steam branch and needs a matching server install (App Settings).">
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
          </Card>
        )}

        <Card title="More settings">
          <p className="text-xs text-pz-subtext -mt-1 mb-2">Every single option the game has, for when you want to tweak things.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button onClick={() => openAdvanced('sandbox')} className="btn-outline justify-center"><Sliders size={14} /> World & zombies</button>
            <button onClick={() => openAdvanced('editor')} className="btn-outline justify-center"><Settings2 size={14} /> Server options</button>
            {advanced && <button onClick={() => openAdvanced('raweditor')} className="btn-outline justify-center"><FileCode2 size={14} /> Raw files</button>}
          </div>
        </Card>

        <Card title="Server">
          <div className="flex gap-2 flex-wrap">
            <button onClick={duplicate} className="btn-outline"><Copy size={14} /> Make a copy</button>
            <button onClick={() => setDeleteOpen(true)} disabled={running} className="btn-outline text-pz-red disabled:opacity-40"><Trash2 size={14} /> Delete server</button>
          </div>
        </Card>
      </div>

      {(dirty || saved) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 card px-4 py-3 shadow-2xl flex items-center gap-4 border-pz-green/40">
          {saved ? (
            <span className="text-sm text-pz-green flex items-center gap-2"><CheckCircle size={14} /> Saved</span>
          ) : (
            <>
              <span className="text-sm text-pz-text">You have unsaved changes</span>
              <button onClick={() => setForm(fromProfile())} className="btn-ghost text-xs">Undo</button>
              <button onClick={save} className="btn-primary"><Save size={14} /> Save</button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!presetConfirm}
        title={`Switch to ${presetConfirm ? PRESETS[presetConfirm].label : ''}?`}
        message="Zombie and loot settings get replaced with this preset. Anything you changed by hand in World & zombies settings is overwritten."
        confirmLabel="Switch"
        onConfirm={() => presetConfirm && applyPreset(presetConfirm)}
        onCancel={() => setPresetConfirm(null)}
      />
      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete this server?"
        message="The server is removed from the app. Your world save is NOT deleted, it stays in your Zomboid folder."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h3 className="section-title">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-xs text-pz-muted mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center gap-3 text-left">
      <div className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${value ? 'bg-pz-green' : 'bg-pz-border'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-pz-text transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <div>
        <div className="text-sm text-pz-text">{label}</div>
        {hint && <div className="text-xs text-pz-muted">{hint}</div>}
      </div>
    </button>
  )
}

// Post server updates to a Discord channel through a webhook link
const isWebhookUrl = (url: string) => /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.trim())

function DiscordSettings({ webhook, playerEvents, serverName, onWebhook, onPlayerEvents }: {
  webhook: string
  playerEvents: boolean
  serverName: string
  onWebhook: (v: string) => void
  onPlayerEvents: (v: boolean) => void
}) {
  const [howTo, setHowTo] = useState(!webhook)
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({})
  const valid = isWebhookUrl(webhook)

  const sendTest = async () => {
    setTest({ busy: true })
    const r = await window.electronAPI.discord.test(webhook, serverName)
    setTest({ ok: r.success, message: r.success ? 'Sent! Check your Discord channel.' : r.message })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-pz-subtext -mt-1">
        Post to a Discord channel when the server comes online (with the address to join), crashes, restarts or gets stopped.
      </p>

      <button onClick={() => setHowTo(!howTo)} className="text-xs text-pz-blue flex items-center gap-1">
        {howTo ? <ChevronDown size={12} /> : <ChevronRight size={12} />} How do I get a webhook link?
      </button>
      {howTo && (
        <ol className="text-xs text-pz-subtext list-decimal pl-5 space-y-1">
          <li>In Discord, hover over the channel you want updates in and click the gear (<b>Edit Channel</b>).</li>
          <li>Go to <b>Integrations</b> → <b>Webhooks</b> → <b>New Webhook</b>.</li>
          <li>Click the new webhook, then <b>Copy Webhook URL</b>.</li>
          <li>Paste it below, hit <b>Send test message</b>, then <b>Save</b>.</li>
        </ol>
      )}
      <p className="text-xs text-pz-muted">You need to be an admin of the Discord server (or have "Manage Webhooks"). Anyone with the link can post in that channel, so keep it to yourself.</p>

      <div className="flex gap-2">
        <input
          type="password"
          value={webhook}
          onChange={e => { onWebhook(e.target.value); setTest({}) }}
          placeholder="https://discord.com/api/webhooks/..."
          className="input"
        />
        <button onClick={sendTest} disabled={!valid || test.busy} className="btn-outline flex-shrink-0 text-xs">
          {test.busy ? <Loader size={12} className="animate-spin" /> : <Send size={12} />} Send test message
        </button>
      </div>
      {webhook && !valid && <p className="text-xs text-pz-yellow flex items-center gap-1"><AlertCircle size={12} /> That doesn't look like a webhook link. It should start with https://discord.com/api/webhooks/</p>}
      {test.message && (
        <p className={`text-xs flex items-center gap-1 ${test.ok ? 'text-pz-green' : 'text-pz-yellow'}`}>
          {test.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {test.message}
        </p>
      )}

      {webhook && (
        <Toggle label="Also post when players join or leave" hint="Handy for small groups, noisy for big ones." value={playerEvents} onChange={onPlayerEvents} />
      )}
    </div>
  )
}

// Builds what the settings editors show from the game's own files
import { parseSandbox, parseIni, VANILLA_BLOCKS, isTree } from '../../shared/gameConfig'
import type { SettingDef, SettingsTree } from '../../shared/gameConfig'
import { presetValues, PRESETS } from './presets'
import type { PresetKey } from './presets'
import type { ServerProfile } from '../store/useAppStore'

// server: this server's own file. template: another server's (it hasn't started yet).
// preset: only the game's preset file was found, so no descriptions
export type SchemaSource = 'server' | 'template' | 'preset' | 'profile'

export interface Schema {
  defs: SettingDef[]
  // what the server's file has now (empty before its first start)
  fileValues: SettingsTree
  // the file as found, for exports
  fileText?: string
  source: SchemaSource
}

export interface SandboxSchema extends Schema {
  presets: Partial<Record<PresetKey, SettingsTree>>
}

export async function loadSandboxSchema(profile: ServerProfile): Promise<SandboxSchema> {
  const r = await window.electronAPI.config.sources(profile.id)
  if (!r.success) throw new Error(r.message || "Couldn't read the server's files.")
  const presets: SandboxSchema['presets'] = {}
  for (const key of Object.keys(PRESETS) as PresetKey[]) if (r.presets?.[key]) presets[key] = presetValues(r.presets[key])

  if (r.sandbox && r.sandboxFromGame) {
    const parsed = parseSandbox(r.sandbox)
    return { defs: parsed.defs.filter(notVersion), fileValues: parsed.values, fileText: r.sandbox, source: 'server', presets }
  }
  // not started yet: our own file (if any) has the values, the descriptions come from elsewhere
  const own = r.sandbox ? parseSandbox(r.sandbox).values : {}
  if (r.sandboxTemplate) {
    // another server's mod settings don't belong here
    const defs = parseSandbox(r.sandboxTemplate).defs.filter(d => notVersion(d) && (d.path.length === 1 || VANILLA_BLOCKS.includes(d.path[0])))
    return { defs, fileValues: own, fileText: r.sandbox, source: 'template', presets }
  }
  const base = r.presets?.Apocalypse
  if (base) {
    // the preset's values are the game's defaults
    const defs = parseSandbox(base).defs.filter(notVersion).map(d => ({ ...d }))
    const values = presetValues(base)
    for (const d of defs) d.default = lookup(values, d.path)
    return { defs, fileValues: own, fileText: r.sandbox, source: 'preset', presets }
  }
  return { defs: defsFromValues(profile.sandboxSettings as SettingsTree), fileValues: own, fileText: r.sandbox, source: 'profile', presets }
}

export async function loadIniSchema(profile: ServerProfile): Promise<Schema> {
  const r = await window.electronAPI.config.sources(profile.id)
  if (!r.success) throw new Error(r.message || "Couldn't read the server's files.")
  const own = r.ini ? parseIni(r.ini) : undefined
  if (own && own.defs.some(d => d.description)) return { defs: own.defs, fileValues: own.values, fileText: r.ini, source: 'server' }
  if (r.iniTemplate) return { defs: parseIni(r.iniTemplate).defs.map(d => ({ ...d, default: undefined })), fileValues: own?.values || {}, fileText: r.ini, source: 'template' }
  return { defs: defsFromValues(profile.iniSettings as SettingsTree), fileValues: own?.values || {}, fileText: r.ini, source: 'profile' }
}

const notVersion = (d: SettingDef) => !(d.path.length === 1 && /^version$/i.test(d.path[0]))

function lookup(tree: SettingsTree, path: string[]) {
  let node: unknown = tree
  for (const p of path) node = isTree(node) ? node[p] : undefined
  return isTree(node) ? undefined : node as SettingDef['default']
}

// last resort: whatever the profile has, typed from the values
function defsFromValues(tree: SettingsTree = {}, prefix: string[] = []): SettingDef[] {
  const out: SettingDef[] = []
  for (const [k, v] of Object.entries(tree)) {
    if (isTree(v)) { out.push(...defsFromValues(v, [...prefix, k])); continue }
    if (prefix.length === 0 && /^version$/i.test(k)) continue
    out.push({ path: [...prefix, k], type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'string', decimal: typeof v === 'number' && !Number.isInteger(v) })
  }
  return out
}

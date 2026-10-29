// Reading and writing the game's own config files (<name>_SandboxVars.lua and <name>.ini).
// The game writes a description, range and default above every setting, so the editors
// read those instead of keeping their own list, and saving only touches the lines that
// changed. Pure logic only, Electron does the file access.

export type SettingValue = string | number | boolean
export interface SettingsTree { [key: string]: SettingValue | SettingsTree }

export interface SettingDef {
  // block names, then the key: ['ZombieLore', 'Speed']
  path: string[]
  type: 'bool' | 'number' | 'string'
  // game's own text, without the option list and range
  description?: string
  min?: number
  max?: number
  default?: SettingValue
  // numbered choices ("1 = Insane")
  options?: Array<{ value: number; label: string }>
  // the value has a decimal point in the file (0.8, 1.0)
  decimal?: boolean
}

export interface ParsedConfig {
  values: SettingsTree
  defs: SettingDef[]
}

// Sections that come with the game, anything else in SandboxVars is a mod's
export const VANILLA_BLOCKS = ['ZombieLore', 'ZombieConfig', 'MultiplierConfig', 'Map', 'Basement']

export const pathKey = (path: string[]) => path.join('.')

export function isTree(v: unknown): v is SettingsTree {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function getPath(tree: SettingsTree | undefined, path: string[]): SettingValue | undefined {
  let node: SettingValue | SettingsTree | undefined = tree
  for (const p of path) {
    if (!isTree(node)) return undefined
    node = node[p]
  }
  return isTree(node) ? undefined : node
}

export function setPath(tree: SettingsTree, path: string[], value: SettingValue): SettingsTree {
  const [head, ...rest] = path
  if (rest.length === 0) return { ...tree, [head]: value }
  const child = isTree(tree[head]) ? tree[head] as SettingsTree : {}
  return { ...tree, [head]: setPath(child, rest, value) }
}

export function deleteToPath(tree: SettingsTree, path: string[]): SettingsTree {
  const [head, ...rest] = path
  if (!(head in tree)) return tree
  const next = { ...tree }
  if (rest.length === 0) { delete next[head]; return next }
  if (!isTree(tree[head])) return tree
  const child = deleteToPath(tree[head] as SettingsTree, rest)
  if (Object.keys(child).length === 0) delete next[head]
  else next[head] = child
  return next
}

// b's values win, blocks are merged key by key
export function deepMerge(a: SettingsTree, b: SettingsTree): SettingsTree {
  const out: SettingsTree = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = isTree(v) && isTree(out[k]) ? deepMerge(out[k] as SettingsTree, v) : v
  }
  return out
}

// every (path, value) in a tree
export function flatten(tree: SettingsTree, prefix: string[] = []): Array<[string[], SettingValue]> {
  const out: Array<[string[], SettingValue]> = []
  for (const [k, v] of Object.entries(tree)) {
    if (isTree(v)) out.push(...flatten(v, [...prefix, k]))
    else out.push([[...prefix, k], v])
  }
  return out
}

// ── Lua ──────────────────────────────────────────────────────────────────────

function parseLuaValue(raw: string): SettingValue {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return Number(v)
  const m = v.match(/^"((?:[^"\\]|\\.)*)"$/)
  if (m) return m[1].replace(/\\(.)/g, '$1')
  return v
}

export function luaValue(value: SettingValue, decimal = false): string {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0'
    // the game writes 1.0 for decimal settings, keep it that way
    return decimal && Number.isInteger(value) ? value.toFixed(1) : String(value)
  }
  // some old profiles stored strings with their quotes already on
  const s = String(value).replace(/^"(.*)"$/, '$1').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')
  return `"${s}"`
}

// "Min: 0.00 Max: 4.00 Default: 0.80", "Default = Normal", option lines
function readComments(lines: string[], value: SettingValue): Omit<SettingDef, 'path' | 'type'> {
  const options: Array<{ value: number; label: string }> = []
  const text: string[] = []
  for (const line of lines) {
    const opt = line.match(/^(-?\d+)\s*=\s*(.+)$/)
    if (opt) options.push({ value: Number(opt[1]), label: opt[2].trim() })
    else text.push(line)
  }
  // the game puts formatting tags in a few of these: <BHC> [!] ... <RGB:1,1,1>
  let description = text.join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const out: Omit<SettingDef, 'path' | 'type'> = {}
  const range = description.match(/\s*Min:\s*(-?[\d.]+)\s+Max:\s*(-?[\d.]+)(?:\s+Default:\s*(-?[\d.]+))?\s*$/)
  if (range) {
    out.min = Number(range[1])
    out.max = Number(range[2])
    if (range[3] !== undefined) out.default = Number(range[3])
    description = description.slice(0, range.index).trim()
  }
  const enumDefault = description.match(/\s*Default\s*=\s*(.+)$/)
  if (enumDefault) {
    const label = enumDefault[1].trim()
    const hit = options.find(o => o.label.toLowerCase() === label.toLowerCase())
    if (hit) out.default = hit.value
    else if (typeof value === 'boolean') out.default = label.toLowerCase() === 'true'
    description = description.slice(0, enumDefault.index).trim()
  }
  if (description) out.description = description
  if (options.length > 0) out.options = options
  return out
}

const LUA_OPEN = /^(\w+)\s*=\s*\{\s*$/
const LUA_ROOT = /^(?:return|\w+\s*=)\s*\{\s*$/
const LUA_CLOSE = /^\}\s*,?\s*$/
const LUA_KEY = /^(\w+)\s*=\s*(.+?)\s*,?\s*$/
// a comment after the value, as long as it isn't inside a string
const stripLuaComment = (t: string) => t.replace(/\s*--[^"]*$/, '')

// SandboxVars.lua, or one of the game's preset files ("return { ... }")
export function parseSandbox(text: string): ParsedConfig {
  const values: SettingsTree = {}
  const defs: SettingDef[] = []
  const stack: string[] = []
  let started = false
  let comments: string[] = []

  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t) continue
    if (t.startsWith('--')) { comments.push(t.replace(/^--+\s?/, '')); continue }
    if (!started) {
      if (LUA_ROOT.test(t)) started = true
      comments = []
      continue
    }
    const open = t.match(LUA_OPEN)
    if (open) { stack.push(open[1]); comments = []; continue }
    if (LUA_CLOSE.test(t)) {
      if (stack.length === 0) break
      stack.pop()
      comments = []
      continue
    }
    const kv = stripLuaComment(t).match(LUA_KEY)
    if (kv) {
      const path = [...stack, kv[1]]
      const raw = kv[2]
      const value = parseLuaValue(raw)
      let node = values
      for (const p of stack) node = (isTree(node[p]) ? node[p] : (node[p] = {})) as SettingsTree
      node[kv[1]] = value
      defs.push({
        path,
        type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'number' : 'string',
        decimal: typeof value === 'number' && /\./.test(raw),
        ...readComments(comments, value),
      })
    }
    comments = []
  }
  return { values, defs }
}

// The game rewrites the file on every start with every setting it knows and a comment
// above each one. Our own files have none of those.
export function isGameWritten(text: string): boolean {
  return /^\s*--\s.*(Default|Min:)/m.test(text)
}

/**
 * Put `values` into an existing SandboxVars.lua, changing only the lines that hold those
 * settings, in the right section (ZombieLore.Strength and MultiplierConfig.Strength are
 * different settings). Comments, mod sections and everything else stay as they are.
 * Settings the file doesn't have are added unless `appendMissing` is false: a file the
 * game wrote already has every setting the game understands, so anything else would
 * just be ignored by it (old B41 names on a B42 server).
 */
export function mergeSandbox(existing: string, values: SettingsTree, appendMissing = true): string {
  values = writable(values)
  if (!existing.trim()) return serializeSandbox(values)
  const decimals = new Set(parseSandbox(existing).defs.filter(d => d.decimal).map(d => pathKey(d.path)))
  const written = new Set<string>()
  const out: string[] = []
  const stack: string[] = []
  let started = false

  const missingAt = (path: string[], indent: string): string[] => {
    if (!appendMissing) return []
    let node: SettingValue | SettingsTree | undefined = values
    for (const p of path) node = isTree(node) ? node[p] : undefined
    if (!isTree(node)) return []
    const lines: string[] = []
    for (const [k, v] of Object.entries(node)) {
      const full = [...path, k]
      if (isTree(v)) {
        // a whole section that isn't there yet (only at the top, sections inside are kept as found)
        if (!existing.match(new RegExp(`^\\s*${k}\\s*=\\s*\\{`, 'm')) && path.length === 0) {
          lines.push(`${indent}${k} = {`, ...blockLines(v, indent + '    ', full), `${indent}},`)
          markWritten(v, full)
        }
        continue
      }
      if (written.has(pathKey(full))) continue
      lines.push(`${indent}${k} = ${luaValue(v)},`)
      written.add(pathKey(full))
    }
    return lines
  }
  const markWritten = (tree: SettingsTree, prefix: string[]) => {
    for (const [p] of flatten(tree, prefix)) written.add(pathKey(p))
  }

  const lines = existing.split(/\r?\n/)
  // keep the trailing newline as found
  if (lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    const t = line.trim()
    if (!started) {
      out.push(line)
      if (LUA_ROOT.test(t)) started = true
      continue
    }
    if (!t || t.startsWith('--')) { out.push(line); continue }
    const open = t.match(LUA_OPEN)
    if (open) { stack.push(open[1]); out.push(line); continue }
    if (LUA_CLOSE.test(t)) {
      const indent = line.match(/^\s*/)![0] + '    '
      out.push(...missingAt(stack, indent))
      out.push(line)
      if (stack.length === 0) { started = false; continue }
      stack.pop()
      continue
    }
    const kv = stripLuaComment(t).match(LUA_KEY)
    if (kv) {
      const path = [...stack, kv[1]]
      const v = getPath(values, path)
      if (v !== undefined) {
        const indent = line.match(/^\s*/)![0]
        out.push(`${indent}${kv[1]} = ${luaValue(v, decimals.has(pathKey(path)))},`)
        written.add(pathKey(path))
        continue
      }
    }
    out.push(line)
  }
  const eol = eolOf(existing)
  return out.join(eol) + eol
}

// the game writes the .ini with Windows line endings, keep whatever the file uses
const eolOf = (text: string) => (/\r\n/.test(text) ? '\r\n' : '\n')

function blockLines(tree: SettingsTree, indent: string, prefix: string[]): string[] {
  const lines: string[] = []
  for (const [k, v] of Object.entries(tree)) {
    if (isTree(v)) lines.push(`${indent}${k} = {`, ...blockLines(v, indent + '    ', [...prefix, k]), `${indent}},`)
    else lines.push(`${indent}${k} = ${luaValue(v)},`)
  }
  return lines
}

// The file format version is the game's business: old profiles stored VERSION = 4, which
// would tell B42 (version 6) it's reading an old file. Preset files call it Version.
function writable(values: SettingsTree): SettingsTree {
  const { VERSION, Version, ...rest } = values
  return rest
}

export function serializeSandbox(values: SettingsTree): string {
  return ['SandboxVars = {', ...blockLines(writable(values), '    ', []), '}'].join('\n') + '\n'
}

// ── INI ──────────────────────────────────────────────────────────────────────

function parseIniValue(raw: string): SettingValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

export function parseIni(text: string): ParsedConfig {
  const values: SettingsTree = {}
  const defs: SettingDef[] = []
  let comments: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t) { comments = []; continue }
    if (t.startsWith('#') || t.startsWith(';')) { comments.push(t.replace(/^[#;]+\s?/, '')); continue }
    const eq = t.indexOf('=')
    if (eq === -1) { comments = []; continue }
    const key = t.slice(0, eq).trim()
    const rawValue = t.slice(eq + 1).trim()
    const value = parseIniValue(rawValue)
    values[key] = value
    const desc = readComments(comments, value)
    defs.push({
      path: [key],
      type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'number' : 'string',
      decimal: typeof value === 'number' && rawValue.includes('.'),
      ...desc,
    })
    comments = []
  }
  return { values, defs }
}

function iniValue(v: SettingValue): string {
  return String(v).replace(/[\r\n]+/g, ' ')
}

// Same idea as mergeSandbox: change the lines that hold these settings, add new ones at the end
export function mergeIni(existing: string, values: Record<string, unknown>): string {
  const written = new Set<string>()
  const lines = existing ? existing.split(/\r?\n/) : []
  if (lines[lines.length - 1] === '') lines.pop()
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    const eq = t.indexOf('=')
    if (!t || t.startsWith('#') || t.startsWith(';') || eq === -1) { out.push(line); continue }
    const key = t.slice(0, eq).trim()
    const v = values[key]
    if (v === undefined || v === null || isTree(v)) { out.push(line); continue }
    written.add(key)
    // same value: leave the line alone (the game writes 30.0, we'd write 30)
    if (parseIniValue(t.slice(eq + 1).trim()) === v) { out.push(line); continue }
    out.push(`${key}=${iniValue(v as SettingValue)}`)
  }
  const added = Object.entries(values).filter(([k, v]) => !written.has(k) && v !== undefined && v !== null && !isTree(v))
  if (added.length > 0 && out.length > 0 && out[out.length - 1] !== '') out.push('')
  for (const [k, v] of added) out.push(`${k}=${iniValue(v as SettingValue)}`)
  const eol = eolOf(existing)
  return out.length > 0 ? out.join(eol) + eol : ''
}

// "ZombiesCountBeforeDelete" -> "Zombies count before delete"
export function humanize(key: string): string {
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ')
}

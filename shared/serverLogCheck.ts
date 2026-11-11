// Reading a dedicated server's log (server-console.txt) after a test start: did it come up,
// did it die, and which errors came from which mod. Pure logic, used by
// scripts/verify-presets.mjs and its tests.

// the game prints this once the world is loaded and players can join
export const READY_LINE = /\*\*\* SERVER STARTED \*\*\*/

// the start failed for good: the world couldn't load (a broken mod script is the usual
// cause) or the server shut itself down
const FATAL_LINES = [
  /Server Terminated\./,
  /WorldDictionaryException/,
  /GameServer\.main>.*Exception thrown/,
]

// errors every modded server prints that don't mean anything is broken: the game looks for
// AnimSets / actiongroups folders in every mod and logs each one that isn't there, and some
// vehicle and character models carry bones the game doesn't use
const NOISE = [
  /visitFileFailed/,
  /NoSuchFileException: .*[\\/](AnimSets|actiongroups)\b/i,
  /Could not find bone index for node name/,
]

export interface LogMod {
  // how the mod shows up in the report
  label: string
  workshopId?: string
  // folder name inside a mods folder (local mods, and every mod inside a workshop item)
  folders?: string[]
  // mod ids and display names, as the game prints them in "MOD:<name>"
  ids?: string[]
  names?: string[]
}

export interface LogError { text: string; count: number }
export interface LogGroup { mod: string; errors: LogError[]; exceptions: number }

export interface LogReport {
  started: boolean
  // the line that says the start failed, null if it didn't
  fatal: string | null
  groups: LogGroup[]
  // errors that weren't in the vanilla run and had a script exception (Lua or Java) in them
  exceptions: number
  // lines skipped as noise, or because the same server without mods printed them too
  noise: number
  baseline: number
}

export const UNATTRIBUTED = '(no mod named in the line)'

// the same error from two runs reads the same: no frame / time counters, no trailing space
export function signature(line: string): string {
  return line.replace(/f:\d+\s+st:[\d,]+\s*/g, '').replace(/\s+$/g, '').replace(/^\s+/, '')
}

function isErrorLine(line: string): boolean {
  return /^ERROR:/.test(line) || /> ERROR:/.test(line) || /Exception thrown/.test(line)
}

// java exception text right under "Exception thrown" (the stack trace lines start with a tab too,
// but only the first one says what went wrong)
function exceptionDetail(lines: string[], i: number): string | undefined {
  const next = lines[i + 1]
  if (next && /^\s+\S/.test(next) && /(Exception|Error)\b/.test(next) && !/^\s+at\s/.test(next)) return next.trim()
  return undefined
}

export interface ScanOptions {
  mods: LogMod[]
  // signatures of the error lines the same server prints with no mods at all
  baseline?: Set<string>
  // which mod a game path like media/scripts/foo.txt belongs to, when the verifier knows
  ownerOfFile?: (relPath: string) => string | undefined
}

export function attribute(text: string, opts: ScanOptions): string {
  const { mods } = opts
  // Lua((MOD:They Knew [B42])).file.lua, or "| MOD: name" at the end of a stack line
  const named = (text.match(/MOD:\s*(.+?)\)\)/) || text.match(/MOD:\s*([^)|]+?)\s*(?:[)|]|$)/))?.[1]
  if (named) {
    const hit = mods.find(m => m.label === named || m.names?.includes(named) || m.ids?.includes(named))
    return hit ? hit.label : named
  }
  const workshopId = text.match(/[\\/]108600[\\/](\d+)[\\/]/)?.[1]
  if (workshopId) {
    const hit = mods.find(m => m.workshopId === workshopId)
    return hit ? hit.label : `Workshop item ${workshopId}`
  }
  const folder = text.match(/[\\/]mods[\\/]([^\\/]+)[\\/]/)?.[1]
  if (folder) {
    const hit = mods.find(m => m.folders?.some(f => f.toLowerCase() === folder.toLowerCase()))
    if (hit) return hit.label
  }
  const rel = text.match(/'(media\/[^']+)'/)?.[1]
  if (rel && opts.ownerOfFile) {
    const owner = opts.ownerOfFile(rel)
    if (owner) return owner
  }
  // a mod id or display name written out in the line (vehicle and item scripts often are)
  for (const m of mods) {
    if ([...(m.ids || []), ...(m.names || [])].some(n => n.length >= 4 && text.includes(n))) return m.label
  }
  return UNATTRIBUTED
}

export function scanServerLog(lines: string[], opts: ScanOptions): LogReport {
  let started = false
  let fatal: string | null = null
  let noise = 0
  let baselined = 0
  const groups = new Map<string, Map<string, LogError>>()
  const exceptionsBy = new Map<string, number>()
  let exceptions = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (READY_LINE.test(line)) started = true
    if (!fatal && FATAL_LINES.some(p => p.test(line))) fatal = signature(line)
    if (!isErrorLine(line)) continue
    const detail = /Exception thrown/.test(line) ? exceptionDetail(lines, i) : undefined
    const whole = detail ? `${signature(line)} ${detail}` : signature(line)
    if (NOISE.some(p => p.test(whole))) { noise++; continue }
    if (opts.baseline?.has(signature(line))) { baselined++; continue }
    // a Lua error names the mod a line or two above the "Exception thrown" line
    const context = [lines[i - 2], lines[i - 1]].filter(Boolean).map(signature).join(' ')
    let mod = attribute(whole, opts)
    if (mod === UNATTRIBUTED && /MOD:/.test(context)) mod = attribute(context, opts)
    const text = whole.length > 300 ? `${whole.slice(0, 297)}...` : whole
    if (!groups.has(mod)) groups.set(mod, new Map())
    const g = groups.get(mod)!
    const e = g.get(text)
    if (e) e.count++
    else g.set(text, { text, count: 1 })
    if (detail || /Exception thrown/.test(line)) {
      exceptions++
      exceptionsBy.set(mod, (exceptionsBy.get(mod) || 0) + 1)
    }
  }
  return {
    started: started && !fatal,
    fatal,
    groups: [...groups.entries()]
      .map(([mod, errs]) => ({ mod, errors: [...errs.values()].sort((a, b) => b.count - a.count), exceptions: exceptionsBy.get(mod) || 0 }))
      .sort((a, b) => b.exceptions - a.exceptions || b.errors.length - a.errors.length),
    exceptions,
    noise,
    baseline: baselined,
  }
}

// error lines worth remembering from a vanilla run, to tell game noise from mod errors later
export function baselineSignatures(lines: string[]): Set<string> {
  return new Set(lines.filter(isErrorLine).map(signature))
}

// A test start counts as fine when the server came up and no script threw an exception
// (Lua or Java) that the same server without mods doesn't throw. Other new error lines get
// reported, but don't fail it: missing vehicle part templates, odd model bones and the like
// are cosmetic
export function startPassed(r: LogReport): boolean {
  return r.started && !r.fatal && r.exceptions === 0
}

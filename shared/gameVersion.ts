// Game versions and Steam branches for the dedicated server. Pure logic, shared by the
// Electron side and the UI (and the tests).
//
// Steam keeps every version of the server on a "branch": public is the normal one, and The
// Indie Stone keeps older versions around as betas (legacy41 for Build 41, fall-backs like
// 42.21 when an update breaks things). An install remembers its branch, and SteamCMD keeps
// whatever branch it used last when -beta is left out (even for a brand new folder), so the
// app always says which one it wants.

import type { Build } from './modCore'

export interface SteamBranch {
  name: string
  buildId: string
  description?: string
  timeUpdated?: number
  // password-protected betas, nobody can get those with an anonymous login
  pwdRequired?: boolean
  // what a full download of this branch is (Windows), from the depots' manifests
  downloadBytes?: number
}

// Branch names end up on SteamCMD's command line and in file names
export function isBranchName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

export function isBuildId(id: unknown): id is string {
  return typeof id === 'string' && /^\d{1,12}$/.test(id)
}

// ── SteamCMD's app_info_print output ──────────────────────────────────────────

type Vdf = { [key: string]: string | Vdf }

// Valve's KeyValues text: "key" "value" or "key" { ... }. Everything else on the line
// (SteamCMD's own log lines) is skipped
export function parseVdf(text: string): Vdf {
  const tokens: Array<string | { brace: '{' | '}' }> = []
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[2]) tokens.push({ brace: m[2] as '{' | '}' })
    else tokens.push(m[1].replace(/\\(.)/g, '$1'))
  }
  let i = 0
  const block = (): Vdf => {
    const out: Vdf = {}
    while (i < tokens.length) {
      const key = tokens[i++]
      if (typeof key !== 'string') { if (key.brace === '}') return out; continue }
      const next = tokens[i]
      if (next === undefined) break
      if (typeof next === 'string') { out[key] = next; i++ }
      else if (next.brace === '{') { i++; out[key] = block() }
      else return out
    }
    return out
  }
  return block()
}

const sub = (v: string | Vdf | undefined): Vdf | undefined => (v && typeof v === 'object' ? v : undefined)

// The branches of one app, with build ids, descriptions and download sizes
export function parseBranches(appInfo: string, appId: string): SteamBranch[] {
  const start = appInfo.search(new RegExp(`"${appId}"\\s*\\{`))
  if (start === -1) return []
  const app = sub(parseVdf(appInfo.slice(start))[appId])
  const depots = sub(app?.depots)
  const branches = sub(depots?.branches)
  if (!depots || !branches) return []

  // the depots a Windows server downloads: no OS list, or windows in it. Redistributables
  // borrowed from other apps (depotfromapp) are shared by every branch
  const download: Record<string, number> = {}
  for (const [id, raw] of Object.entries(depots)) {
    const depot = sub(raw)
    if (!/^\d+$/.test(id) || !depot || depot.depotfromapp) continue
    const os = String(sub(depot.config)?.oslist || '')
    if (os && !os.split(',').includes('windows')) continue
    for (const [branch, m] of Object.entries(sub(depot.manifests) || {})) {
      const bytes = Number(sub(m)?.download)
      if (Number.isFinite(bytes)) download[branch] = (download[branch] || 0) + bytes
    }
  }

  const out: SteamBranch[] = []
  for (const [name, raw] of Object.entries(branches)) {
    const b = sub(raw)
    if (!b || !isBranchName(name) || !isBuildId(b.buildid)) continue
    out.push({
      name,
      buildId: b.buildid as string,
      description: typeof b.description === 'string' && b.description ? b.description : undefined,
      timeUpdated: Number(b.timeupdated) || undefined,
      pwdRequired: b.pwdrequired === '1' || undefined,
      downloadBytes: download[name] || undefined,
    })
  }
  return out
}

// The branches anyone can install (no password)
export function openBranches(branches: SteamBranch[]): SteamBranch[] {
  return branches.filter(b => !b.pwdRequired)
}

// ── Which branch an install goes on ───────────────────────────────────────────

export function defaultBranch(build?: Build | string): string {
  return build === 'b41' ? 'legacy41' : 'public'
}

// legacy41 (and anything named 41.x) is Build 41, everything else is Build 42
export function buildOfBranch(branch: string): Build {
  return /^(legacy41|41(\.|$))/i.test(branch) ? 'b41' : 'b42'
}

/**
 * The branch an install or update uses. What the user picked for this install wins (that's
 * how a switch happens), then the branch the install is already on (so an update never moves
 * a 42.21 install anywhere else), then the default for the build.
 */
export function branchFor(opts: { chosen?: string | null; installed?: string | null; build?: Build | string }): string {
  if (isBranchName(opts.chosen)) return opts.chosen
  if (isBranchName(opts.installed)) return opts.installed
  return defaultBranch(opts.build)
}

// Always an explicit -beta, public included: without it SteamCMD sticks with the last branch
export function branchArgs(branch: string): string[] {
  if (!isBranchName(branch)) throw new Error(`"${String(branch)}" isn't a Steam branch.`)
  return ['-beta', branch]
}

// ── Names people understand ───────────────────────────────────────────────────

// "42.21" + "temporary fall-back" -> "42.21 fall-back", public -> "Latest"
export function branchLabel(name: string, description?: string): string {
  if (name === 'public') return 'Latest'
  if (name === 'legacy41') return 'Build 41'
  if (/fall-?back/i.test(description || '')) return `${name} fall-back`
  if (name === 'pre-release') return 'Pre-release'
  return name
}

// The game version each server build is, and the world version it saves. Seeded with the
// ones we know, the rest gets learned from the server's own log and map_t.bin
export interface BuildFacts { version?: string; worldVersion?: number }

export const KNOWN_BUILDS: Record<string, BuildFacts> = {
  '26486687': { version: '42.22.2', worldVersion: 251 },
  '25485538': { version: '42.21.0', worldVersion: 249 },
  '24929695': { version: '42.19.2' },
  '24928750': { version: '41.78.21' },
}

// "Build 42.19.2" -> 42.19.2
function versionIn(text?: string): string | undefined {
  return text?.match(/\b(4\d\.\d+(?:\.\d+)?)\b/)?.[1]
}

/** The game version a build id is, if anything says so */
export function versionOf(buildId: string | null | undefined, opts: { learned?: Record<string, BuildFacts>; branches?: SteamBranch[] | null } = {}): string | undefined {
  if (!buildId) return undefined
  const known = opts.learned?.[buildId]?.version || KNOWN_BUILDS[buildId]?.version
  if (known) return known
  const same = (opts.branches || []).filter(b => b.buildId === buildId)
  for (const b of same) { const v = versionIn(b.description); if (v) return v }
  return same.map(b => b.name).find(n => /^\d+\.\d+/.test(n))
}

export function worldVersionOf(buildId: string | null | undefined, learned?: Record<string, BuildFacts>): number | undefined {
  if (!buildId) return undefined
  return learned?.[buildId]?.worldVersion ?? KNOWN_BUILDS[buildId]?.worldVersion
}

// "version=42.21.0 4a0e9546ec demo=false", the first lines of every server log
export function versionFromLog(text: string): string | undefined {
  return text.match(/>\s*version=(\d+\.\d+(?:\.\d+)?)\b/)?.[1]
}

// map_t.bin starts with "GMTM" and then the world version as a big-endian int
export function worldVersionFromMapT(head: Uint8Array): number | undefined {
  if (head.length < 8 || String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'GMTM') return undefined
  const v = ((head[4] << 24) | (head[5] << 16) | (head[6] << 8) | head[7]) >>> 0
  return v > 0 && v < 100000 ? v : undefined
}

// "42.21.0" -> "42.21", the way Steam's branch list and players say it
export function shortVersion(v?: string): string | undefined {
  return v?.replace(/^(\d+\.\d+)\.0$/, '$1')
}

// What players have to do in Steam to get the same version as a server on this branch
export function steamSwitchSteps(branch: string): string {
  return branch === 'public'
    ? 'In Steam: right-click Project Zomboid → Properties → Game Versions & Betas → pick "None" (the normal version).'
    : `In Steam: right-click Project Zomboid → Properties → Game Versions & Betas → pick ${branch}.`
}

// ── The player's own game ─────────────────────────────────────────────────────

export interface ClientGame {
  buildId?: string
  // the branch the installed files are from ('' in Steam's file = the normal version)
  branch: string
  // picked in Steam but not downloaded yet
  pendingBranch?: string
}

// Steam's appmanifest_108600.acf: "buildid", and "BetaKey" under MountedConfig (what's
// installed) and UserConfig (what the player picked in Properties)
export function parseAppManifest(acf: string): ClientGame {
  const key = (section: string) => acf.match(new RegExp(`"${section}"\\s*\\{[^}]*?"BetaKey"\\s+"([^"]*)"`, 'i'))?.[1]
  const buildId = acf.match(/"buildid"\s+"(\d+)"/i)?.[1]
  const mounted = key('MountedConfig')
  const picked = key('UserConfig')
  const branch = (mounted ?? picked ?? '') || 'public'
  const want = (picked ?? mounted ?? '') || 'public'
  return { buildId: isBuildId(buildId) ? buildId : undefined, branch, pendingBranch: want !== branch ? want : undefined }
}

export type PlayerVersionCheck =
  | { kind: 'ok' }
  // the pack doesn't say (older app) or the game wasn't found
  | { kind: 'unknown' }
  // Steam is already getting the right one
  | { kind: 'downloading'; branch: string }
  | { kind: 'switch'; branch: string; steps: string }

/** Is the player on the same game version (Steam branch) as the host's server? */
export function playerVersionCheck(host: { branch?: string } | undefined, player: ClientGame | null): PlayerVersionCheck {
  if (!host?.branch || !player) return { kind: 'unknown' }
  if (player.branch === host.branch && (!player.pendingBranch || player.pendingBranch === host.branch)) return { kind: 'ok' }
  if (player.pendingBranch === host.branch) return { kind: 'downloading', branch: host.branch }
  return { kind: 'switch', branch: host.branch, steps: steamSwitchSteps(host.branch) }
}

// ── Has the server fallen behind? ─────────────────────────────────────────────

export interface ServerVersionState {
  branch: string
  installed: string | null
  // newest build on the install's own branch, null = couldn't ask Steam
  latest: string | null
  publicBuild: string | null
  branchMissing: boolean
  updateAvailable: boolean
  // on a fall-back or other beta while public has moved on: players on the normal game can't join
  behindPublic: boolean
}

export function serverVersionState(installed: { buildId: string | null; branch: string }, branches: SteamBranch[] | null): ServerVersionState {
  const branch = installed.branch || 'public'
  const own = branches?.find(b => b.name === branch)
  const pub = branches?.find(b => b.name === 'public')
  const latest = own?.buildId || null
  return {
    branch,
    installed: installed.buildId,
    latest,
    publicBuild: pub?.buildId || null,
    branchMissing: !!branches && branches.length > 0 && !own,
    updateAvailable: !!latest && !!installed.buildId && latest !== installed.buildId,
    // Build 41 players are on legacy41 too, that's not falling behind
    behindPublic: !!pub && !!installed.buildId && branch !== 'public' && buildOfBranch(branch) === 'b42' && pub.buildId !== installed.buildId,
  }
}

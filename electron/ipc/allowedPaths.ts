// Where the window's generic file and folder handlers (fs:readFile, fs:writeFile,
// shell:openPath, the world and config writers) are allowed to go. The window only ever needs
// the app's own folders, so a bug that let a web page script into it still couldn't read or
// replace anything else on the PC, or start a program.

import { win32 } from 'path'
import { existsSync, realpathSync, statSync } from 'fs'

// %USERPROFILE%, %APPDATA% and the like
export function expandEnvVars(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return p.replace(/%([^%]+)%/g, (_, name) => env[name] || `%${name}%`)
}

// A full, tidied-up Windows path, or null for anything that isn't a plain local path:
// relative paths, \\server\share (just looking at one sends the PC's login to that server),
// \\?\ device paths, and paths with characters Windows doesn't allow
export function localPath(p: unknown, env?: NodeJS.ProcessEnv): string | null {
  if (typeof p !== 'string' || !p || p.length > 1024) return null
  const expanded = expandEnvVars(p, env)
  if (/[\0<>"|?*]/.test(expanded) || /%[^%]+%/.test(expanded)) return null
  if (!/^[A-Za-z]:[\\/]/.test(expanded)) return null
  // C:\a\b.txt:stream would be the file's hidden data, not the file
  if (expanded.indexOf(':', 2) !== -1) return null
  return win32.resolve(expanded)
}

export function isInside(child: string, root: string): boolean {
  const c = win32.resolve(child).toLowerCase()
  const r = win32.resolve(root).toLowerCase().replace(/\\+$/, '')
  return c === r || c.startsWith(`${r}\\`)
}

// The real place a path ends up after links and junctions, for a file that might not be
// there yet too (the nearest folder that is gets followed)
export function realPath(p: string): string {
  let existing = p
  const rest: string[] = []
  while (!existsSync(existing)) {
    const up = win32.dirname(existing)
    if (up === existing) return p
    rest.unshift(win32.basename(existing))
    existing = up
  }
  return win32.join(realpathSync.native(existing), ...rest)
}

// Inside one of the roots, as written and after following links (a junction inside the
// Server folder pointing at C:\Windows doesn't count as inside)
export function insideRoots(p: string, roots: string[]): boolean {
  const ok = roots.filter(r => isInside(p, r))
  if (ok.length === 0) return false
  const real = realPath(p)
  return ok.some(r => isInside(real, realPath(r)))
}

// The settings files the editors open: <name>.ini, <name>_SandboxVars.lua and the like
export const CONFIG_FILE_TYPES = ['.ini', '.lua', '.txt']

/**
 * Can the window read or write this file? Yes for the config file types inside one of the
 * roots (every server's Zomboid\Server folder), and for files the user picked themselves in
 * an Open or Save dialog. Returns the path to use, or null.
 */
export function allowedFile(p: unknown, roots: string[], picked: Set<string>): string | null {
  const path = localPath(p)
  if (!path) return null
  if (picked.has(path.toLowerCase())) return path
  if (!CONFIG_FILE_TYPES.includes(win32.extname(path).toLowerCase())) return null
  return insideRoots(path, roots) ? path : null
}

// Can the window open this in Explorer? Only folders (never a program or a document that
// would start one), and only the app's own
export function allowedFolder(p: unknown, roots: string[]): string | null {
  const path = localPath(p)
  if (!path || !insideRoots(path, roots)) return null
  try { return statSync(path).isDirectory() ? path : null } catch { return null }
}

// The folder name the game gives a server (getServerName): letters, digits, _ and -
export function isServerName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(name)
}

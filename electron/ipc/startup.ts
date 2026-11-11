// Starting with Windows, and a second launch of the app while it's already open.
// No Electron in here, so the tests can check it.

import { win32 } from 'path'

// what Windows passes when it starts the app at login
export const STARTUP_ARG = '--started-with-windows'

// What a second launch wants from the copy that's already open. Windows starting it at login
// while it's already open (it was started by hand first) shouldn't pop it up
export function secondLaunch(argv: string[]): 'show' | 'ignore' {
  return argv.includes(STARTUP_ARG) ? 'ignore' : 'show'
}

// ── Start with Windows ───────────────────────────────────────────────────────
// A value in HKCU\...\Run. It's what Task Manager's Startup tab and Windows Settings show,
// so it gets the app's name. Versions up to 1.6.0 left the name to Electron, which used the
// app's internal id: "electron.app.Knox Launcher"

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const RUN_VALUE = 'Knox Launcher'
export const OLD_RUN_VALUES = ['electron.app.Knox Launcher']

export interface RunValue { name: string; command: string }

// `reg query <key>` output: "    <name>    REG_SZ    <data>" per value
export function parseRunKey(output: string): RunValue[] {
  const out: RunValue[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^ {4}(.+?) {4}REG_(?:EXPAND_)?SZ {4}(.*)$/)
    if (m) out.push({ name: m[1], command: m[2].trim() })
  }
  return out
}

// The program a Run command starts: "C:\x\Knox Launcher.exe" --started-with-windows -> C:\x\Knox Launcher.exe
export function commandExe(command: string): string {
  const t = command.trim()
  if (t.startsWith('"')) return t.slice(1, t.indexOf('"', 1) === -1 ? undefined : t.indexOf('"', 1))
  return t.split(/\s+/)[0] || ''
}

const samePath = (a: string, b: string) => win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
const inside = (p: string, dir: string) => !!dir && win32.normalize(p).toLowerCase().startsWith(win32.normalize(dir).toLowerCase().replace(/\\?$/, '\\'))

/**
 * What's there now, for this copy of the app (exe = the running exe):
 *  on:      it starts this exe with Windows
 *  migrate: an old-style value starts this copy (this exe, or the exe it had before it was
 *           renamed, in the same folder) or an exe that's gone: write it again under the new name
 *  remove:  old-style values to delete once that's done
 */
export function runKeyPlan(values: RunValue[], exe: string, exists: (p: string) => boolean): { on: boolean; migrate: boolean; remove: string[] } {
  const on = values.some(v => v.name === RUN_VALUE && samePath(commandExe(v.command), exe))
  const ours = values.filter(v => OLD_RUN_VALUES.includes(v.name)).filter(v => {
    const target = commandExe(v.command)
    return samePath(win32.dirname(target), win32.dirname(exe)) || !exists(target)
  })
  return { on: on || ours.length > 0, migrate: ours.length > 0, remove: ours.map(v => v.name) }
}

// Run from inside a zip in Explorer (it unpacks to a temp folder) or some other temp folder:
// next login that folder is gone. Turned down with this message instead of registering it
export function startupProblem(exe: string, tempDirs: string[]): string | null {
  if (tempDirs.some(d => inside(exe, d))) {
    return "Knox Launcher is running from a temporary folder (Windows does that when you open it straight from the zip), so it can't start from there with Windows. Unzip it into a folder of its own, start it from there, then turn this on."
  }
  return null
}

export function runCommand(exe: string): string {
  return `"${exe}" ${STARTUP_ARG}`
}

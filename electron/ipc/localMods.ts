import { ipcMain, app } from 'electron'
import { join, basename } from 'path'
import { existsSync, cpSync, mkdirSync, readFileSync } from 'fs'
import { resolveDataPath } from './serverManager'
import { listDirs, parseModInfo } from './modManager'
import { installedBuild } from './steamcmd'

// ---------------------------------------------------------------------------
// Small fix mods that ship with the app (repo folder local-mods/, packaged as an
// extra resource). They aren't on the workshop, so whoever hosts a server that uses
// them needs them in <Zomboid>\mods. Friends install them with local-mods/install.ps1.
// ---------------------------------------------------------------------------
function bundledDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'local-mods') : join(app.getAppPath(), 'local-mods')
}

// B42 layout: local-mods/<Folder>/42/mod.info
function listBundled(): Array<{ folder: string; id: string; name: string }> {
  const out: Array<{ folder: string; id: string; name: string }> = []
  for (const folder of listDirs(bundledDir())) {
    const infoPath = join(bundledDir(), folder, '42', 'mod.info')
    if (!existsSync(infoPath)) continue
    const info = parseModInfo(readFileSync(infoPath, 'utf-8'))
    if (info.id) out.push({ folder, id: info.id, name: info.name || info.id })
  }
  return out
}

export function installLocalMods(modIds: string[], worldSavePath?: string): { installed: string[]; missing: string[] } {
  const bundled = listBundled()
  const target = join(resolveDataPath(worldSavePath), 'mods')
  mkdirSync(target, { recursive: true })
  const installed: string[] = []
  const missing: string[] = []
  for (const id of modIds) {
    const mod = bundled.find(b => b.id === id)
    if (!mod) { missing.push(id); continue }
    // ours, so overwriting an older copy is the point
    cpSync(join(bundledDir(), mod.folder), join(target, mod.folder), {
      recursive: true,
      force: true,
      filter: src => basename(src) !== '.gitkeep',
    })
    // B42 mods have a common/ folder; packaging drops it when it's empty
    mkdirSync(join(target, mod.folder, 'common'), { recursive: true })
    installed.push(id)
  }
  return { installed, missing }
}

export function setupLocalModHandlers() {
  // which game build a server install has (its Steam build id), so the ready-made modded
  // servers can say when the server isn't the version they were tested on. Only reads the
  // install's appmanifest, no SteamCMD
  ipcMain.handle('presets:serverBuild', async (_event, installDir: string) => {
    try {
      return { success: true, ...(typeof installDir === 'string' && installDir ? installedBuild(installDir) : { buildId: null, branch: 'public' }) }
    } catch (e) {
      return { success: false, buildId: null, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('localMods:install', async (_event, modIds: string[], worldSavePath?: string) => {
    try {
      return { success: true, ...installLocalMods(modIds, worldSavePath) }
    } catch (e) {
      return { success: false, installed: [], missing: modIds, message: e instanceof Error ? e.message : String(e) }
    }
  })
}

import { readdirSync, statSync, type Dirent } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { parseModInfo, type ModInfo, type Build } from '../../shared/modCore'

// Reading downloaded workshop items and local mod folders. Node only, nothing from
// Electron, so scripts (scripts/verify-presets.mjs) read mods exactly the way the app does.

export const PZ_APP_ID = '108600'

export function workshopContentDir(serverInstallPath: string): string {
  return join(serverInstallPath, 'steamapps', 'workshop', 'content', PZ_APP_ID)
}

// Readdir's file types save a stat per entry, which adds up across 50 mods. Links (people
// do link mod folders) still get a real stat, so they count as folders like before
function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

export function listDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter(d => d.isDirectory() || (d.isSymbolicLink() && isDir(join(p, d.name))))
      .map(d => d.name)
  } catch { return [] }
}

async function listDirsAsync(p: string): Promise<string[]> {
  let entries: Dirent[]
  try { entries = await readdir(p, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const d of entries) {
    if (d.isDirectory()) out.push(d.name)
    else if (d.isSymbolicLink()) {
      try { if ((await stat(join(p, d.name))).isDirectory()) out.push(d.name) } catch { /* broken link */ }
    }
  }
  return out
}

// Which mod.info the game reads: the newest version folder (42.16 over 42.13, and 42.10
// over 42.9, ids can change between them), then common/, then the B41 one at the top
function infoRankFor(root: string): number[] {
  const name = root.split(/[\\/]/).pop() || ''
  if (/^42(\.\d+)*$/.test(name)) return [2, ...name.split('.').map(Number)]
  return name === 'common' ? [1] : [0]
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

// B41 keeps mod.info at mods/<Mod>/mod.info, B42 at mods/<Mod>/42/mod.info (or 42.x),
// with shared stuff in mods/<Mod>/common. Maps live under media/maps/<MapFolder> in any of those.
export async function scanWorkshopItem(itemDir: string): Promise<ModInfo[]> {
  const found = new Map<string, ModInfo>()
  for (const { info } of await scanModFolders(join(itemDir, 'mods'))) if (!found.has(info.id)) found.set(info.id, info)
  return [...found.values()]
}

// Every mod folder in a mods directory with what its mod.info says (the folder name
// matters for local mods, it's where they get copied to). Reads without blocking the rest
// of the app (on a cold disk right after boot this took over half a second), every mod at once
export async function scanModFolders(modsDir: string): Promise<Array<{ folder: string; info: ModInfo }>> {
  const mods = await listDirsAsync(modsDir)
  const scanned = await Promise.all(mods.map(mod => scanModFolder(join(modsDir, mod))))
  const found: Array<{ folder: string; info: ModInfo }> = []
  mods.forEach((folder, i) => { const info = scanned[i]; if (info) found.push({ folder, info }) })
  return found
}

async function scanModFolder(modDir: string): Promise<ModInfo | null> {
  const subs = await listDirsAsync(modDir)
  const roots = [modDir, ...subs.map(sub => join(modDir, sub))]
  // every folder's mod.info and maps at once, then gone through in the usual order so the
  // same mod.info wins as always
  const perRoot = await Promise.all(roots.map(async root => ({
    root,
    text: await readFile(join(root, 'mod.info'), 'utf-8').catch(() => null),
    maps: await listDirsAsync(join(root, 'media', 'maps')),
  })))

  let info: ModInfo | null = null
  let infoRank: number[] = []
  const maps = new Set<string>()
  const builds = new Set<Build>()
  // B42 mods can keep mod.info in common/ and have 42.x folders with only media in them
  if (subs.some(sub => /^42/.test(sub))) builds.add('b42')
  for (const { root, text, maps: rootMaps } of perRoot) {
    const rank = infoRankFor(root)
    if (text !== null) {
      const parsed = parseModInfo(text)
      if (parsed.id) {
        builds.add(rank[0] > 0 ? 'b42' : 'b41')
        if (compareRank(rank, infoRank) > 0) {
          infoRank = rank
          info = {
            id: parsed.id, name: parsed.name || parsed.id, requires: parsed.requires, maps: [],
            loadAfter: parsed.loadAfter, loadBefore: parsed.loadBefore, incompatible: parsed.incompatible,
          }
        }
      }
    }
    for (const m of rootMaps) maps.add(m)
  }
  if (!info) return null
  info.maps = [...maps]
  info.builds = [...builds].sort()
  return info
}

// Where each server keeps its world, settings, player database and log. No Node or
// browser APIs in here, so the tests can check it without Electron.
//
// The game keeps all of that in one data folder (%USERPROFILE%\Zomboid unless it's started
// with -cachedir). Servers sharing one folder share one server-console.txt, one db folder and
// one set of the game's own backups, so two of them running at once get each other's log,
// ready message and backup rotation. New servers get a folder of their own next to the
// usual one: Zomboid\Knox servers\<server name>. That keeps everything in the Zomboid folder
// people already know (and back up), out of the game's own Saves and Server folders, and
// named after the server's fixed name, so renaming a server doesn't move anything.

export const DEFAULT_DATA_FOLDER = '%USERPROFILE%\\Zomboid'

export function ownDataFolder(serverName: string): string {
  return `${DEFAULT_DATA_FOLDER}\\Knox servers\\${serverName}`
}

// %USERPROFILE%\Zomboid -> C:\Users\Me\Zomboid. Empty = the game's usual folder
export function expandDataPath(worldSavePath: string | undefined, env: Record<string, string | undefined>): string {
  const raw = (worldSavePath || '').trim() || DEFAULT_DATA_FOLDER
  return raw
    .replace(/%USERPROFILE%/gi, env.USERPROFILE || env.HOME || '')
    .replace(/[\\/]+$/, '')
}

export function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

// The other servers that use the same data folder as this one
export function sharingWith<T extends { id: string; worldSavePath?: string }>(
  profile: T, all: T[], env: Record<string, string | undefined>,
): T[] {
  const mine = expandDataPath(profile.worldSavePath, env)
  return all.filter(p => p.id !== profile.id && sameFolder(expandDataPath(p.worldSavePath, env), mine))
}

// What "give this server its own folder" copies for a server (paths inside the data folder).
// Only its own files: the folder is shared, everything else in it belongs to other servers
// (or to the game, when you play on this PC). mods\ is every local mod, servers need theirs
export function serverFiles(serverName: string): string[] {
  // not "<name>_*": the copy of a server called Base is Base_copy, and its files start with Base_ too
  const own = ['.ini', '_SandboxVars.lua', '_spawnpoints.lua', '_spawnregions.lua'].map(end => `${serverName}${end}`)
  return [
    ...own.map(n => `Server\\${n}`),
    `Saves\\Multiplayer\\${serverName}`,
    `db\\${serverName}.db`,
    `pzm-backups\\${serverName}`,
    'mods',
  ]
}

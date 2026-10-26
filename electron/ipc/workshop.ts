import { ipcMain, app, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs'
import { getProfile, patchProfile } from './profileManager'
import { scanModFolders, fetchModDetails } from './modManager'
import { resolveDataPath } from './serverManager'
import { loadSettings } from './appSettings'
import { enabledIds } from '../../shared/modCore'
import { buildWorkshopTxt, readWorkshopId, cantUploadReason } from '../../shared/workshopItem'

// ---------------------------------------------------------------------------
// Fix mods on the Workshop: a local fix mod only reaches players if they copy it
// in by hand. Uploaded to the Workshop instead (unlisted), the game downloads it
// for them when they join, like any other mod. Steam only takes uploads through
// the game, so the app gets the folder ready and the host clicks Upload in-game.
// ---------------------------------------------------------------------------

// The host's own game folder, where the game's uploader looks (Zomboid\Workshop)
function workshopRoot(): string {
  return join(resolveDataPath(loadSettings().clientDataDir), 'Workshop')
}

function readWorkshopTitle(txtPath: string): string | null {
  try { return readFileSync(txtPath, 'utf-8').match(/^\s*title\s*=\s*(.+?)\s*$/m)?.[1] || null } catch { return null }
}

function findLocalMod(profileId: string, modId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('That server profile no longer exists.')
  const entry = profile.mods.find(m => !m.workshopId && enabledIds(m).includes(modId))
  if (!entry) throw new Error(`"${modId}" isn't a local mod on this server.`)
  const modsDir = join(resolveDataPath(profile.worldSavePath), 'mods')
  const hit = scanModFolders(modsDir).find(f => f.info.id === modId)
  if (!hit) throw new Error(`The files for "${entry.name}" aren't in ${modsDir}.`)
  return { profile, entry, folder: hit.folder, info: hit.info, modDir: join(modsDir, hit.folder) }
}

// Lay out Zomboid\Workshop\<folder> the way the game's uploader wants it. Running it
// again refreshes the mod files but leaves workshop.txt alone, so the Workshop id and
// any edits made to the title or description stay
export function prepareUpload(profileId: string, modId: string) {
  const reason = cantUploadReason(modId)
  if (reason) throw new Error(reason)
  const { profile, entry, folder, info, modDir } = findLocalMod(profileId, modId)
  const itemDir = join(workshopRoot(), folder)
  const contents = join(itemDir, 'Contents', 'mods', folder)
  rmSync(contents, { recursive: true, force: true })
  mkdirSync(contents, { recursive: true })
  cpSync(modDir, contents, { recursive: true })
  mkdirSync(join(contents, 'common'), { recursive: true })

  const preview = join(itemDir, 'preview.png')
  if (!existsSync(preview)) writeFileSync(preview, readFileSync(join(app.getAppPath(), 'build', 'icon.png')))

  const txtPath = join(itemDir, 'workshop.txt')
  if (!existsSync(txtPath)) {
    // credit and link whatever it builds on, so players find the originals
    const needs = info.requires.map(dep => {
      const owner = profile.mods.find(m => m.workshopId && enabledIds(m).includes(dep))
      return { id: dep, name: owner?.name || dep, workshopId: owner?.workshopId }
    })
    const modInfoText = (() => {
      for (const p of [join(modDir, '42', 'mod.info'), join(modDir, 'common', 'mod.info'), join(modDir, 'mod.info')]) {
        if (existsSync(p)) return readFileSync(p, 'utf-8')
      }
      return ''
    })()
    const description = modInfoText.match(/^\s*description\s*=\s*(.+?)\s*$/im)?.[1] || ''
    writeFileSync(txtPath, buildWorkshopTxt({ title: info.name || entry.name, description, needs }), 'utf-8')
  }
  return { itemDir, folder, title: info.name || entry.name, workshopId: readWorkshopId(readFileSync(txtPath, 'utf-8')) }
}

// After the upload the game writes id=<number> into workshop.txt
export function uploadStatus(profileId: string, modId: string) {
  const { folder } = findLocalMod(profileId, modId)
  const txtPath = join(workshopRoot(), folder, 'workshop.txt')
  if (!existsSync(txtPath)) return { prepared: false, workshopId: null }
  return { prepared: true, workshopId: readWorkshopId(readFileSync(txtPath, 'utf-8')), itemDir: join(workshopRoot(), folder) }
}

// Put the Workshop item in place of the local copy in the server's mod list.
// Same mod id, so load order and requirements don't change
export async function useWorkshopCopy(profileId: string, modId: string, workshopId: string) {
  const { profile, entry, folder } = findLocalMod(profileId, modId)
  // the game writes an id even when the upload fails (it tried to update an item that
  // isn't yours), so don't trust it blindly
  const reason = cantUploadReason(modId)
  if (reason) throw new Error(reason)
  const taken = profile.mods.find(m => m.workshopId === workshopId)
  if (taken) {
    throw new Error(`Workshop item ${workshopId} is "${taken.name}", which is already in your list, so the upload didn't make a new item. Check the game's upload screen said it worked.`)
  }
  let details: Awaited<ReturnType<typeof fetchModDetails>>[number] | undefined
  try { details = (await fetchModDetails([workshopId]))[0] } catch { /* offline, keep what we have */ }
  // unlisted items don't show up in this lookup at all, so a hit with another name means
  // the id belongs to someone else's item
  const title = readWorkshopTitle(join(workshopRoot(), folder, 'workshop.txt'))
  if (details && title && details.name.trim() !== title.trim()) {
    throw new Error(`Workshop item ${workshopId} is "${details.name}", not your upload. The upload probably failed, check the game's upload screen.`)
  }
  patchProfile(profileId, {
    mods: getProfile(profileId)!.mods.map(m => (!m.workshopId && m.modId === entry.modId) ? {
      ...m,
      workshopId,
      name: details?.name || m.name.replace(/\s*\(local\)\s*$/i, ''),
      thumbnailUrl: details?.thumbnailUrl || m.thumbnailUrl,
      fileSize: details?.fileSize || m.fileSize,
      // read again from the downloaded copy
      infos: undefined,
    } : m),
  })
  // the public API not knowing it usually means it's hidden or friends-only
  return { visibleToSteamApi: !!details }
}

export function setupWorkshopHandlers() {
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) => async (_e: unknown, ...args: A) => {
    try { return { success: true, ...(await fn(...args)) } } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
  ipcMain.handle('workshop:prepare', wrap((profileId: string, modId: string) => prepareUpload(profileId, modId)))
  ipcMain.handle('workshop:status', wrap((profileId: string, modId: string) => uploadStatus(profileId, modId)))
  ipcMain.handle('workshop:useWorkshopCopy', wrap((profileId: string, modId: string, workshopId: string) => useWorkshopCopy(profileId, modId, workshopId)))
  ipcMain.handle('workshop:openFolder', wrap(async (dir: string) => {
    if (!dir.startsWith(workshopRoot())) throw new Error('Not a Workshop folder.')
    await shell.openPath(dir)
    return {}
  }))
}

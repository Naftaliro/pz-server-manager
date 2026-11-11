import { ipcMain } from 'electron'
import https from 'https'
import { existsSync } from 'fs'
import { join } from 'path'
import { parseModInfo, resolvePack, isWorkshopId, type ModInfo } from '../../shared/modCore'
import { loadSettings } from './appSettings'
import { steamImageUrl } from '../../shared/workshopItem'
import { workshopContentDir, listDirs, scanWorkshopItem, scanModFolders, PZ_APP_ID } from './modScan'

export { parseModInfo }
export type { ModInfo }

export interface WorkshopDetails {
  workshopId: string
  name: string
  description: string
  thumbnailUrl: string
  subscriptions: number
  tags: string[]
  timeUpdated: number
  fileSize: number
}

// The old workshop search scraped steamcommunity.com HTML, which broke when Steam
// moved the browse page to JS rendering and gets rate limited fast. Browsing now
// happens in a real webview (see WorkshopBrowser.tsx), these keyless endpoints
// are only used to get details about ids we already know.

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0',
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) reject(new Error(`Steam returned ${res.statusCode}`))
        else resolve(data)
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Steam took too long to answer')))
    req.write(body)
    req.end()
  })
}

export async function fetchModDetails(allIds: string[]): Promise<WorkshopDetails[]> {
  const out: WorkshopDetails[] = []
  // they go into the request body as they are
  const ids = (Array.isArray(allIds) ? allIds : []).filter(isWorkshopId)
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const params = [`itemcount=${batch.length}`, ...batch.map((id, n) => `publishedfileids[${n}]=${id}`)].join('&')
    const raw = await httpsPost('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', params)
    const details: Array<Record<string, unknown>> = JSON.parse(raw)?.response?.publishedfiledetails || []
    for (const item of details) {
      if (item.result !== 1 || !isWorkshopId(String(item.publishedfileid))) continue
      out.push({
        workshopId: String(item.publishedfileid),
        name: String(item.title || 'Unknown Mod'),
        description: cleanDescription(String(item.description || '')).substring(0, 300),
        thumbnailUrl: steamImageUrl(item.preview_url) || '',
        subscriptions: Number(item.subscriptions || 0),
        tags: Array.isArray(item.tags) ? (item.tags as Array<{ tag: string }>).map(t => t.tag) : [],
        timeUpdated: Number(item.time_updated || 0),
        fileSize: Number(item.file_size || 0),
      })
    }
  }
  return out
}

// Returns the children if this is a collection, otherwise null.
// filetype 2 on a child means it's a collection itself
async function fetchCollection(id: string): Promise<Array<{ id: string; collection: boolean }> | null> {
  if (!isWorkshopId(id)) return null
  const raw = await httpsPost(
    'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
    `collectioncount=1&publishedfileids[0]=${id}`
  )
  const entry = JSON.parse(raw)?.response?.collectiondetails?.[0]
  if (!entry || entry.result !== 1 || !Array.isArray(entry.children)) return null
  return (entry.children as Array<{ publishedfileid: string; filetype?: number }>)
    .map(c => ({ id: String(c.publishedfileid), collection: Number(c.filetype) === 2 }))
    .filter(c => isWorkshopId(c.id))
}

async function fetchCollectionChildren(id: string): Promise<string[] | null> {
  return (await fetchCollection(id))?.map(c => c.id) || null
}

// Required items only come from the keyed Web API (IPublishedFileService), so this needs
// the user's own free Steam Web API key. null per id = couldn't tell
export async function fetchRequiredItems(ids: string[], apiKey: string): Promise<Record<string, string[] | null>> {
  const out: Record<string, string[] | null> = {}
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const params = new URLSearchParams({ key: apiKey, includechildren: 'true' })
    batch.forEach((id, n) => params.set(`publishedfileids[${n}]`, id))
    try {
      const raw = await httpsGetText(`https://api.steampowered.com/IPublishedFileService/GetDetails/v1/?${params}`)
      const details: Array<Record<string, unknown>> = JSON.parse(raw)?.response?.publishedfiledetails || []
      const byId = new Map(details.map(d => [String(d.publishedfileid), d]))
      for (const id of batch) {
        const d = byId.get(id)
        if (!d || Number(d.result) !== 1) { out[id] = null; continue }
        const children = Array.isArray(d.children) ? (d.children as Array<{ publishedfileid: string }>) : []
        out[id] = children.map(c => String(c.publishedfileid)).filter(isWorkshopId)
      }
    } catch {
      batch.forEach(id => { out[id] = null })
    }
  }
  return out
}

function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('Steam turned down the API key. Check it in App Settings.'))
        else if (res.statusCode && res.statusCode >= 400) reject(new Error(`Steam returned ${res.statusCode}`))
        else resolve(data)
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Steam took too long to answer')))
  })
}

// Collection links (or plain mod links) -> every mod to download, with nested
// collections expanded, plus required items when there's an API key to ask with
export async function resolveModPack(ids: string[], withDeps: boolean) {
  // children say whether they're collections, so normal items don't cost an API call
  const knownItems = new Set<string>()
  const apiKey = loadSettings().steamApiKey?.trim()
  const pack = await resolvePack((Array.isArray(ids) ? ids : []).filter(isWorkshopId), {
    collectionChildren: async (id) => {
      if (knownItems.has(id)) return null
      const children = await fetchCollection(id)
      children?.forEach(c => { if (!c.collection) knownItems.add(c.id) })
      return children ? children.map(c => c.id) : null
    },
    requiredItems: batch => fetchRequiredItems(batch, apiKey!),
  }, { deps: withDeps && !!apiKey })
  return { ...pack, depsChecked: withDeps && !!apiKey, details: await fetchModDetails(pack.mods) }
}

function cleanDescription(text: string): string {
  return text
    .replace(/\[img\][^[]*\[\/img\]/gi, '')
    .replace(/\[table\].*?\[\/table\]/gis, '')
    .replace(/\[\*\]/gi, '• ')
    .replace(/\[\/?\w+[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Reading downloaded items lives in modScan.ts (no Electron in there, so scripts can use it)
export { workshopContentDir, listDirs, scanWorkshopItem, scanModFolders, PZ_APP_ID }

export function setupModHandlers() {
  // Details for workshop ids. If one of them is a collection we hand back its children too.
  ipcMain.handle('mods:getDetails', async (_event, workshopIds: string[]) => {
    try {
      if (!workshopIds?.length) return { success: true, mods: [] }
      return { success: true, mods: await fetchModDetails(workshopIds) }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), mods: [] }
    }
  })

  ipcMain.handle('mods:getCollection', async (_event, workshopId: string) => {
    try {
      const children = await fetchCollectionChildren(workshopId)
      if (!children) return { success: true, isCollection: false, mods: [] }
      return { success: true, isCollection: true, mods: await fetchModDetails(children) }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), isCollection: false, mods: [] }
    }
  })

  // A modpack link -> everything it needs
  ipcMain.handle('mods:resolvePack', async (_event, ids: string[], withDeps: boolean) => {
    try {
      const pack = await resolveModPack(ids, withDeps !== false)
      return { success: true, ...pack }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), mods: [], addedDeps: {}, collections: [], unchecked: [], depsChecked: false, details: [] }
    }
  })

  // Read mod ids, requirements and maps out of whatever is already downloaded
  ipcMain.handle('mods:scanInstalled', async (_event, serverInstallPath: string, workshopIds: string[]) => {
    try {
      const contentDir = workshopContentDir(serverInstallPath)
      const found: Record<string, ModInfo[]> = {}
      // each id is a folder name under the workshop folder, so numbers only (no ..\)
      await Promise.all((Array.isArray(workshopIds) ? workshopIds : []).filter(isWorkshopId).map(async (id) => {
        const itemDir = join(contentDir, id)
        if (existsSync(itemDir)) found[id] = await scanWorkshopItem(itemDir)
      }))
      return { success: true, found }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), found: {} }
    }
  })
}

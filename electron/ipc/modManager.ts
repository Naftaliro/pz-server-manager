import { ipcMain } from 'electron'
import https from 'https'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

export const PZ_APP_ID = '108600'

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

// What we find inside a downloaded workshop item (one per mod.info id)
export interface ModInfo {
  id: string
  name: string
  requires: string[]
  maps: string[]
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

export async function fetchModDetails(ids: string[]): Promise<WorkshopDetails[]> {
  const out: WorkshopDetails[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const params = [`itemcount=${batch.length}`, ...batch.map((id, n) => `publishedfileids[${n}]=${id}`)].join('&')
    const raw = await httpsPost('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', params)
    const details: Array<Record<string, unknown>> = JSON.parse(raw)?.response?.publishedfiledetails || []
    for (const item of details) {
      if (item.result !== 1) continue
      out.push({
        workshopId: String(item.publishedfileid),
        name: String(item.title || 'Unknown Mod'),
        description: cleanDescription(String(item.description || '')).substring(0, 300),
        thumbnailUrl: String(item.preview_url || ''),
        subscriptions: Number(item.subscriptions || 0),
        tags: Array.isArray(item.tags) ? (item.tags as Array<{ tag: string }>).map(t => t.tag) : [],
        timeUpdated: Number(item.time_updated || 0),
        fileSize: Number(item.file_size || 0),
      })
    }
  }
  return out
}

// Returns the child workshop ids if this is a collection, otherwise null
async function fetchCollectionChildren(id: string): Promise<string[] | null> {
  const raw = await httpsPost(
    'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
    `collectioncount=1&publishedfileids[0]=${id}`
  )
  const entry = JSON.parse(raw)?.response?.collectiondetails?.[0]
  if (!entry || entry.result !== 1 || !Array.isArray(entry.children)) return null
  return (entry.children as Array<{ publishedfileid: string }>).map(c => String(c.publishedfileid))
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

// ── Reading downloaded workshop items ─────────────────────────────────────────

export function workshopContentDir(serverInstallPath: string): string {
  return join(serverInstallPath, 'steamapps', 'workshop', 'content', PZ_APP_ID)
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

function listDirs(p: string): string[] {
  try { return readdirSync(p).filter(n => isDir(join(p, n))) } catch { return [] }
}

function parseModInfo(text: string): { id?: string; name?: string; requires: string[] } {
  const get = (key: string) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'im'))?.[1]
  const require = get('require')
  return {
    id: get('id')?.replace(/^\\+/, ''),
    name: get('name'),
    requires: require
      ? require.split(/[,;]/).map(s => s.trim().replace(/^\\+/, '')).filter(Boolean)
      : [],
  }
}

// B41 keeps mod.info at mods/<Mod>/mod.info, B42 at mods/<Mod>/42/mod.info (or 42.x),
// with shared stuff in mods/<Mod>/common. Maps live under media/maps/<MapFolder> in any of those.
export function scanWorkshopItem(itemDir: string): ModInfo[] {
  const found = new Map<string, ModInfo>()
  const modsDir = join(itemDir, 'mods')

  for (const mod of listDirs(modsDir)) {
    const modDir = join(modsDir, mod)
    const roots = [modDir, ...listDirs(modDir).map(sub => join(modDir, sub))]

    let info: ModInfo | null = null
    const maps = new Set<string>()
    for (const root of roots) {
      const infoPath = join(root, 'mod.info')
      if (existsSync(infoPath)) {
        const parsed = parseModInfo(readFileSync(infoPath, 'utf-8'))
        if (parsed.id) {
          // prefer the 42 folder's mod.info, it's the one B42 actually reads
          if (!info || /[\\/]42[^\\/]*$/.test(root)) {
            info = { id: parsed.id, name: parsed.name || parsed.id, requires: parsed.requires, maps: [] }
          }
        }
      }
      for (const m of listDirs(join(root, 'media', 'maps'))) maps.add(m)
    }
    if (info) {
      info.maps = [...maps]
      found.set(info.id, info)
    }
  }
  return [...found.values()]
}

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

  // Read mod ids, requirements and maps out of whatever is already downloaded
  ipcMain.handle('mods:scanInstalled', async (_event, serverInstallPath: string, workshopIds: string[]) => {
    try {
      const contentDir = workshopContentDir(serverInstallPath)
      const found: Record<string, ModInfo[]> = {}
      for (const id of workshopIds) {
        const itemDir = join(contentDir, id)
        if (existsSync(itemDir)) found[id] = scanWorkshopItem(itemDir)
      }
      return { success: true, found }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), found: {} }
    }
  })
}

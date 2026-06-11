import { ipcMain } from 'electron'
import https from 'https'

const PZ_APP_ID = '108600'
const STEAM_API_BASE = 'https://api.steampowered.com'

interface WorkshopMod {
  workshopId: string
  modId: string
  name: string
  description: string
  thumbnailUrl: string
  subscriptions: number
  tags: string[]
  timeUpdated: number
  fileSize: number
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function extractModIdFromDescription(description: string, title: string): string {
  // Try to find Mod ID in description (common PZ mod pattern)
  const patterns = [
    /Mod\s+ID[:\s]+([A-Za-z0-9_]+)/i,
    /ModID[:\s]+([A-Za-z0-9_]+)/i,
    /mod_id[:\s]+([A-Za-z0-9_]+)/i,
  ]

  for (const pattern of patterns) {
    const match = description.match(pattern)
    if (match) return match[1]
  }

  // Fallback: use title as mod ID (sanitized)
  return title.replace(/[^A-Za-z0-9_]/g, '')
}

export function setupModHandlers() {
  // Search Steam Workshop for PZ mods
  ipcMain.handle('mods:search', async (_event, query: string, page: number = 1) => {
    try {
      const params = new URLSearchParams({
        query,
        appid: PZ_APP_ID,
        numperpage: '20',
        page: String(page),
        return_tags: '1',
        return_short_description: '1',
        return_previews: '1',
        return_metadata: '1',
        search_text: query,
        file_type: '0',
      })

      const url = `${STEAM_API_BASE}/IPublishedFileService/QueryFiles/v1/?${params}`
      const rawData = await httpsGet(url)
      const data = JSON.parse(rawData)

      if (!data?.response?.publishedfiledetails) {
        return { success: true, mods: [], total: 0 }
      }

      const mods: WorkshopMod[] = data.response.publishedfiledetails.map((item: Record<string, unknown>) => ({
        workshopId: String(item.publishedfileid),
        modId: extractModIdFromDescription(
          String(item.short_description || item.description || ''),
          String(item.title || '')
        ),
        name: String(item.title || 'Unknown Mod'),
        description: String(item.short_description || '').substring(0, 300),
        thumbnailUrl: String(item.preview_url || ''),
        subscriptions: Number(item.subscriptions || 0),
        tags: Array.isArray(item.tags) ? (item.tags as Array<{tag: string}>).map(t => t.tag) : [],
        timeUpdated: Number(item.time_updated || 0),
        fileSize: Number(item.file_size || 0),
      }))

      return {
        success: true,
        mods,
        total: data.response.total || mods.length,
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, mods: [], total: 0 }
    }
  })

  // Get details for specific workshop IDs
  ipcMain.handle('mods:getDetails', async (_event, workshopIds: string[]) => {
    try {
      if (!workshopIds || workshopIds.length === 0) {
        return { success: true, mods: [] }
      }

      // Build POST body
      const params = new URLSearchParams()
      params.append('itemcount', String(workshopIds.length))
      workshopIds.forEach((id, idx) => {
        params.append(`publishedfileids[${idx}]`, id)
      })

      const url = `${STEAM_API_BASE}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`
      const rawData = await httpsPost(url, params.toString())
      const data = JSON.parse(rawData)

      if (!data?.response?.publishedfiledetails) {
        return { success: true, mods: [] }
      }

      const mods: WorkshopMod[] = data.response.publishedfiledetails.map((item: Record<string, unknown>) => ({
        workshopId: String(item.publishedfileid),
        modId: extractModIdFromDescription(
          String(item.description || ''),
          String(item.title || '')
        ),
        name: String(item.title || 'Unknown Mod'),
        description: String(item.description || '').substring(0, 300),
        thumbnailUrl: String(item.preview_url || ''),
        subscriptions: Number(item.subscriptions || 0),
        tags: Array.isArray(item.tags) ? (item.tags as Array<{tag: string}>).map(t => t.tag) : [],
        timeUpdated: Number(item.time_updated || 0),
        fileSize: Number(item.file_size || 0),
      }))

      return { success: true, mods }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, mods: [] }
    }
  })
}

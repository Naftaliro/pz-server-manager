import { ipcMain } from 'electron'
import https from 'https'
import http from 'http'

const PZ_APP_ID = '108600'

// B41 tag used in Steam Workshop items
const B41_TAGS = ['build 41', 'b41', 'build41', 'multiplayer', 'mp']
// B42 tag used in Steam Workshop items
const B42_TAGS = ['build 42', 'b42', 'build42']

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

// Generic HTTPS GET returning raw string (follows redirects)
function httpsGet(url: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirects > 10) { reject(new Error('Too many redirects')); return }
    const lib = url.startsWith('https') ? https : http
    const req = (lib as typeof https).get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        httpsGet(res.headers.location, redirects + 1).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

// HTTPS POST with form-encoded body
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
        'User-Agent': 'Mozilla/5.0',
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Step 1: Scrape the Steam Workshop browse/search page to extract published file IDs
// Optionally pass a requiredTag to filter by B41/B42 on the Steam side
async function scrapeWorkshopIds(query: string, page: number, buildVersion?: 'b41' | 'b42'): Promise<{ ids: string[], hasMore: boolean }> {
  const start = (page - 1) * 9

  // Build URL — add a required_tags filter when a buildVersion is specified
  let url = `https://steamcommunity.com/workshop/browse/?appid=${PZ_APP_ID}&searchtext=${encodeURIComponent(query)}&browsesort=textsearch&section=readytouseitems&actualsort=textsearch&p=${page}&start=${start}&count=9`

  // Steam Workshop tag filtering: "Build 41" or "Build 42"
  if (buildVersion === 'b41') {
    url += '&requiredtags%5B%5D=Build+41'
  } else if (buildVersion === 'b42') {
    url += '&requiredtags%5B%5D=Build+42'
  }

  const html = await httpsGet(url)
  const idMatches = html.match(/filedetails\/\?id=(\d+)/g) || []
  const ids = [...new Set(idMatches.map(m => m.replace('filedetails/?id=', '')))]
  const hasMore = ids.length >= 9

  return { ids, hasMore }
}

// Step 2: Fetch full details for a list of workshop IDs via the POST endpoint (no API key needed)
async function fetchModDetails(ids: string[]): Promise<WorkshopMod[]> {
  if (ids.length === 0) return []

  const params = [`itemcount=${ids.length}`, ...ids.map((id, i) => `publishedfileids[${i}]=${id}`)].join('&')
  const rawData = await httpsPost(
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    params
  )

  const data = JSON.parse(rawData)
  const details: Array<Record<string, unknown>> = data?.response?.publishedfiledetails || []

  return details
    .filter(item => item.result === 1)
    .map(item => ({
      workshopId: String(item.publishedfileid),
      modId: extractModId(String(item.description || ''), String(item.title || '')),
      name: String(item.title || 'Unknown Mod'),
      description: cleanDescription(String(item.description || '')).substring(0, 300),
      thumbnailUrl: String(item.preview_url || ''),
      subscriptions: Number(item.subscriptions || 0),
      tags: Array.isArray(item.tags)
        ? (item.tags as Array<{ tag: string }>).map(t => t.tag)
        : [],
      timeUpdated: Number(item.time_updated || 0),
      fileSize: Number(item.file_size || 0),
    }))
}

// Post-filter mods by build version based on their tags
// If a mod has no build tags at all, include it (it may be compatible with both)
function filterByBuildVersion(mods: WorkshopMod[], buildVersion: 'b41' | 'b42'): WorkshopMod[] {
  return mods.filter(mod => {
    const lowerTags = mod.tags.map(t => t.toLowerCase())

    const hasB41Tag = B41_TAGS.some(t => lowerTags.includes(t))
    const hasB42Tag = B42_TAGS.some(t => lowerTags.includes(t))

    // If mod has no build-specific tags, include it (untagged = likely compatible with both)
    if (!hasB41Tag && !hasB42Tag) return true

    if (buildVersion === 'b41') return hasB41Tag
    if (buildVersion === 'b42') return hasB42Tag
    return true
  })
}

// Extract the PZ Mod ID from the workshop description (common pattern in PZ mods)
function extractModId(description: string, title: string): string {
  const patterns = [
    /Mod\s+ID[:\s]+([A-Za-z0-9_]+)/i,
    /ModID[:\s]+([A-Za-z0-9_]+)/i,
    /mod_id[:\s]+([A-Za-z0-9_]+)/i,
    /\[b\]Mod\s+ID[:\s]*\[\/b\]\s*([A-Za-z0-9_]+)/i,
    /Mod\s+ID[:\s]*\*?\*?([A-Za-z0-9_]+)/i,
  ]
  for (const pattern of patterns) {
    const match = description.match(pattern)
    if (match?.[1]) return match[1]
  }
  return title.replace(/[^A-Za-z0-9_]/g, '').substring(0, 64) || 'UnknownMod'
}

// Strip Steam BBCode tags from description for display
function cleanDescription(text: string): string {
  return text
    .replace(/\[url=[^\]]*\]/gi, '')
    .replace(/\[\/url\]/gi, '')
    .replace(/\[b\]|\[\/b\]/gi, '')
    .replace(/\[i\]|\[\/i\]/gi, '')
    .replace(/\[h[1-6]\]|\[\/h[1-6]\]/gi, '')
    .replace(/\[list\]|\[\/list\]/gi, '')
    .replace(/\[\*\]/gi, '• ')
    .replace(/\[table\].*?\[\/table\]/gis, '')
    .replace(/\[tr\]|\[\/tr\]|\[td\]|\[\/td\]/gi, '')
    .replace(/\[img\][^\[]*\[\/img\]/gi, '')
    .replace(/\[\/?\w+[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function setupModHandlers() {
  // Search Steam Workshop for PZ mods — now accepts optional buildVersion for filtering
  ipcMain.handle('mods:search', async (_event, query: string, page: number = 1, buildVersion?: 'b41' | 'b42') => {
    try {
      if (!query || query.trim().length === 0) {
        return { success: true, mods: [], total: 0 }
      }

      // Pass buildVersion to scraper for Steam-side tag filtering
      const { ids, hasMore } = await scrapeWorkshopIds(query.trim(), page, buildVersion)

      if (ids.length === 0) {
        return { success: true, mods: [], total: 0, hasMore: false }
      }

      const rawMods = await fetchModDetails(ids)

      // Also apply client-side post-filter for any mods that slipped through
      const mods = buildVersion ? filterByBuildVersion(rawMods, buildVersion) : rawMods

      return {
        success: true,
        mods,
        total: mods.length,
        hasMore,
        buildVersion: buildVersion || null,
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, mods: [], total: 0 }
    }
  })

  // Get details for specific workshop IDs (used when loading saved mod lists)
  ipcMain.handle('mods:getDetails', async (_event, workshopIds: string[]) => {
    try {
      if (!workshopIds || workshopIds.length === 0) {
        return { success: true, mods: [] }
      }
      const batchSize = 100
      const allMods: WorkshopMod[] = []
      for (let i = 0; i < workshopIds.length; i += batchSize) {
        const batch = workshopIds.slice(i, i + batchSize)
        const mods = await fetchModDetails(batch)
        allMods.push(...mods)
      }
      return { success: true, mods: allMods }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, mods: [] }
    }
  })
}

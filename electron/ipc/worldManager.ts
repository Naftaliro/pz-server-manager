import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, rmSync, statSync, readdirSync } from 'fs'

function getServerDataPath(dataPath: string): string {
  return dataPath.replace('%USERPROFILE%', process.env.USERPROFILE || process.env.HOME || '')
}

function getWorldSavePath(serverName: string, dataPath: string): string {
  return join(getServerDataPath(dataPath), 'Saves', 'Multiplayer', serverName)
}

function getDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0
  let size = 0
  try {
    const items = readdirSync(dirPath, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(dirPath, item.name)
      if (item.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        try {
          size += statSync(fullPath).size
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return size
}

export function setupWorldHandlers() {
  ipcMain.handle('world:getSize', async (_event, serverName: string, dataPath: string) => {
    try {
      const worldPath = getWorldSavePath(serverName, dataPath)
      if (!existsSync(worldPath)) {
        return { success: true, exists: false, sizeBytes: 0, sizeMb: 0 }
      }

      const sizeBytes = getDirSize(worldPath)
      const sizeMb = Math.round(sizeBytes / (1024 * 1024) * 10) / 10

      return { success: true, exists: true, sizeBytes, sizeMb, path: worldPath }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  ipcMain.handle('world:wipe', async (_event, serverName: string, dataPath: string) => {
    try {
      const worldPath = getWorldSavePath(serverName, dataPath)

      if (!existsSync(worldPath)) {
        return { success: true, message: 'No world data found to wipe' }
      }

      // Delete the world save directory recursively
      rmSync(worldPath, { recursive: true, force: true })

      // Also reset the ResetID in the .ini to force a fresh world
      const serverDir = join(getServerDataPath(dataPath), 'Server')
      const iniPath = join(serverDir, `${serverName}.ini`)

      if (existsSync(iniPath)) {
        const { readFileSync, writeFileSync } = await import('fs')
        let iniContent = readFileSync(iniPath, 'utf-8')
        // Update ResetID to force world reset
        const newResetId = Math.floor(Math.random() * 999999999)
        iniContent = iniContent.replace(/^ResetID=.*/m, `ResetID=${newResetId}`)
        iniContent = iniContent.replace(/^ServerPlayerID=.*/m, `ServerPlayerID=${Math.floor(Math.random() * 999999999)}`)
        writeFileSync(iniPath, iniContent, 'utf-8')
      }

      return { success: true, message: `World data wiped successfully. Path: ${worldPath}` }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })
}

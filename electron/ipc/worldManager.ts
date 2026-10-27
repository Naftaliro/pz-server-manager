import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { folderSize, forgetFolderSize } from './folderSize'

function getServerDataPath(dataPath: string): string {
  return dataPath.replace('%USERPROFILE%', process.env.USERPROFILE || process.env.HOME || '')
}

function getWorldSavePath(serverName: string, dataPath: string): string {
  return join(getServerDataPath(dataPath), 'Saves', 'Multiplayer', serverName)
}

export function setupWorldHandlers() {
  ipcMain.handle('world:getSize', async (_event, serverName: string, dataPath: string) => {
    try {
      const worldPath = getWorldSavePath(serverName, dataPath)
      if (!existsSync(worldPath)) {
        return { success: true, exists: false, sizeBytes: 0, sizeMb: 0 }
      }

      // tens of thousands of chunk files: measured outside the app, remembered for 5 minutes
      const sizeBytes = await folderSize(worldPath, 5 * 60 * 1000)
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

      // Delete the world save directory recursively (without freezing the app on ~90,000 files)
      await rm(worldPath, { recursive: true, force: true })
      forgetFolderSize(worldPath)

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

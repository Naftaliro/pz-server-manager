import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // Shell
  shell: {
    openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  },

  // Dialog
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openFile: (filters?: Array<{ name: string; extensions: string[] }>) => ipcRenderer.invoke('dialog:openFile', filters),
  },

  // SteamCMD
  steamcmd: {
    download: (targetDir: string) => ipcRenderer.invoke('steamcmd:download', targetDir),
    installServer: (steamcmdPath: string, installDir: string, onProgress: (line: string) => void) => {
      const channel = `steamcmd:progress:${Date.now()}`
      ipcRenderer.on(channel, (_e, line) => onProgress(line))
      return ipcRenderer.invoke('steamcmd:installServer', { steamcmdPath, installDir, channel })
        .finally(() => ipcRenderer.removeAllListeners(channel))
    },
    updateServer: (steamcmdPath: string, installDir: string, onProgress: (line: string) => void) => {
      const channel = `steamcmd:progress:${Date.now()}`
      ipcRenderer.on(channel, (_e, line) => onProgress(line))
      return ipcRenderer.invoke('steamcmd:updateServer', { steamcmdPath, installDir, channel })
        .finally(() => ipcRenderer.removeAllListeners(channel))
    },
    checkInstalled: (installDir: string) => ipcRenderer.invoke('steamcmd:checkInstalled', installDir),
  },

  // Server management
  server: {
    start: (profileId: string) => ipcRenderer.invoke('server:start', profileId),
    stop: (profileId: string) => ipcRenderer.invoke('server:stop', profileId),
    restart: (profileId: string) => ipcRenderer.invoke('server:restart', profileId),
    getStatus: (profileId: string) => ipcRenderer.invoke('server:getStatus', profileId),
    getAllStatuses: () => ipcRenderer.invoke('server:getAllStatuses'),
    sendCommand: (profileId: string, command: string) => ipcRenderer.invoke('server:sendCommand', profileId, command),
    onConsoleOutput: (profileId: string, callback: (line: string) => void) => {
      const channel = `server:console:${profileId}`
      ipcRenderer.on(channel, (_e, line) => callback(line))
      return () => ipcRenderer.removeAllListeners(channel)
    },
    onStatusChange: (callback: (profileId: string, status: string) => void) => {
      ipcRenderer.on('server:statusChange', (_e, profileId, status) => callback(profileId, status))
      return () => ipcRenderer.removeAllListeners('server:statusChange')
    },
  },

  // Profile management
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    get: (id: string) => ipcRenderer.invoke('profiles:get', id),
    save: (profile: unknown) => ipcRenderer.invoke('profiles:save', profile),
    delete: (id: string) => ipcRenderer.invoke('profiles:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('profiles:duplicate', id),
  },

  // Config file management
  config: {
    readIni: (serverName: string, dataPath: string) => ipcRenderer.invoke('config:readIni', serverName, dataPath),
    writeIni: (serverName: string, dataPath: string, settings: unknown) => ipcRenderer.invoke('config:writeIni', serverName, dataPath, settings),
    readSandbox: (serverName: string, dataPath: string) => ipcRenderer.invoke('config:readSandbox', serverName, dataPath),
    writeSandbox: (serverName: string, dataPath: string, settings: unknown) => ipcRenderer.invoke('config:writeSandbox', serverName, dataPath, settings),
  },

  // Mod management
  mods: {
    search: (query: string, page: number) => ipcRenderer.invoke('mods:search', query, page),
    getDetails: (workshopIds: string[]) => ipcRenderer.invoke('mods:getDetails', workshopIds),
  },

  // World management
  world: {
    wipe: (serverName: string, dataPath: string) => ipcRenderer.invoke('world:wipe', serverName, dataPath),
    getSize: (serverName: string, dataPath: string) => ipcRenderer.invoke('world:getSize', serverName, dataPath),
  },

  // Auto-updater
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: (downloadUrl: string, assetName: string) => ipcRenderer.invoke('updater:install', downloadUrl, assetName),
    openReleasePage: (url: string) => ipcRenderer.invoke('updater:openReleasePage', url),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onProgress: (callback: (data: { stage: string; pct: number }) => void) => {
      ipcRenderer.on('updater:progress', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('updater:progress')
    },
  },

  // File system helpers
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  },

})

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
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },

  system: {
    info: () => ipcRenderer.invoke('system:info'),
  },

  discord: {
    test: (url: string, serverName: string) => ipcRenderer.invoke('discord:test', url, serverName),
  },

  diagnostics: {
    copy: () => ipcRenderer.invoke('diagnostics:copy'),
    reportError: (where: string, message: string) => ipcRenderer.send('diagnostics:reportError', where, message),
  },

  // "Works with playit.gg"
  playit: {
    state: () => ipcRenderer.invoke('playit:state'),
    install: () => ipcRenderer.invoke('playit:install'),
    setup: () => ipcRenderer.invoke('playit:setup'),
    start: () => ipcRenderer.invoke('playit:start'),
    openDashboard: () => ipcRenderer.invoke('playit:openDashboard'),
  },

  network: {
    checkUpnp: (port: number, publicIp: string | null) => ipcRenderer.invoke('network:checkUpnp', port, publicIp),
    firewallStatus: () => ipcRenderer.invoke('network:firewallStatus'),
    addFirewallRule: (serverInstallPath: string) => ipcRenderer.invoke('network:addFirewallRule', serverInstallPath),
    removeFirewallRule: () => ipcRenderer.invoke('network:removeFirewallRule'),
  },

  // App-wide settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  },

  // Dialog
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('dialog:openFile', options?.filters),
    saveFile: (options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('dialog:saveFile', options?.defaultPath, options?.filters),
  },

  // SteamCMD
  steamcmd: {
    download: (targetDir: string) => ipcRenderer.invoke('steamcmd:download', targetDir),
    installServer: (steamcmdPath: string, installDir: string, onProgress: (line: string) => void, buildVersion?: 'b41' | 'b42') => {
      const channel = `steamcmd:progress:${Date.now()}`
      ipcRenderer.on(channel, (_e, line) => onProgress(line))
      return ipcRenderer.invoke('steamcmd:installServer', { steamcmdPath, installDir, channel, buildVersion })
        .finally(() => ipcRenderer.removeAllListeners(channel))
    },
    updateServer: (steamcmdPath: string, installDir: string, onProgress: (line: string) => void, buildVersion?: 'b41' | 'b42') => {
      const channel = `steamcmd:progress:${Date.now()}`
      ipcRenderer.on(channel, (_e, line) => onProgress(line))
      return ipcRenderer.invoke('steamcmd:updateServer', { steamcmdPath, installDir, channel, buildVersion })
        .finally(() => ipcRenderer.removeAllListeners(channel))
    },
    checkInstalled: (installDir: string) => ipcRenderer.invoke('steamcmd:checkInstalled', installDir),
    checkUpdate: (installDir: string) => ipcRenderer.invoke('steamcmd:checkUpdate', installDir),
    findSteamInstall: () => ipcRenderer.invoke('steamcmd:findSteamInstall'),
    downloadMods: (workshopIds: string[], onEvent: (e: unknown) => void) => {
      const channel = `steamcmd:mods:${Date.now()}:${Math.random()}`
      ipcRenderer.on(channel, (_e, payload) => onEvent(payload))
      return ipcRenderer.invoke('steamcmd:downloadMods', { workshopIds, channel })
        .finally(() => ipcRenderer.removeAllListeners(channel))
    },
  },

  // Server management
  server: {
    start: (profileId: string) => ipcRenderer.invoke('server:start', profileId),
    stop: (profileId: string) => ipcRenderer.invoke('server:stop', profileId),
    restart: (profileId: string) => ipcRenderer.invoke('server:restart', profileId),
    getStatus: (profileId: string) => ipcRenderer.invoke('server:getStatus', profileId),
    getAllStatuses: () => ipcRenderer.invoke('server:getAllStatuses'),
    sendCommand: (profileId: string, command: string) => ipcRenderer.invoke('server:sendCommand', profileId, command),
    getPlayers: (profileId: string) => ipcRenderer.invoke('server:getPlayers', profileId),
    preflight: (profileId: string) => ipcRenderer.invoke('server:preflight', profileId),
    playerAction: (profileId: string, action: string, name: string) => ipcRenderer.invoke('server:playerAction', profileId, action, name),
    restartWithWarning: (profileId: string, minutes: number) => ipcRenderer.invoke('server:restartWithWarning', profileId, minutes),
    listBackups: (profileId: string) => ipcRenderer.invoke('server:listBackups', profileId),
    backupNow: (profileId: string) => ipcRenderer.invoke('server:backupNow', profileId),
    restoreBackup: (profileId: string, name: string) => ipcRenderer.invoke('server:restoreBackup', profileId, name),
    openBackups: (profileId: string) => ipcRenderer.invoke('server:openBackups', profileId),
    onModUpdates: (callback: (profileId: string, names: string[]) => void) => {
      const handler = (_e: unknown, profileId: string, names: string[]) => callback(profileId, names)
      ipcRenderer.on('server:modUpdates', handler)
      return () => ipcRenderer.removeListener('server:modUpdates', handler)
    },
    networkInfo: () => ipcRenderer.invoke('server:networkInfo'),
    onPlayers: (callback: (profileId: string, players: string[]) => void) => {
      const handler = (_e: unknown, profileId: string, players: string[]) => callback(profileId, players)
      ipcRenderer.on('server:players', handler)
      return () => ipcRenderer.removeListener('server:players', handler)
    },
    onProblem: (callback: (profileId: string, problem: { hint: string; line: string; at: number }) => void) => {
      const handler = (_e: unknown, profileId: string, problem: { hint: string; line: string; at: number }) => callback(profileId, problem)
      ipcRenderer.on('server:problem', handler)
      return () => ipcRenderer.removeListener('server:problem', handler)
    },
    onConsoleOutput: (profileId: string, callback: (line: string) => void) => {
      const channel = `server:console:${profileId}`
      const handler = (_e: unknown, line: string) => callback(line)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onStatusChange: (callback: (profileId: string, status: string) => void) => {
      const handler = (_e: unknown, profileId: string, status: string) => callback(profileId, status)
      ipcRenderer.on('server:statusChange', handler)
      return () => ipcRenderer.removeListener('server:statusChange', handler)
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
    getDetails: (workshopIds: string[]) => ipcRenderer.invoke('mods:getDetails', workshopIds),
    getCollection: (workshopId: string) => ipcRenderer.invoke('mods:getCollection', workshopId),
    scanInstalled: (serverInstallPath: string, workshopIds: string[]) => ipcRenderer.invoke('mods:scanInstalled', serverInstallPath, workshopIds),
    resolvePack: (ids: string[], withDeps?: boolean) => ipcRenderer.invoke('mods:resolvePack', ids, withDeps),
    installLocal: (modIds: string[], worldSavePath?: string) => ipcRenderer.invoke('localMods:install', modIds, worldSavePath),
  },

  // Fix mods on the Workshop (host side)
  workshop: {
    prepare: (profileId: string, modId: string) => ipcRenderer.invoke('workshop:prepare', profileId, modId),
    status: (profileId: string, modId: string) => ipcRenderer.invoke('workshop:status', profileId, modId),
    useWorkshopCopy: (profileId: string, modId: string, workshopId: string) => ipcRenderer.invoke('workshop:useWorkshopCopy', profileId, modId, workshopId),
    openFolder: (dir: string) => ipcRenderer.invoke('workshop:openFolder', dir),
  },

  // Play mode (the player's side) + server packs
  client: {
    state: () => ipcRenderer.invoke('client:state'),
    searchDrives: () => ipcRenderer.invoke('client:searchDrives'),
    useGameDir: (dir: string) => ipcRenderer.invoke('client:useGameDir', dir),
    listServers: () => ipcRenderer.invoke('client:listServers'),
    openPack: () => ipcRenderer.invoke('client:openPack'),
    removeServer: (id: string) => ipcRenderer.invoke('client:removeServer', id),
    setAccount: (id: string, account: { username: string; password: string }) => ipcRenderer.invoke('client:setAccount', id, account),
    installFixes: (id: string) => ipcRenderer.invoke('client:installFixes', id),
    launch: (id?: string, join?: boolean) => ipcRenderer.invoke('client:launch', id, join),
    exportPack: (profileId: string, opts: { address?: string; includePassword?: boolean }) => ipcRenderer.invoke('client:exportPack', profileId, opts),
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
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    findServerBat: (dir: string) => ipcRenderer.invoke('fs:findServerBat', dir),
  },

})

import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomBytes, randomUUID } from 'crypto'
import { loadSettings } from './appSettings'
import { withValidWorkshopIds, type ModInfo, type ModSnapshot } from '../../shared/modCore'
import { dropOldSandboxDefaults, SANDBOX_SETTINGS_VERSION } from '../../shared/profileMigrations'
import type { SettingsTree } from '../../shared/gameConfig'
import { SECRET_INI_KEYS } from '../../shared/serverPack'
import { ownDataFolder, expandDataPath } from '../../shared/dataFolder'
import { freeGamePort, freeRconPort, copyName } from '../../shared/ports'

export interface ModEntry {
  workshopId: string
  modId: string
  name: string
  description?: string
  thumbnailUrl?: string
  // filled in from the downloaded files (mod.info). modId holds the enabled ones, ;-separated
  infos?: ModInfo[]
  requires?: string[]
  maps?: string[]
  fileSize?: number
}

export type BuildVersion = 'b41' | 'b42'

export interface ServerProfile {
  id: string
  name: string
  // folder/config name PZ uses, fixed at creation so renaming doesn't orphan the world
  serverName?: string
  description: string
  buildVersion: BuildVersion
  serverInstallPath: string
  worldSavePath?: string
  port: number
  udpPort: number
  memory: number
  adminPassword: string
  serverPassword: string
  maxPlayers: number
  mods: ModEntry[]
  launchMode?: 'managed' | 'passthrough'
  // reliability switches, all on unless turned off
  autoRestart?: boolean
  restartOnModUpdate?: boolean
  backupsEnabled?: boolean
  backupsToKeep?: number
  // restart once a day at this hour (0-23), off when unset
  dailyRestartHour?: number | null
  // Discord channel webhook for server updates
  discordWebhook?: string
  discordPlayerEvents?: boolean
  playitAddress?: string
  // start this server when the app opens (with "Start with Windows" it comes up after a reboot)
  startWithApp?: boolean
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
  // which profileMigrations ran on sandboxSettings
  sandboxSettingsVersion?: number
  createdAt: string
  updatedAt: string
  lastStarted?: string
  // what the server loaded last time it started, to show what changed since
  lastStartedMods?: ModSnapshot
  // order of mod map folders in Map= (first one wins where maps overlap)
  mapOrder?: string[]
}

const DEFAULT_INI_SETTINGS = {
  PVP: true,
  PauseEmpty: true,
  GlobalChat: true,
  Open: true,
  MaxPlayers: 16,
  Public: false,
  PublicName: '',
  PublicDescription: '',
  Password: '',
  ServerWelcomeMessage: 'Welcome to Project Zomboid!',
  AutoCreateUserInWhiteList: false,
  DisplayUserName: true,
  ShowFirstAndLastName: false,
  SpawnPoint: '0,0,0',
  SafetySystem: true,
  ShowSafety: true,
  SafetyToggleTimer: 2,
  SafetyCooldownTimer: 3,
  SpawnItems: '',
  DefaultPort: 16261,
  ResetID: Math.floor(Math.random() * 999999999),
  Map: 'Muldraugh, KY',
  DoLuaChecksum: true,
  DenyLoginOnOverloadedServer: true,
  PingFrequency: 10,
  PingLimit: 250,
  HoursForLootRespawn: 0,
  MaxItemsForLootRespawn: 4,
  ConstructionPreventsLootRespawn: true,
  DropOffWhiteListAfterDeath: false,
  NoFire: false,
  AnnounceDeath: true,
  MinutesPerPage: 1.0,
  SaveWorldEveryMinutes: 0,
  PlayerSafehouse: true,
  AdminSafehouse: false,
  SafehouseAllowTrepass: true,
  SafehouseAllowFire: true,
  SafehouseAllowLoot: true,
  SafehouseAllowRespawn: false,
  SafehouseDaySurvivedToClaim: 0,
  SafeHouseRemovalTime: 144,
  AllowDestructionBySledgehammer: true,
  KickFastPlayers: false,
  RCONPort: 27015,
  RCONPassword: '',
  SleepAllowed: false,
  SleepNeeded: false,
  SteamPort1: 8766,
  SteamPort2: 8767,
  SteamScoreboard: true,
  SteamVAC: true,
  UPnP: true,
  VoiceEnable: true,
  VoiceComplexity: 5,
  VoicePeriod: 20,
  VoiceSampleRate: 24000,
  VoiceBuffering: 8000,
  VoiceMinDistance: 10.0,
  VoiceMaxDistance: 300.0,
  Voice3D: true,
  Faction: true,
  FactionDaySurvivedToCreate: 0,
  FactionPlayersRequiredForTag: 1,
  AllowTradeUI: true,
  MaxAccountsPerUser: 0,
  PlayerRespawnWithSelf: false,
  PlayerRespawnWithOther: false,
  FastForwardMultiplier: 40.0,
  PlayerSaveOnDamage: true,
  DisableSafehouseWhenPlayerConnected: false,
  BloodSplatLifespanDays: 0,
  AllowNonAsciiUsername: false,
  BanKickGlobalSound: true,
  RemovePlayerCorpsesOnCorpseRemoval: false,
  TrashDeleteAll: false,
  PVPMeleeWhileHitReaction: false,
  MouseOverToSeeDisplayName: true,
  HidePlayersBehindYou: true,
  PVPMeleeDamageModifier: 30.0,
  PVPFirearmDamageModifier: 50.0,
  CarEngineAttractionModifier: 0.5,
  PlayerBumpPlayer: false,
  HoursForWorldItemRemoval: 0.0,
  WorldItemRemovalList: 'Base.Vest,Base.Shirt,Base.Blouse,Base.Skirt,Base.Shoes',
  ItemNumbersLimitPerContainer: 0,
  SpeedLimit: 70.0,
  ServerPlayerID: Math.floor(Math.random() * 999999999),
  WorkshopItems: '',
  Mods: '',
}

let profilesPath: string

function getProfilesPath(): string {
  if (!profilesPath) {
    const userDataPath = app.getPath('userData')
    profilesPath = join(userDataPath, 'profiles.json')
  }
  return profilesPath
}

function loadProfiles(): ServerProfile[] {
  const path = getProfilesPath()
  if (!existsSync(path)) return []
  let profiles: ServerProfile[]
  try {
    profiles = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
  // a workshop id that isn't a number never came from Steam (an import from before ids were
  // checked, a hand edit), and it would end up on SteamCMD's command line
  for (const p of profiles) if (Array.isArray(p.mods)) p.mods = withValidWorkshopIds(p.mods)
  // once per profile: clear out the sandbox values older versions filled in for everyone
  const stale = profiles.filter(p => (p.sandboxSettingsVersion || 1) < SANDBOX_SETTINGS_VERSION)
  if (stale.length > 0) {
    for (const p of stale) {
      p.sandboxSettings = dropOldSandboxDefaults((p.sandboxSettings || {}) as SettingsTree)
      p.sandboxSettingsVersion = SANDBOX_SETTINGS_VERSION
    }
    saveProfiles(profiles)
  }
  return profiles
}

function saveProfiles(profiles: ServerProfile[]) {
  const path = getProfilesPath()
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(profiles, null, 2), 'utf-8')
}

export function getProfile(id: string): ServerProfile | undefined {
  const profiles = loadProfiles()
  return profiles.find(p => p.id === id)
}

export function listProfiles(): ServerProfile[] {
  return loadProfiles()
}

export function patchProfile(id: string, patch: Partial<ServerProfile>): ServerProfile | undefined {
  const profiles = loadProfiles()
  const idx = profiles.findIndex(p => p.id === id)
  if (idx === -1) return undefined
  profiles[idx] = { ...profiles[idx], ...patch }
  saveProfiles(profiles)
  return profiles[idx]
}

export function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function getServerName(profile: Pick<ServerProfile, 'name' | 'serverName'>): string {
  return profile.serverName || sanitizeServerName(profile.name)
}

// pick a server name nobody else is using yet
function uniqueServerName(name: string, profiles: ServerProfile[]): string {
  const base = sanitizeServerName(name) || 'server'
  const taken = new Set(profiles.map(p => getServerName(p).toLowerCase()))
  let candidate = base
  // a leftover data folder of a deleted server with that name would hand it the old world
  const free = (c: string) => !taken.has(c.toLowerCase()) && !existsSync(expandDataPath(ownDataFolder(c), process.env))
  for (let n = 2; !free(candidate); n++) candidate = `${base}_${n}`
  return candidate
}

const randomId = () => Math.floor(Math.random() * 999999999)
const randomPassword = () => randomBytes(12).toString('hex')

export function setupProfileHandlers() {
  ipcMain.handle('profiles:list', async () => {
    return loadProfiles()
  })

  ipcMain.handle('profiles:get', async (_event, id: string) => {
    return getProfile(id) || null
  })

  ipcMain.handle('profiles:save', async (_event, profile: ServerProfile) => {
    const profiles = loadProfiles()
    if (Array.isArray(profile.mods)) profile = { ...profile, mods: withValidWorkshopIds(profile.mods) }
    const now = new Date().toISOString()

    // Always deep-merge defaults so the stored profile has a COMPLETE settings set.
    // This ensures the INI/SandboxVars written to disk before launch are fully populated.
    const mergedIni = { ...DEFAULT_INI_SETTINGS, ...(profile.iniSettings || {}) }
    // only what was actually set: the game fills in the rest, and its defaults differ per build
    const mergedSandbox = profile.sandboxSettings || {}

    if (!profile.id) {
      // New profile
      const settings = loadSettings()
      const serverName = profile.serverName || uniqueServerName(profile.name, profiles)
      const newProfile: ServerProfile = {
        ...profile,
        id: randomUUID(),
        serverName,
        // a data folder of its own unless one was picked (see shared/dataFolder.ts)
        worldSavePath: profile.worldSavePath?.trim() || ownDataFolder(serverName),
        buildVersion: profile.buildVersion || settings.buildVersion || 'b42',
        serverInstallPath: profile.serverInstallPath || settings.serverInstallPath,
        iniSettings: {
          // whatever the new server was made from (someone's server pack, a preset), its
          // secrets are its own: nobody else gets to pick or know them
          ...Object.fromEntries(Object.entries(mergedIni).filter(([k]) => !SECRET_INI_KEYS.has(k))),
          ResetID: randomId(),
          ServerPlayerID: randomId(),
          // the app talks to the server over RCON, so every server gets its own password
          RCONPassword: randomPassword(),
        },
        sandboxSettings: mergedSandbox,
        // new profiles only hold what was actually picked
        sandboxSettingsVersion: SANDBOX_SETTINGS_VERSION,
        createdAt: now,
        updatedAt: now,
      }
      profiles.push(newProfile)
      saveProfiles(profiles)
      return newProfile
    } else {
      // Update existing
      const idx = profiles.findIndex(p => p.id === profile.id)
      const previous = idx === -1 ? undefined : profiles[idx]
      const updatedProfile: ServerProfile = {
        ...profile,
        // older profiles never stored this, lock it to the name the world was created under
        serverName: profile.serverName || previous?.serverName || sanitizeServerName(previous?.name || profile.name),
        iniSettings: mergedIni,
        sandboxSettings: mergedSandbox,
        sandboxSettingsVersion: profile.sandboxSettingsVersion ?? previous?.sandboxSettingsVersion,
        updatedAt: now,
      }
      if (idx === -1) {
        profiles.push(updatedProfile)
      } else {
        profiles[idx] = updatedProfile
      }
      saveProfiles(profiles)
      return updatedProfile
    }
  })

  ipcMain.handle('profiles:delete', async (_event, id: string) => {
    const profiles = loadProfiles()
    const filtered = profiles.filter(p => p.id !== id)
    saveProfiles(filtered)
    return { success: true }
  })

  ipcMain.handle('profiles:duplicate', async (_event, id: string) => {
    const profiles = loadProfiles()
    const original = profiles.find(p => p.id === id)
    if (!original) return null

    const now = new Date().toISOString()
    const serverName = uniqueServerName(`${getServerName(original)}_copy`, profiles)
    // ports nobody else in the list has (the same pick as the create wizard), so the copy can
    // run next to the original and earlier copies
    const port = freeGamePort(profiles)
    const duplicate: ServerProfile = {
      ...JSON.parse(JSON.stringify(original)),
      id: randomUUID(),
      name: copyName(original.name, profiles.map(p => p.name)),
      serverName,
      // a fresh world in a folder of its own
      worldSavePath: ownDataFolder(serverName),
      port,
      udpPort: port + 1,
      createdAt: now,
      updatedAt: now,
      lastStarted: undefined,
      lastStartedMods: undefined,
      iniSettings: {
        ...original.iniSettings,
        DefaultPort: port,
        UDPPort: port + 1,
        RCONPort: freeRconPort(profiles),
        RCONPassword: randomPassword(),
        ResetID: randomId(),
        ServerPlayerID: randomId(),
      },
    }

    profiles.push(duplicate)
    saveProfiles(profiles)
    return duplicate
  })
}

export { DEFAULT_INI_SETTINGS }

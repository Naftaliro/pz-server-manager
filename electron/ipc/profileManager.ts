import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

export interface ModEntry {
  workshopId: string
  modId: string
  name: string
  description?: string
  thumbnailUrl?: string
}

export type BuildVersion = 'b41' | 'b42'

export interface ServerProfile {
  id: string
  name: string
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
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastStarted?: string
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

const DEFAULT_SANDBOX_SETTINGS = {
  VERSION: 4,
  Zombies: 4,
  Distribution: 1,
  DayLength: 3,
  StartYear: 1,
  StartMonth: 7,
  StartDay: 1,
  StartTime: 2,
  WaterShut: 2,
  ElecShut: 2,
  WaterShutModifier: 14,
  ElecShutModifier: 14,
  FoodLoot: 4,
  WeaponLoot: 2,
  OtherLoot: 3,
  CannedFoodLoot: 4,
  LiteratureLoot: 4,
  SurvivalGearsLoot: 4,
  MedicalLoot: 4,
  RangedWeaponLoot: 2,
  AmmoLoot: 2,
  MechanicsLoot: 4,
  Temperature: 3,
  Rain: 3,
  ErosionSpeed: 3,
  ErosionDays: 0,
  XpMultiplier: 1.0,
  XpMultiplierAffectsPassive: false,
  ZombieAttractionMultiplier: 1.0,
  VehicleEasyUse: false,
  Farming: 3,
  CompostTime: 2,
  StatsDecrease: 3,
  NatureAbundance: 3,
  Alarm: 6,
  LockedHouses: 6,
  StarterKit: false,
  Nutrition: true,
  FoodRotSpeed: 3,
  FridgeFactor: 3,
  LootRespawn: 1,
  SeenHoursPreventLootRespawn: 0,
  WorldItemRemovalList: '"Base.Hat,Base.Glasses,Base.Maggots"',
  HoursForWorldItemRemoval: 24.0,
  ItemRemovalListBlacklistToggle: false,
  TimeSinceApo: 1,
  PlantResilience: 3,
  PlantAbundance: 3,
  EndRegen: 3,
  Helicopter: 2,
  MetaEvent: 2,
  SleepingEvent: 1,
  GeneratorSpawning: 3,
  GeneratorFuelConsumption: 1.0,
  SurvivorHouseChance: 3,
  VehicleStoryChance: 3,
  ZoneStoryChance: 3,
  AnnotatedMapChance: 4,
  CharacterFreePoints: 0,
  ConstructionBonusPoints: 3,
  NightDarkness: 3,
  NightLength: 3,
  InjurySeverity: 2,
  BoneFracture: true,
  HoursForCorpseRemoval: 216.0,
  DecayingCorpseHealthImpact: 3,
  BloodLevel: 3,
  ClothingDegradation: 3,
  FireSpread: true,
  DaysForRottenFoodRemoval: -1,
  AllowExteriorGenerator: true,
  MaxFogIntensity: 1,
  MaxRainFxIntensity: 1,
  EnableSnowOnGround: true,
  MultiHitZombies: false,
  RearVulnerability: 3,
  AttackBlockMovements: true,
  AllClothesUnlocked: false,
  EnableTaintedWaterText: true,
  CarSpawnRate: 3,
  ChanceHasGas: 4,
  InitialGas: 4,
  CarGasConsumption: 1.0,
  LockedCar: 4,
  CarHotwire: 4,
  CarConditionAffectsStat: 3,
  CarDamageOnImpact: 3,
  DamageToPlayerFromHitByACar: 3,
  EnableVehicles: true,
  EnableTrailerHitch: true,
  // B42 additions
  AnimalPopulationMultiplier: 1.0,
  AnimalPopulationStartMultiplier: 1.0,
  AnimalPopulationPeakMultiplier: 1.5,
  AnimalPopulationPeakDay: 28,
  AnimalChanceSpawnOnFarm: 1,
  AgingModifierSpeed: 1.0,
  MilkIncreaseSpeed: 1.0,
  WoolIncreaseSpeed: 1.0,
  CraftMultiplier: 1.0,
  MaxCraftableItemsOnGround: 0,
  ZombieConfig: {
    PopulationMultiplier: 1.0,
    PopulationStartMultiplier: 1.0,
    PopulationPeakMultiplier: 1.5,
    PopulationPeakDay: 28,
    RespawnHours: 72.0,
    RespawnUnseenHours: 16.0,
    RespawnMultiplier: 0.1,
    RedistributeHours: 12.0,
    FollowSoundDistance: 100,
    RallyGroupSize: 20,
    RallyTravelDistance: 20,
    RallyGroupSeparation: 15,
    RallyGroupRadius: 3,
    Speed: 3,
    Strength: 2,
    Toughness: 2,
    Transmission: 2,
    Intelligence: 2,
    CrawlUnderVehicle: 1,
    Memory: 2,
    Decomp: 1,
    Sight: 2,
    Hearing: 2,
    Smell: 2,
    ThumpNoChasing: false,
    ThumpOnConstruction: true,
    ActiveOnly: false,
    TriggerHouseAlarm: false,
    ZombiesDontAttackUnlessThreatened: false,
    DisableFakeDead: false,
  },
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
  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
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

export function setupProfileHandlers() {
  ipcMain.handle('profiles:list', async () => {
    return loadProfiles()
  })

  ipcMain.handle('profiles:get', async (_event, id: string) => {
    return getProfile(id) || null
  })

  ipcMain.handle('profiles:save', async (_event, profile: ServerProfile) => {
    const profiles = loadProfiles()
    const now = new Date().toISOString()

    // Always deep-merge defaults so the stored profile has a COMPLETE settings set.
    // This ensures the INI/SandboxVars written to disk before launch are fully populated.
    const mergedIni = { ...DEFAULT_INI_SETTINGS, ...(profile.iniSettings || {}) }
    const incomingSandbox = profile.sandboxSettings || {}
    const incomingZombieConfig = (incomingSandbox.ZombieConfig as Record<string, unknown>) || {}
    const defaultZombieConfig = (DEFAULT_SANDBOX_SETTINGS.ZombieConfig as Record<string, unknown>) || {}
    const mergedSandbox = {
      ...DEFAULT_SANDBOX_SETTINGS,
      ...incomingSandbox,
      ZombieConfig: { ...defaultZombieConfig, ...incomingZombieConfig },
    }

    if (!profile.id) {
      // New profile
      const newProfile: ServerProfile = {
        ...profile,
        id: uuidv4(),
        buildVersion: profile.buildVersion || 'b42',
        iniSettings: mergedIni,
        sandboxSettings: mergedSandbox,
        createdAt: now,
        updatedAt: now,
      }
      profiles.push(newProfile)
      saveProfiles(profiles)
      return newProfile
    } else {
      // Update existing
      const idx = profiles.findIndex(p => p.id === profile.id)
      const updatedProfile: ServerProfile = {
        ...profile,
        iniSettings: mergedIni,
        sandboxSettings: mergedSandbox,
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
    const duplicate: ServerProfile = {
      ...JSON.parse(JSON.stringify(original)),
      id: uuidv4(),
      name: `${original.name} (Copy)`,
      port: original.port + 2,
      udpPort: (original.udpPort || original.port + 1) + 2,
      createdAt: now,
      updatedAt: now,
      lastStarted: undefined,
      iniSettings: {
        ...original.iniSettings,
        DefaultPort: original.port + 2,
        ResetID: Math.floor(Math.random() * 999999999),
        ServerPlayerID: Math.floor(Math.random() * 999999999),
      },
    }

    profiles.push(duplicate)
    saveProfiles(profiles)
    return duplicate
  })
}

export { DEFAULT_INI_SETTINGS, DEFAULT_SANDBOX_SETTINGS }

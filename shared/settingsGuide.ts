// Plain-English names and explanations for the settings people actually change, and which
// tab each setting goes in. Everything else shows the game's own description. Keys are
// paths joined with dots, the way gameConfig's pathKey writes them.

export interface GuideEntry {
  label: string
  help?: string
}

export interface SettingsTab {
  id: string
  label: string
  match: (key: string) => boolean
}

const any = (...patterns: RegExp[]) => (key: string) => patterns.some(p => p.test(key))
const list = (...keys: string[]) => (key: string) => keys.includes(key)

const LOOT_HELP = '0 = none at all, 0.6 = the game\'s usual amount, 1 = normal, 2 = common, 3 = abundant, 4 = everywhere.'

export const SANDBOX_GUIDE: Record<string, GuideEntry> = {
  Zombies: { label: 'How many zombies', help: 'The overall zombie count. Picking one also sets "Population multiplier" on the Zombie population tab.' },
  ZombieRespawn: { label: 'New zombies over time', help: 'How often new zombies get added to the world. None means an area you clear out stays clear.' },
  'ZombieLore.Speed': { label: 'Zombie speed', help: 'Shamblers walk, fast shamblers jog, sprinters run at full speed. Random mixes them, and "Sprinter percentage" says how many of those sprint.' },
  'ZombieLore.SprinterPercentage': { label: 'Sprinter percentage', help: 'Only used when zombie speed is Random.' },
  'ZombieLore.Strength': { label: 'Zombie strength', help: 'How hard they hit and how fast they break through doors and walls.' },
  'ZombieLore.Toughness': { label: 'Zombie toughness', help: 'How many hits it takes to put one down.' },
  'ZombieLore.Transmission': { label: 'How the infection spreads', help: 'Blood and saliva: bites, scratches and cuts from zombies can infect you. Saliva only: only bites. Everyone\'s infected: everyone turns into a zombie when they die, however they die. None: zombies can\'t infect you.' },
  'ZombieLore.Mortality': { label: 'Time from infection to death', help: 'How long you have once you\'re infected.' },
  'ZombieLore.Reanimate': { label: 'Time until the dead get back up', help: 'How long an infected body lies there before it rises as a zombie.' },
  'ZombieLore.Cognition': { label: 'Zombie smarts', help: '"Navigate and use doors" means zombies can open doors.' },
  'ZombieLore.Memory': { label: 'Zombie memory', help: 'How long they keep chasing you once you\'re out of sight.' },
  'ZombieConfig.PopulationMultiplier': { label: 'Population multiplier', help: 'The exact zombie count behind "How many zombies". Normal is 0.65.' },
  'ZombieConfig.PopulationPeakDay': { label: 'Peak day', help: 'The zombie count grows from the start amount to the peak amount by this in-game day.' },
  'ZombieConfig.RespawnHours': { label: 'Respawn after (hours)', help: 'In-game hours before zombies can come back to an area. 0 = they never respawn.' },
  DayLength: { label: 'Day length', help: 'How long a full in-game day takes in real time. Longer days give you more time to get things done each day.' },
  StartMonth: { label: 'Start month', help: 'Winter starts are much harder: it\'s cold and nothing grows.' },
  TimeSinceApo: { label: 'Months since the outbreak', help: 'Start later into the apocalypse: more overgrown, more food already rotten. Doesn\'t change the start date.' },
  WaterShut: { label: 'Water shuts off', help: 'When taps stop working for good. Disabled keeps water on forever.' },
  ElecShut: { label: 'Power shuts off', help: 'When the power goes off for good. Disabled keeps it on forever.' },
  FoodLootNew: { label: 'Food (fresh)', help: LOOT_HELP },
  CannedFoodLootNew: { label: 'Canned and dried food', help: LOOT_HELP },
  WeaponLootNew: { label: 'Melee weapons', help: LOOT_HELP },
  RangedWeaponLootNew: { label: 'Guns', help: LOOT_HELP },
  AmmoLootNew: { label: 'Ammo', help: LOOT_HELP },
  MedicalLootNew: { label: 'Medical', help: LOOT_HELP },
  LiteratureLootNew: { label: 'Books and magazines', help: LOOT_HELP },
  SkillBookLoot: { label: 'Skill books', help: LOOT_HELP },
  ToolLootNew: { label: 'Tools', help: LOOT_HELP },
  MaterialLootNew: { label: 'Building materials', help: LOOT_HELP },
  HoursForLootRespawn: { label: 'Loot respawns after (hours)', help: 'In-game hours before looted containers in towns fill up again. 0 = loot never comes back.' },
  MaximumLooted: { label: 'Already-looted buildings (%)', help: 'The chance that a building has already been picked over when you find it.' },
  'MultiplierConfig.Global': { label: 'XP speed', help: 'How fast skills level up. 1 = normal, 2 = twice as fast. Only applies when "Same XP speed for every skill" is on.' },
  'MultiplierConfig.GlobalToggle': { label: 'Same XP speed for every skill', help: 'Off = every skill uses its own speed from the list below.' },
  CharacterFreePoints: { label: 'Free trait points', help: 'Extra points to spend when making a character.' },
  StatsDecrease: { label: 'Hunger, thirst and tiredness', help: 'How fast they go up.' },
  InjurySeverity: { label: 'Injuries', help: 'How bad injuries are and how long they take to heal.' },
  Helicopter: { label: 'Helicopter event', help: 'A helicopter flies over a few days in and drags every zombie it passes along behind it.' },
  MetaEvent: { label: 'Distant noises', help: 'Gunshots and other sounds far away that pull zombies toward them.' },
  NightDarkness: { label: 'Night darkness' },
  Farming: { label: 'Crop growing speed' },
  NatureAbundance: { label: 'Foraging finds' },
  FireSpread: { label: 'Fire spreads', help: 'Off = fires stay where they started.' },
  StarterKit: { label: 'Starter kit', help: 'New characters spawn with a few basic supplies.' },
  EnableVehicles: { label: 'Cars' },
  CarSpawnRate: { label: 'How many cars' },
  'Map.AllowMiniMap': { label: 'Minimap', help: 'Show a small map in the corner of the screen.' },
  'Map.MapAllKnown': { label: 'Whole map revealed', help: 'Everyone starts knowing the whole map instead of uncovering it as they explore.' },
}

// shown first, the handful that changes how the game plays
export const SANDBOX_POPULAR = [
  'Zombies', 'ZombieLore.Speed', 'ZombieLore.Transmission', 'ZombieLore.Toughness', 'ZombieRespawn',
  'DayLength', 'StartMonth', 'WaterShut', 'ElecShut', 'FoodLootNew', 'RangedWeaponLootNew', 'AmmoLootNew',
  'HoursForLootRespawn', 'MultiplierConfig.Global', 'MultiplierConfig.GlobalToggle', 'CharacterFreePoints',
  'Helicopter', 'StarterKit', 'Map.AllowMiniMap',
]

export const SANDBOX_TABS: SettingsTab[] = [
  { id: 'zombies', label: 'Zombies', match: any(/^Zombie(s|Respawn|Migrate|VoronoiNoise|AttractionMultiplier|HealthImpact)$/, /^ZombieLore\./, /^Distribution$/) },
  { id: 'population', label: 'Zombie population', match: any(/^ZombieConfig\./) },
  { id: 'loot', label: 'Loot', match: any(/Loot/, /LootFactor$/, /^Rolls/, /^(WorldItemRemovalList|HoursForWorldItemRemoval|ItemRemovalListBlacklistToggle|RuralLooted|GeneratorSpawning)$/, /Looted|DiminishedLoot/) },
  { id: 'world', label: 'Time & world', match: any(/^(DayLength|Start\w+|DayNightCycle|ClimateCycle|FogCycle|TimeSinceApo|Temperature|Rain|ErosionSpeed|ErosionDays|NightDarkness|NightLength|MaxFogIntensity|MaxRainFxIntensity|EnableSnowOnGround)$/, /^(WaterShut|ElecShut|AlarmDecay)/, /^(Alarm|LockedHouses|Helicopter|MetaEvent|SleepingEvent|SurvivorHouseChance|VehicleStoryChance|ZoneStoryChance|AnnotatedMapChance|MaximumRatIndex|DaysUntilMaximumRatIndex|ClayLakeChance|ClayRiverChance)$/, /^(Map|Basement)\./) },
  { id: 'character', label: 'Character & skills', match: any(/^MultiplierConfig\./, /^(CharacterFreePoints|ConstructionBonusPoints|StatsDecrease|Nutrition|InjurySeverity|BoneFracture|EndRegen|MuscleStrainFactor|DiscomfortFactor|WoundInfectionFactor|NegativeTraitsPenalty|AllClothesUnlocked|NoBlackClothes|EasyClimbing|MetaKnowledge|SeeNotLearntRecipe|LiteratureCooldown|MinutesPerPage|DecayingCorpseHealthImpact|BloodLevel|ClothingDegradation|MultiHitZombies|RearVulnerability|AttackBlockMovements|EnableTaintedWaterText|EnablePoisoning|StarterKit)$/, /^LevelFor/, /^Firearm/) },
  { id: 'nature', label: 'Farming, food & animals', match: any(/^(Farming|CompostTime|NatureAbundance|PlantResilience|PlantAbundance|KillInsideCrops|PlantGrowingSeasons|PlaceDirtAboveground|FarmingSpeedNew|FarmingAmountNew|FoodRotSpeed|FridgeFactor|DaysForRottenFoodRemoval|FishAbundance|MaggotSpawn)$/, /^Animal/) },
  { id: 'buildings', label: 'Buildings, fire & power', match: any(/^(FireSpread|MaximumFireFuelHours|AllowExteriorGenerator|LightBulbLifespan|HoursForCorpseRemoval|BloodSplatLifespanDays)$/, /^Generator/) },
  { id: 'vehicles', label: 'Vehicles', match: any(/^(EnableVehicles|CarSpawnRate|VehicleEasyUse|InitialGas|LockedCar|CarGasConsumption|CarGeneralCondition|CarDamageOnImpact|DamageToPlayerFromHitByACar|TrafficJam|CarAlarm|PlayerDamageFromCrash|SirenShutoffHours|ChanceHasGas|RecentlySurvivorVehicles|SirenEffectsZombies|EnableTrailerHitch)$/, /^FuelStation/) },
]

export const INI_GUIDE: Record<string, GuideEntry> = {
  PVP: { label: 'PvP', help: 'Players can hurt and kill each other.' },
  PauseEmpty: { label: 'Pause when nobody\'s on', help: 'Time stops while the server is empty, so food doesn\'t rot and the power doesn\'t go off while everyone\'s away.' },
  Open: { label: 'Anyone can make an account', help: 'Anyone with the address (and the join password, if there is one) can make an account. Off = only accounts an admin made can get in.' },
  MaxAccountsPerUser: { label: 'Accounts per player', help: 'How many accounts one Steam account can make. 0 = no limit.' },
  SaveWorldEveryMinutes: { label: 'Save every (minutes)', help: 'How often the world is saved while running. 0 = only when it shuts down.' },
  SleepAllowed: { label: 'Players can sleep' },
  SleepNeeded: { label: 'Players need sleep', help: 'In multiplayer, sleeping doesn\'t speed up time.' },
  PlayerSafehouse: { label: 'Players can claim safehouses' },
  AdminSafehouse: { label: 'Only admins can claim safehouses' },
  SafehouseAllowTrepass: { label: 'Others can walk into safehouses' },
  SafehouseAllowLoot: { label: 'Others can take things from safehouses' },
  SafehouseAllowFire: { label: 'Fire can damage safehouses' },
  SafehouseAllowRespawn: { label: 'Respawn in your safehouse', help: 'After dying, new characters can start in their safehouse.' },
  NoFire: { label: 'No fire at all', help: 'Fire can\'t start anywhere.' },
  AnnounceDeath: { label: 'Announce deaths in chat' },
  SpawnItems: { label: 'Starting items', help: 'Items every new character starts with, written like Base.Axe,Base.Bag_BigHikingBag.' },
  GlobalChat: { label: 'Global chat', help: 'Everyone can talk to everyone in chat, not just people nearby.' },
  VoiceEnable: { label: 'Voice chat' },
  SafetySystem: { label: 'PvP safety switch', help: 'Players can turn their own PvP on and off (the skull button).' },
  Faction: { label: 'Factions', help: 'Players can make factions with a tag next to their names.' },
  UPnP: { label: 'UPnP', help: 'Asks your router to open the server\'s ports by itself. Works on a lot of home routers.' },
  DoLuaChecksum: { label: 'Check game files match', help: 'Kicks players whose game or mod files don\'t match the server. Leave it on.' },
  BackupsCount: { label: 'Game backups to keep', help: 'The game\'s own backups. The app also makes its own (Settings → Keep it running).' },
  PublicDescription: { label: 'Public description' },
  ServerWelcomeMessage: { label: 'Welcome message' },
}

export const INI_POPULAR = [
  'PVP', 'PauseEmpty', 'Open', 'SaveWorldEveryMinutes', 'SleepAllowed', 'SleepNeeded', 'PlayerSafehouse',
  'SafehouseAllowTrepass', 'SafehouseAllowLoot', 'NoFire', 'AnnounceDeath', 'SpawnItems', 'GlobalChat', 'VoiceEnable', 'Faction',
]

// set elsewhere in the app (server page, Mods tab) or by the app itself
export const INI_HIDDEN = new Set([
  'Mods', 'WorkshopItems', 'Map', 'DefaultPort', 'UDPPort', 'Password', 'MaxPlayers', 'PublicName',
  'ResetID', 'ServerPlayerID', 'RCONPassword', 'RCONPort',
])

export const INI_TABS: SettingsTab[] = [
  { id: 'players', label: 'Players & joining', match: any(/^(Open|MaxAccountsPerUser|AllowCoop|DropOffWhiteListAfterDeath|AutoCreateUserInWhiteList|LoginQueue\w*|PingLimit|DenyLoginOnOverloadedServer|AllowNonAsciiUsername|DisplayUserName|ShowFirstAndLastName|UsernameDisguises|HideDisguisedUserName|MouseOverToSeeDisplayName|HidePlayersBehindYou|HideAdminsInPlayerList|DisableScoreboard|SteamScoreboard|SpawnPoint|SpawnItems|PlayerRespawnWith\w+|ServerWelcomeMessage|Public|PublicDescription|server_browser_announced_ip|UPnP|SteamVAC|MapRemotePlayerVisibility|ShowCoordinates)$/) },
  { id: 'gameplay', label: 'Gameplay', match: any(/^(PauseEmpty|SleepAllowed|SleepNeeded|KnockedDownAllowed|SneakModeHideFromOtherPlayers|NoFire|AnnounceDeath|AnnounceAnimalDeath|SpeedLimit|CarEngineAttractionModifier|PlayerBumpPlayer|FastForwardMultiplier|UltraSpeedDoesnotAffectToAnimals|AllowDestructionBySledgehammer|SledgehammerOnlyInSafehouse|ItemNumbersLimitPerContainer|TrashDeleteAll|BloodSplatLifespanDays|RemovePlayerCorpsesOnCorpseRemoval|UsePhysicsHitReaction|Seed|SafehousePreventsLootRespawn)$/, /^Disable\w*Towing$/) },
  { id: 'pvp', label: 'PvP', match: any(/^PVP/, /^Safety/, /^ShowSafety$/, /^War/) },
  { id: 'safehouses', label: 'Safehouses & factions', match: any(/safe ?house/i, /^MaxSafezoneSize$/, /^Faction/) },
  { id: 'chat', label: 'Chat & voice', match: any(/Chat/, /^Voice/, /^DisableRadio/, /WordList|BadWord/, /^BanKickGlobalSound$/, /^Discord/, /^WebhookAddress$/) },
  { id: 'saves', label: 'Saving & backups', match: any(/^SaveWorld/, /^Backups/) },
  { id: 'admin', label: 'Admin & anti-cheat', match: any(/^AntiCheat/, /^(DoLuaChecksum|ClientCommandFilter|ClientActionLogs|PerkLogs|MaxPacketsPerSecond|MultiplayerStatisticsPeriod|KickFastPlayers|SwitchZombiesOwnershipEachUpdate)$/) },
]

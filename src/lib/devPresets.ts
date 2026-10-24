// Full server setups (mods + server settings + sandbox) the developer actually plays on.
// Generated from a real profile with passwords, ports and per-world ids left out;
// the create-server wizard fills those in fresh.
//
// localMods are fix mods from the repo's local-mods/ folder. The app copies them into
// Zomboid\mods when a server is made from the preset; players run local-mods/install.ps1.
import type { ModEntry } from '../store/useAppStore'

export interface DevPreset {
  key: string
  label: string
  description: string
  buildVersion: 'b41' | 'b42'
  maxPlayers: number
  localMods: string[]
  mods: ModEntry[]
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
}

export const DEV_PRESETS: DevPreset[] = [
  {
    "key": "van",
    "label": "VAN",
    "description": "RV interiors (PROJECT RV + expansions), KI5 vans/campers/trailers, military vehicles, Firearms B42, Bandits NPCs and the Frockin clothing packs.",
    "buildVersion": "b42",
    "maxPlayers": 8,
    "localMods": [
      "2256623447/firearmmod",
      "RVInteriorGMCVans"
    ],
    "mods": [
      {
        "workshopId": "3543229299",
        "modId": "PROJECTRVInterior42",
        "name": "[B42]Project RV Interior",
        "maps": [
          "map_distanciado"
        ]
      },
      {
        "workshopId": "2256623447",
        "modId": "firearmmod",
        "name": "Firearms"
      },
      {
        "workshopId": "",
        "modId": "2256623447/firearmmod",
        "name": "Firearms B42 - Legacy ID Shim (local)",
        "requires": [
          "firearmmod"
        ]
      },
      {
        "workshopId": "3622163276",
        "modId": "RVInteriorExpansionPart2",
        "name": "RV Interior Expansion Part 2 [B42]",
        "requires": [
          "PROJECTRVInterior42"
        ],
        "maps": [
          "rv2"
        ]
      },
      {
        "workshopId": "3618427553",
        "modId": "RVInteriorExpansion",
        "name": "RV Interior Expansion [B42]",
        "requires": [
          "PROJECTRVInterior42"
        ],
        "maps": [
          "rvupdate"
        ]
      },
      {
        "workshopId": "3614959302",
        "modId": "RVmilitaryaddon",
        "name": "RV Military Addon [B42]",
        "requires": [
          "PROJECTRVInterior42"
        ],
        "maps": [
          "map_rv"
        ]
      },
      {
        "workshopId": "",
        "modId": "RVInteriorGMCVans",
        "name": "RV Interior - '83 GMC Vans (local)",
        "requires": [
          "PROJECTRVInterior42",
          "83gmcGseriesVans"
        ]
      },
      {
        "workshopId": "3268487204",
        "modId": "Bandits2",
        "name": "[B42] Bandits NPC"
      },
      {
        "workshopId": "3474469914",
        "modId": "BanditsFirearms;BanditsFrockin",
        "name": "[B42] Bandits Expansion Pack",
        "requires": [
          "2256623447/firearmmod",
          "GanydeBielovzki's Frockin Splendor!",
          "GanydeBielovzki's Frockin Splendor! Vol.2",
          "GanydeBielovzki's Frockin Splendor! Vol.3"
        ]
      },
      {
        "workshopId": "3796483217",
        "modId": "NPCBases",
        "name": "NPC Bases (Bandits Settlements)",
        "requires": [
          "Bandits2"
        ]
      },
      {
        "workshopId": "3808944882",
        "modId": "SurvivorBriefing",
        "name": "Survivor Briefing"
      },
      {
        "workshopId": "3814073243",
        "modId": "ZombieVisibilityFix",
        "name": "Zombie Visibility Fix + Stair-O-Vision"
      },
      {
        "workshopId": "3784847437",
        "modId": "traitsAsSkills",
        "name": "Traits As Skills"
      },
      {
        "workshopId": "3799732653",
        "modId": "83gmcGseriesVans;83gmcVanduraATeam",
        "name": "'83 GMC G-Series Vans",
        "requires": [
          "damnlib",
          "83gmcGseriesVans"
        ]
      },
      {
        "workshopId": "3171167894",
        "modId": "damnlib",
        "name": "that DAMN Library"
      },
      {
        "workshopId": "3402491515",
        "modId": "tsarslib",
        "name": "Tsar's Common Library B42"
      },
      {
        "workshopId": "2705406713",
        "modId": "Military_Tool_Kit",
        "name": "Military Tool Kit"
      },
      {
        "workshopId": "2870394916",
        "modId": "86fordE150;86fordE150expanded;86fordE150dnd;86fordE150mm;86fordE150pd",
        "name": "'86 Ford Econoline E-150 + Pop Culture vans",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3614034284",
        "modId": "85chevyStepVan;85chevyStepVanexpanded",
        "name": "'85 Chevrolet Step-Van",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3570973322",
        "modId": "89defender",
        "name": "'89 LAND ROVER Defender",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2952802178",
        "modId": "90fordF350ambulance",
        "name": "'90 Ford F350 Ambulance",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2969343830",
        "modId": "93fordElgin",
        "name": "'93 Ford CF8000 Elgin Street Sweeper",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3110911330",
        "modId": "87fordB700",
        "name": "'87 Ford B700/F700 Trucks",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3330403100",
        "modId": "KI5trailers",
        "name": "Trailers!",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2625625421",
        "modId": "isoContainers",
        "name": "Containers!",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3670064951",
        "modId": "KI5campers",
        "name": "Campers!",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3608725379",
        "modId": "U.S. M41 Walker Bulldog by Papa_Chad",
        "name": "U.S. M41 Walker Bulldog by Papa_Chad",
        "requires": [
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "3598575779",
        "modId": "U.S. M163 VADS by Papa_Chad by Papa_Chad",
        "name": "U.S. M163 VADS by Papa_Chad",
        "requires": [
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "2705655822",
        "modId": "U.S.M113_APC_by_Papa_Chad",
        "name": "U.S. M113 APC by Papa_Chad",
        "requires": [
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "3635550823",
        "modId": "R.U. BMP-2 by Papa_Chad",
        "name": "R.U. BMP-2 by Papa_Chad",
        "requires": [
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "3661387277",
        "modId": "R.U. BTR-80 by Papa_Chad",
        "name": "R.U. BTR-80 by Papa_Chad",
        "requires": [
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "3541349730",
        "modId": "Vodnik",
        "name": "GAZ-3937 Vodnik [B41/B42]"
      },
      {
        "workshopId": "2897390033",
        "modId": "97bushmaster",
        "name": "'97 ADI Bushmaster",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2566953935",
        "modId": "86oshkoshP19A",
        "name": "'86 Oshkosh P19A + Military Trailers",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2618213077",
        "modId": "82oshkoshM911",
        "name": "'82 Oshkosh M911 + Military Semi-Trailers",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3428008364",
        "modId": "86chevyCUCV",
        "name": "'86 Chevrolet CUCVs + M101A2 Trailer",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "2478247379",
        "modId": "67commando",
        "name": "'67 Cadillac Gage Commando",
        "requires": [
          "damnlib"
        ]
      },
      {
        "workshopId": "3402789975",
        "modId": "[B42] Tatrapan",
        "name": "Tatrapan [B42]",
        "requires": [
          "tsarslib"
        ]
      },
      {
        "workshopId": "3666236550",
        "modId": "'93 OT-64 SKOT",
        "name": "OT-64 SKOT",
        "requires": [
          "tsarslib",
          "Military_Tool_Kit"
        ]
      },
      {
        "workshopId": "3431256608",
        "modId": "GanydeBielovzki's Frockin Splendor! Vol.3",
        "name": "[B42MP] Frockin Splendor! Vol.3",
        "requires": [
          "GanydeBielovzki's Frockin Backstage!"
        ]
      },
      {
        "workshopId": "3307376332",
        "modId": "GanydeBielovzki's Frockin Splendor!",
        "name": "[B42MP] Frockin Splendor! Vol.1"
      },
      {
        "workshopId": "3475347500",
        "modId": "GanydeBielovzki's Frockin Splendor! Vol.4",
        "name": "[B42MP] Frockin Splendor! Vol.4",
        "requires": [
          "GanydeBielovzki's Frockin Backstage!"
        ]
      },
      {
        "workshopId": "3635394848",
        "modId": "GanydeBielovzki's Frockin Splendor! Vol.5",
        "name": "[B42MP] Frockin Splendor! Vol.5",
        "requires": [
          "GanydeBielovzki's Frockin Backstage!"
        ]
      },
      {
        "workshopId": "3411888105",
        "modId": "GanydeBielovzki's Frockin Splendor! Vol.2",
        "name": "[B42MP] Frockin Splendor! Vol.2",
        "requires": [
          "GanydeBielovzki's Frockin Backstage!"
        ]
      },
      {
        "workshopId": "3798149669",
        "modId": "GanydeBielovzki's Frockin Splendor! Vol.6",
        "name": "[B42MP] Frockin Splendor! Vol.6",
        "requires": [
          "GanydeBielovzki's Frockin Backstage!"
        ]
      },
      {
        "workshopId": "3401576145",
        "modId": "FMR",
        "name": "[B42]Firearm Models: Redux"
      },
      {
        "workshopId": "3798146388",
        "modId": "GanydeBielovzki's Frockin Backstage!",
        "name": "[B42MP] Frockin Backstage!"
      },
      {
        "workshopId": "3822394653",
        "modId": "BanditsFirearmsPatch",
        "name": "Bandits Firearms Fix"
      },
      {
        "workshopId": "3423660713",
        "modId": "ModLoadOrderSorter_b42",
        "name": "Mod Load Order Sorter [b42]"
      }
    ],
    "iniSettings": {
      "PVP": false,
      "PauseEmpty": true,
      "GlobalChat": true,
      "Open": true,
      "MaxPlayers": 8,
      "Public": false,
      "ServerWelcomeMessage": "Welcome to Project Zomboid!",
      "AutoCreateUserInWhiteList": false,
      "DisplayUserName": true,
      "ShowFirstAndLastName": false,
      "SpawnPoint": "0,0,0",
      "SafetySystem": true,
      "ShowSafety": true,
      "SafetyToggleTimer": 2,
      "SafetyCooldownTimer": 3,
      "SpawnItems": "",
      "Map": "Muldraugh, KY",
      "DoLuaChecksum": false,
      "DenyLoginOnOverloadedServer": true,
      "PingFrequency": 10,
      "PingLimit": 250,
      "HoursForLootRespawn": 0,
      "MaxItemsForLootRespawn": 4,
      "ConstructionPreventsLootRespawn": true,
      "DropOffWhiteListAfterDeath": false,
      "NoFire": false,
      "AnnounceDeath": true,
      "MinutesPerPage": 1,
      "SaveWorldEveryMinutes": 0,
      "PlayerSafehouse": true,
      "AdminSafehouse": false,
      "SafehouseAllowTrepass": true,
      "SafehouseAllowFire": true,
      "SafehouseAllowLoot": true,
      "SafehouseAllowRespawn": false,
      "SafehouseDaySurvivedToClaim": 0,
      "SafeHouseRemovalTime": 144,
      "AllowDestructionBySledgehammer": true,
      "KickFastPlayers": false,
      "SleepAllowed": false,
      "SleepNeeded": false,
      "SteamScoreboard": true,
      "SteamVAC": true,
      "UPnP": true,
      "VoiceEnable": true,
      "VoiceComplexity": 5,
      "VoicePeriod": 20,
      "VoiceSampleRate": 24000,
      "VoiceBuffering": 8000,
      "VoiceMinDistance": 10,
      "VoiceMaxDistance": 300,
      "Voice3D": true,
      "Faction": true,
      "FactionDaySurvivedToCreate": 0,
      "FactionPlayersRequiredForTag": 1,
      "AllowTradeUI": true,
      "MaxAccountsPerUser": 0,
      "PlayerRespawnWithSelf": false,
      "PlayerRespawnWithOther": false,
      "FastForwardMultiplier": 40,
      "PlayerSaveOnDamage": true,
      "DisableSafehouseWhenPlayerConnected": false,
      "BloodSplatLifespanDays": 0,
      "AllowNonAsciiUsername": false,
      "BanKickGlobalSound": true,
      "RemovePlayerCorpsesOnCorpseRemoval": false,
      "TrashDeleteAll": false,
      "PVPMeleeWhileHitReaction": false,
      "MouseOverToSeeDisplayName": true,
      "HidePlayersBehindYou": true,
      "PVPMeleeDamageModifier": 30,
      "PVPFirearmDamageModifier": 50,
      "CarEngineAttractionModifier": 0.5,
      "PlayerBumpPlayer": false,
      "HoursForWorldItemRemoval": 0,
      "WorldItemRemovalList": "Base.Vest,Base.Shirt,Base.Blouse,Base.Skirt,Base.Shoes",
      "ItemNumbersLimitPerContainer": 0,
      "SpeedLimit": 70
    },
    "sandboxSettings": {
      "VERSION": 4,
      "Zombies": 4,
      "Distribution": 1,
      "DayLength": 3,
      "StartYear": 1,
      "StartMonth": 7,
      "StartDay": 1,
      "StartTime": 2,
      "WaterShut": 2,
      "ElecShut": 2,
      "WaterShutModifier": 14,
      "ElecShutModifier": 14,
      "FoodLoot": 4,
      "WeaponLoot": 3,
      "OtherLoot": 3,
      "CannedFoodLoot": 4,
      "LiteratureLoot": 4,
      "SurvivalGearsLoot": 4,
      "MedicalLoot": 4,
      "RangedWeaponLoot": 2,
      "AmmoLoot": 2,
      "MechanicsLoot": 4,
      "Temperature": 3,
      "Rain": 3,
      "ErosionSpeed": 3,
      "ErosionDays": 0,
      "XpMultiplier": 1,
      "XpMultiplierAffectsPassive": false,
      "ZombieAttractionMultiplier": 1,
      "VehicleEasyUse": false,
      "Farming": 3,
      "CompostTime": 2,
      "StatsDecrease": 3,
      "NatureAbundance": 3,
      "Alarm": 6,
      "LockedHouses": 6,
      "StarterKit": false,
      "Nutrition": true,
      "FoodRotSpeed": 3,
      "FridgeFactor": 3,
      "LootRespawn": 1,
      "SeenHoursPreventLootRespawn": 0,
      "WorldItemRemovalList": "\"Base.Hat,Base.Glasses,Base.Maggots\"",
      "HoursForWorldItemRemoval": 24,
      "ItemRemovalListBlacklistToggle": false,
      "TimeSinceApo": 1,
      "PlantResilience": 3,
      "PlantAbundance": 3,
      "EndRegen": 3,
      "Helicopter": 2,
      "MetaEvent": 2,
      "SleepingEvent": 1,
      "GeneratorSpawning": 3,
      "GeneratorFuelConsumption": 1,
      "SurvivorHouseChance": 3,
      "VehicleStoryChance": 3,
      "ZoneStoryChance": 3,
      "AnnotatedMapChance": 4,
      "CharacterFreePoints": 0,
      "ConstructionBonusPoints": 3,
      "NightDarkness": 3,
      "NightLength": 3,
      "InjurySeverity": 2,
      "BoneFracture": true,
      "HoursForCorpseRemoval": 216,
      "DecayingCorpseHealthImpact": 3,
      "BloodLevel": 3,
      "ClothingDegradation": 3,
      "FireSpread": true,
      "DaysForRottenFoodRemoval": -1,
      "AllowExteriorGenerator": true,
      "MaxFogIntensity": 1,
      "MaxRainFxIntensity": 1,
      "EnableSnowOnGround": true,
      "MultiHitZombies": false,
      "RearVulnerability": 3,
      "AttackBlockMovements": true,
      "AllClothesUnlocked": false,
      "EnableTaintedWaterText": true,
      "CarSpawnRate": 3,
      "ChanceHasGas": 4,
      "InitialGas": 4,
      "CarGasConsumption": 1,
      "LockedCar": 4,
      "CarHotwire": 4,
      "CarConditionAffectsStat": 3,
      "CarDamageOnImpact": 3,
      "DamageToPlayerFromHitByACar": 3,
      "EnableVehicles": true,
      "EnableTrailerHitch": true,
      "AnimalPopulationMultiplier": 1,
      "AnimalPopulationStartMultiplier": 1,
      "AnimalPopulationPeakMultiplier": 1.5,
      "AnimalPopulationPeakDay": 28,
      "AnimalChanceSpawnOnFarm": 1,
      "AgingModifierSpeed": 1,
      "MilkIncreaseSpeed": 1,
      "WoolIncreaseSpeed": 1,
      "CraftMultiplier": 1,
      "MaxCraftableItemsOnGround": 0,
      "ZombieConfig": {
        "PopulationMultiplier": 1,
        "PopulationStartMultiplier": 1,
        "PopulationPeakMultiplier": 1.5,
        "PopulationPeakDay": 28,
        "RespawnHours": 0,
        "RespawnUnseenHours": 16,
        "RespawnMultiplier": 0.1,
        "RedistributeHours": 12,
        "FollowSoundDistance": 100,
        "RallyGroupSize": 20,
        "RallyTravelDistance": 20,
        "RallyGroupSeparation": 15,
        "RallyGroupRadius": 3,
        "Speed": 3,
        "Strength": 2,
        "Toughness": 2,
        "Transmission": 2,
        "Intelligence": 2,
        "CrawlUnderVehicle": 1,
        "Memory": 2,
        "Decomp": 1,
        "Sight": 2,
        "Hearing": 2,
        "Smell": 2,
        "ThumpNoChasing": false,
        "ThumpOnConstruction": true,
        "ActiveOnly": false,
        "TriggerHouseAlarm": false,
        "ZombiesDontAttackUnlessThreatened": false,
        "DisableFakeDead": false
      }
    }
  },
]

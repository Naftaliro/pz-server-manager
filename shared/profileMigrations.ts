// Fixes for profiles saved by older versions of the app

import { isTree } from './gameConfig'
import type { SettingsTree } from './gameConfig'

// Up to 1.6.0 every profile got these filled in (B41 values) whether or not anyone picked
// them, and they went into SandboxVars.lua on every start. On B42 some override the game's
// own defaults with values that mean something else there (or nothing at all).
const OLD_SANDBOX_DEFAULTS: SettingsTree = {
  VERSION: 4, Zombies: 4, Distribution: 1, DayLength: 3, StartYear: 1, StartMonth: 7, StartDay: 1, StartTime: 2,
  WaterShut: 2, ElecShut: 2, WaterShutModifier: 14, ElecShutModifier: 14, FoodLoot: 4, WeaponLoot: 2, OtherLoot: 3,
  CannedFoodLoot: 4, LiteratureLoot: 4, SurvivalGearsLoot: 4, MedicalLoot: 4, RangedWeaponLoot: 2, AmmoLoot: 2,
  MechanicsLoot: 4, Temperature: 3, Rain: 3, ErosionSpeed: 3, ErosionDays: 0, XpMultiplier: 1, XpMultiplierAffectsPassive: false,
  ZombieAttractionMultiplier: 1, VehicleEasyUse: false, Farming: 3, CompostTime: 2, StatsDecrease: 3, NatureAbundance: 3,
  Alarm: 6, LockedHouses: 6, StarterKit: false, Nutrition: true, FoodRotSpeed: 3, FridgeFactor: 3, LootRespawn: 1,
  SeenHoursPreventLootRespawn: 0, WorldItemRemovalList: '"Base.Hat,Base.Glasses,Base.Maggots"', HoursForWorldItemRemoval: 24,
  ItemRemovalListBlacklistToggle: false, TimeSinceApo: 1, PlantResilience: 3, PlantAbundance: 3, EndRegen: 3, Helicopter: 2,
  MetaEvent: 2, SleepingEvent: 1, GeneratorSpawning: 3, GeneratorFuelConsumption: 1, SurvivorHouseChance: 3,
  VehicleStoryChance: 3, ZoneStoryChance: 3, AnnotatedMapChance: 4, CharacterFreePoints: 0, ConstructionBonusPoints: 3,
  NightDarkness: 3, NightLength: 3, InjurySeverity: 2, BoneFracture: true, HoursForCorpseRemoval: 216,
  DecayingCorpseHealthImpact: 3, BloodLevel: 3, ClothingDegradation: 3, FireSpread: true, DaysForRottenFoodRemoval: -1,
  AllowExteriorGenerator: true, MaxFogIntensity: 1, MaxRainFxIntensity: 1, EnableSnowOnGround: true, MultiHitZombies: false,
  RearVulnerability: 3, AttackBlockMovements: true, AllClothesUnlocked: false, EnableTaintedWaterText: true, CarSpawnRate: 3,
  ChanceHasGas: 4, InitialGas: 4, CarGasConsumption: 1, LockedCar: 4, CarHotwire: 4, CarConditionAffectsStat: 3,
  CarDamageOnImpact: 3, DamageToPlayerFromHitByACar: 3, EnableVehicles: true, EnableTrailerHitch: true,
  AnimalPopulationMultiplier: 1, AnimalPopulationStartMultiplier: 1, AnimalPopulationPeakMultiplier: 1.5,
  AnimalPopulationPeakDay: 28, AnimalChanceSpawnOnFarm: 1, AgingModifierSpeed: 1, MilkIncreaseSpeed: 1, WoolIncreaseSpeed: 1,
  CraftMultiplier: 1, MaxCraftableItemsOnGround: 0,
  ZombieConfig: {
    PopulationMultiplier: 1, PopulationStartMultiplier: 1, PopulationPeakMultiplier: 1.5, PopulationPeakDay: 28,
    RespawnHours: 72, RespawnUnseenHours: 16, RespawnMultiplier: 0.1, RedistributeHours: 12, FollowSoundDistance: 100,
    RallyGroupSize: 20, RallyTravelDistance: 20, RallyGroupSeparation: 15, RallyGroupRadius: 3, Speed: 3, Strength: 2,
    Toughness: 2, Transmission: 2, Intelligence: 2, CrawlUnderVehicle: 1, Memory: 2, Decomp: 1, Sight: 2, Hearing: 2,
    Smell: 2, ThumpNoChasing: false, ThumpOnConstruction: true, ActiveOnly: false, TriggerHouseAlarm: false,
    ZombiesDontAttackUnlessThreatened: false, DisableFakeDead: false,
  },
}

export const SANDBOX_SETTINGS_VERSION = 2

/**
 * Drop the values that are still exactly the old filled-in default, so the game's own
 * value applies. Nothing changes for a server that has started since: the game's file
 * already holds whatever those values turned into. Anything someone actually changed stays.
 */
export function dropOldSandboxDefaults(sandbox: SettingsTree, defaults: SettingsTree = OLD_SANDBOX_DEFAULTS): SettingsTree {
  const out: SettingsTree = {}
  for (const [k, v] of Object.entries(sandbox)) {
    const d = defaults[k]
    if (isTree(v)) {
      const inner = isTree(d) ? dropOldSandboxDefaults(v, d) : v
      if (Object.keys(inner).length > 0) out[k] = inner
    } else if (d === undefined || isTree(d) || d !== v) {
      out[k] = v
    }
  }
  return out
}

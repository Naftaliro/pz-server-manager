// Sandbox presets, shared by the create-server wizard and the sandbox editor.
// These mirror the game's own presets closely enough for a starting point.
export const PRESETS = {
  apocalypse: {
    label: 'Apocalypse',
    description: 'Lore-canon mode. Zombie respawn disabled, more firearms.',
    settings: {
      Zombies: 4, Distribution: 1, DayLength: 3, XpMultiplier: 1.0,
      FoodLoot: 4, WeaponLoot: 3, OtherLoot: 3,
      ZombieConfig: { Speed: 3, Strength: 2, Toughness: 2, RespawnHours: 0, PopulationMultiplier: 1.0 }
    }
  },
  outbreak: {
    label: 'Outbreak',
    description: 'Faster progression, more forgiving. Good for limited time.',
    settings: {
      Zombies: 3, Distribution: 1, DayLength: 3, XpMultiplier: 2.0,
      FoodLoot: 5, WeaponLoot: 4, OtherLoot: 4,
      ZombieConfig: { Speed: 3, Strength: 2, Toughness: 2, RespawnHours: 72, PopulationMultiplier: 0.75 }
    }
  },
  extinction: {
    label: 'Extinction',
    description: 'Veterans only. Sprinters, scarce supplies.',
    settings: {
      Zombies: 1, Distribution: 1, DayLength: 3, XpMultiplier: 1.0,
      FoodLoot: 2, WeaponLoot: 2, OtherLoot: 2,
      ZombieConfig: { Speed: 1, Strength: 1, Toughness: 1, RespawnHours: 72, PopulationMultiplier: 2.0 }
    }
  },
  rising: {
    label: 'Rising',
    description: 'Cozy apocalypse. More building materials, less combat pressure.',
    settings: {
      Zombies: 5, Distribution: 1, DayLength: 3, XpMultiplier: 1.5,
      FoodLoot: 5, WeaponLoot: 3, OtherLoot: 5,
      ZombieConfig: { Speed: 3, Strength: 3, Toughness: 3, RespawnHours: 72, PopulationMultiplier: 0.5 }
    }
  },
}

export type PresetKey = keyof typeof PRESETS

// friendlier wording for the wizard
export const PRESET_BLURBS: Record<PresetKey, string> = {
  apocalypse: 'The normal game. A good default if you are not sure.',
  outbreak: 'Easier. More loot, faster leveling, fewer zombies.',
  extinction: 'Hard. Sprinting zombies and not much loot.',
  rising: 'Relaxed building game. Lots of supplies, fewer zombies.',
}

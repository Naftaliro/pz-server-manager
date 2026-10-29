// Difficulty presets. The values come from the game's own preset files in the server
// install (media/lua/shared/Sandbox), so they always match the server's build.
import { parseSandbox, deepMerge, isTree, VANILLA_BLOCKS } from '../../shared/gameConfig'
import type { SettingsTree } from '../../shared/gameConfig'

export const PRESETS = {
  Apocalypse: { label: 'Apocalypse', blurb: 'The normal game. Cleared areas stay clear. A good default if you\'re not sure.' },
  Outbreak: { label: 'Outbreak', blurb: 'A bit easier. Power and water last longer, more tools and books, faster skills and farming.' },
  Extinction: { label: 'Extinction', blurb: 'Hard. More zombies that come back, some sprinters, tougher zombies and not much loot.' },
  Rising: { label: 'Rising', blurb: 'Relaxed building game. Few slow zombies, lots of materials and tools, a starter kit.' },
} as const

export type PresetKey = keyof typeof PRESETS

// file text -> the settings it sets (the file format version isn't a setting)
export function presetValues(text: string): SettingsTree {
  const { Version, VERSION, ...values } = parseSandbox(text).values
  return values
}

// Put a preset over a server's sandbox settings: every game setting is replaced, mod
// settings and anything the preset doesn't mention stay
export function applyPreset(current: SettingsTree, preset: SettingsTree): SettingsTree {
  const next: SettingsTree = { ...current }
  for (const block of VANILLA_BLOCKS) if (isTree(next[block]) && isTree(preset[block])) delete next[block]
  return deepMerge(next, preset)
}

export async function loadPresets(installPath?: string): Promise<Partial<Record<PresetKey, SettingsTree>>> {
  const files = await window.electronAPI.config.presets(installPath).catch(() => ({} as Record<string, string>))
  const out: Partial<Record<PresetKey, SettingsTree>> = {}
  for (const key of Object.keys(PRESETS) as PresetKey[]) if (files[key]) out[key] = presetValues(files[key])
  return out
}

// Ready-made modded servers: tested mod lists with the settings they need, so a new player
// can pick one, press Create and get a modded server that works.
//
// What's written by hand is here: which Workshop items (and which mods inside them), the
// fix mods from the repo's local-mods folder, and the settings. What's read from Steam and
// from the mods' own files (names, pictures, sizes, mod.info, the sorted load order, and
// the last test start) is in presetData.json, which scripts/verify-presets.mjs writes:
//
//   node scripts/verify-presets.mjs refresh   after changing a list here
//   node scripts/verify-presets.mjs verify    after each game update and before each release
//
// Settings: only what differs from the game's own defaults goes in. The sandbox values go on
// top of the difficulty the player picks (Apocalypse unless they change it).
import type { ModEntry } from '../store/useAppStore'
import type { ModInfo } from '../../shared/modCore'
import data from './presetData.json'

export interface PresetItem {
  workshopId: string
  // the mods inside the item to turn on (one item can hold several)
  mods: string[]
}

// a fix mod from local-mods/ (installed by the app, handed to friends in the server pack)
export interface PresetLocalMod {
  local: string
  name: string
}

export interface PresetCheck {
  // the game version the test start was on, and its Steam build id
  gameVersion: string
  buildId: string
  date: string
  ok: boolean
}

export interface ModdedPresetSource {
  key: string
  label: string
  // one line, what it is
  tagline: string
  // what it adds, a few short points
  adds: string[]
  buildVersion: 'b42'
  items: Array<PresetItem | PresetLocalMod>
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
}

export interface PresetMod extends ModEntry {
  // mod.info of the enabled mods, as the files were when the list was last refreshed
  infos?: ModInfo[]
}

export interface ModdedPreset extends Omit<ModdedPresetSource, 'items'> {
  // in load order. workshopId '' = a local fix mod
  mods: PresetMod[]
  // mod ids of the local fix mods
  localMods: string[]
  // everything the Workshop items add up to
  downloadBytes: number
  verified?: PresetCheck
}

interface PresetData {
  mods: PresetMod[]
  downloadBytes: number
  verified?: PresetCheck
}

// on every preset: a small group of friends playing together
const FRIENDS_INI = {
  // friends can claim a house (or a camp) as their group's safehouse
  PlayerSafehouse: true,
  // everyone sees it in chat when someone dies
  AnnounceDeath: true,
}

export const MODDED_PRESET_SOURCES: ModdedPresetSource[] = [
  {
    key: 'vanilla-plus',
    label: 'Vanilla+',
    tagline: 'The normal game with the fiddly bits smoothed out. The safe first modded server.',
    adds: [
      'Tidier item categories and sorting',
      'Marks on books and tapes you have already read',
      'One list for everything in the containers around you',
      'A small wound indicator, a kill counter and fuel left on gas pumps',
    ],
    buildVersion: 'b42',
    items: [
      { workshopId: '2313387159', mods: ['BetterSortCC'] }, // Better Sorting
      { workshopId: '2544353492', mods: ['P4HasBeenRead'] }, // Has Been Read
      { workshopId: '3716522633', mods: ['VHSSkillNameInTooltip'] }, // Show VHS skills in tooltip
      { workshopId: '2847184718', mods: ['ProximityInventory'] }, // Proximity Inventory
      { workshopId: '2650547917', mods: ['manageContainers'] }, // Manage Containers
      { workshopId: '2866258937', mods: ['MiniHealthPanel'] }, // Mini Health Panel
      { workshopId: '2553809727', mods: ['KillCount'] }, // KillCount
      { workshopId: '3755993986', mods: ['GasPumpIndicator'] }, // Gas Pump Indicator
      { workshopId: '2920899878', mods: ['ReloadAllMagazines'] }, // Reload All Magazines
      { workshopId: '2584112711', mods: ['FasterHoodOpening'] }, // Faster Hood Opening
      { workshopId: '2734705913', mods: ['MapSymbolSizeSlider'] }, // Map Symbol Size Slider
    ],
    iniSettings: { ...FRIENDS_INI },
    // nothing: the game as it is, with whatever difficulty was picked
    sandboxSettings: {},
  },
  {
    key: 'road-trip',
    label: 'Road Trip',
    tagline: 'Find a van or a camper, fix it up and hit the road. Watch out for bandits.',
    adds: [
      'RVs, vans and campers you can walk inside',
      "'83 GMC, '85 Step-Van and '86 Econoline vans, campers, trailers and a Land Rover Defender",
      'Real-world guns and ammo (Firearms)',
      'Armed bandit gangs and their camps (Bandits)',
      'Lots more clothing (Frockin Splendor!)',
    ],
    buildVersion: 'b42',
    items: [
      { workshopId: '3171167894', mods: ['damnlib'] }, // that DAMN Library (KI5's vehicles need it)
      { workshopId: '3543229299', mods: ['PROJECTRVInterior42'] }, // [B42] PROJECT RV Interior
      // more vehicles with interiors: the KI5 vans, step-vans, campers, trailers and the Defender
      { workshopId: '3618427553', mods: ['RVInteriorExpansion'] }, // RV Interior Expansion [B42]
      { workshopId: '3799732653', mods: ['83gmcGseriesVans', '83gmcVanduraATeam'] }, // '83 GMC G-Series Vans
      // PROJECT RV doesn't know the '83 GMC vans yet, this small fix gives them the van interior
      { local: 'RVInteriorGMCVans', name: "RV Interior - '83 GMC Vans (fix)" },
      { workshopId: '2870394916', mods: ['86fordE150', '86fordE150expanded', '86fordE150dnd', '86fordE150mm', '86fordE150pd'] }, // '86 Ford Econoline E-150 + Pop Culture vans
      { workshopId: '3614034284', mods: ['85chevyStepVan', '85chevyStepVanexpanded'] }, // '85 Chevrolet Step-Van
      { workshopId: '3670064951', mods: ['KI5campers'] }, // Campers!
      { workshopId: '3330403100', mods: ['KI5trailers'] }, // Trailers!
      { workshopId: '3570973322', mods: ['89defender'] }, // '89 LAND ROVER Defender
      { workshopId: '2256623447', mods: ['firearmmod'] }, // Firearms
      // Bandits arms its gangs with Firearms guns by itself when both are on
      { workshopId: '3268487204', mods: ['Bandits2'] }, // [B42] Bandits NPC
      { workshopId: '3796483217', mods: ['NPCBases'] }, // NPC Bases (Bandits Settlements)
      { workshopId: '3798146388', mods: ["GanydeBielovzki's Frockin Backstage!"] }, // [B42MP] Frockin Backstage!
      { workshopId: '3307376332', mods: ["GanydeBielovzki's Frockin Splendor!"] }, // [B42MP] Frockin Splendor! Vol.1
    ],
    iniSettings: {
      ...FRIENDS_INI,
      ServerWelcomeMessage: 'Road Trip: find a van, an RV or a camper and hit the road. To step inside one, stand next to it, press V and pick "Get in RV". Watch out for bandits.',
    },
    sandboxSettings: {
      // a road trip needs cars: Normal instead of the default Low
      CarSpawnRate: 4,
      // more of them have fuel (High instead of Normal), and a bit more in the tank (Normal instead of Low)
      ChanceHasGas: 3,
      InitialGas: 3,
      // a few more cars that survivors kept in good shape (Normal instead of Low)
      RecentlySurvivorVehicles: 3,
      Map: {
        // a minimap in the corner helps on the road
        AllowMiniMap: true,
      },
    },
  },
  {
    key: 'homestead',
    label: 'Homestead',
    tagline: 'Settle down together: fix up a base, farm, and keep animals.',
    adds: [
      'Sheets that fit windows, doors and fences, and neater barricades',
      'When to plant each seed, and a better livestock panel and hutches',
      'Propane exchange cabinets, fridges you can switch off, dirt paths you make by walking',
      'Take apart a whole pile of furniture at once',
    ],
    buildVersion: 'b42',
    items: [
      { workshopId: '3794207681', mods: ['FittedSheets'] }, // Fitted Sheets
      { workshopId: '3785740658', mods: ['FenceSheets'] }, // Fence Sheets
      { workshopId: '3795414660', mods: ['FittedBarricades'] }, // Fitted Barricades
      { workshopId: '3734639991', mods: ['SeedSeasonIndicator'] }, // Seed Season Indicator
      { workshopId: '3783623999', mods: ['LivestockPanelPlus'] }, // Livestock Panel Plus
      { workshopId: '3721829036', mods: ['STA_BetterHutches'] }, // ST Additions - Better Hutches
      { workshopId: '3763470184', mods: ['PropaneExchangeCabinet'] }, // Propane Exchange Cabinets
      { workshopId: '3778868211', mods: ['NicksTurnOffFridges'] }, // Nick's Turn Off Fridges
      { workshopId: '3782929173', mods: ['ProjectDirtroad'] }, // Project Dirtroad
      { workshopId: '3761218629', mods: ['DismantleAllAtOnce'] }, // Dismantle All at Once
    ],
    iniSettings: { ...FRIENDS_INI },
    sandboxSettings: {
      // 2 hours a day instead of 1.5: more daylight to build and tend the crops
      DayLength: 5,
    },
  },
]

function isLocal(item: PresetItem | PresetLocalMod): item is PresetLocalMod {
  return 'local' in item
}

// What the hand-written list turns into before presetData.json knows about it (a new item,
// refresh not run yet): enough to make a server, without pictures, sizes or sorting
export function fallbackMods(source: ModdedPresetSource): PresetMod[] {
  return source.items.map(item => isLocal(item)
    ? { workshopId: '', modId: item.local, name: item.name }
    : { workshopId: item.workshopId, modId: item.mods.join(';'), name: `Workshop item ${item.workshopId}` })
}

export function buildPreset(source: ModdedPresetSource, d: PresetData | undefined): ModdedPreset {
  const { items, ...rest } = source
  const mods = d?.mods?.length ? d.mods : fallbackMods(source)
  return {
    ...rest,
    mods,
    localMods: items.filter(isLocal).map(i => i.local),
    downloadBytes: d?.downloadBytes || mods.reduce((n, m) => n + (m.fileSize || 0), 0),
    verified: d?.verified,
  }
}

const DATA = data as unknown as Record<string, PresetData>

export const MODDED_PRESETS: ModdedPreset[] = MODDED_PRESET_SOURCES.map(s => buildPreset(s, DATA[s.key]))

// What a server made from a preset gets in its mod list: the preset's mods without the
// mod.info copies (the server reads its own once the downloads are done, and a mod that
// hasn't downloaded yet shouldn't look ready)
export function presetProfileMods(preset: ModdedPreset): ModEntry[] {
  return preset.mods.map(({ infos, ...m }) => m)
}

// Rough download time: Steam is usually quick, SteamCMD spends a few seconds per item on top
export function downloadMinutes(preset: Pick<ModdedPreset, 'downloadBytes' | 'mods'>, bytesPerSecond = 5 * 1024 * 1024): number {
  const items = preset.mods.filter(m => m.workshopId).length
  return Math.max(1, Math.round((preset.downloadBytes / bytesPerSecond + items * 3) / 60))
}
